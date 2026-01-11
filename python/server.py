"""
FastVLM Inference Server

A FastAPI server that provides screenshot analysis endpoints using the FastVLM-0.5B model.
The model is loaded once at startup and reused for all requests.

Endpoints:
    POST /analyze - Analyze a screenshot and return a description
    GET /health - Check if the server is ready
    POST /shutdown - Gracefully shutdown the server
    GET / - Server information

Usage:
    python server.py [--port PORT] [--host HOST]

Example:
    python server.py --port 5123
"""

import asyncio
import signal
import sys
from contextlib import asynccontextmanager
from typing import Optional, Dict, Any
import logging

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, validator
import uvicorn

from inference import analyze_screenshot, get_model_info, load_model

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Server configuration
DEFAULT_PORT = 5123
DEFAULT_HOST = "localhost"

# Shutdown flag
shutdown_event = asyncio.Event()


# Request/Response Models
class AnalyzeRequest(BaseModel):
    """Request model for screenshot analysis."""

    image_path: Optional[str] = Field(
        None,
        description="Path to the screenshot PNG file"
    )
    image_base64: Optional[str] = Field(
        None,
        description="Base64-encoded image data"
    )
    app_name: Optional[str] = Field(
        None,
        description="Name of the application being captured"
    )
    window_title: Optional[str] = Field(
        None,
        description="Title of the window being captured"
    )
    prompt: Optional[str] = Field(
        None,
        description="Custom prompt for analysis (optional)"
    )
    max_tokens: int = Field(
        200,
        ge=50,
        le=1000,
        description="Maximum tokens to generate (50-1000)"
    )
    temperature: float = Field(
        0.7,
        ge=0.0,
        le=2.0,
        description="Sampling temperature (0.0-2.0)"
    )

    @validator('image_path', 'image_base64')
    def check_at_least_one_image(cls, v, values):
        """Ensure at least one image input is provided."""
        if 'image_path' in values and values['image_path'] is None and v is None:
            raise ValueError('Either image_path or image_base64 must be provided')
        return v


class AnalyzeResponse(BaseModel):
    """Response model for screenshot analysis."""

    description: str = Field(
        ...,
        description="AI-generated description of the screenshot"
    )
    confidence: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Confidence score (0.0-1.0)"
    )
    success: bool = Field(
        ...,
        description="Whether the analysis was successful"
    )
    error: Optional[str] = Field(
        None,
        description="Error message if analysis failed"
    )


class HealthResponse(BaseModel):
    """Response model for health check."""

    status: str = Field(..., description="Server status")
    model_loaded: bool = Field(..., description="Whether the model is loaded")
    model_info: Dict[str, Any] = Field(..., description="Model information")


class ServerInfo(BaseModel):
    """Response model for server information."""

    name: str
    version: str
    description: str
    model: Dict[str, Any]
    endpoints: Dict[str, str]


# Lifespan context manager for startup/shutdown
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Manage application lifecycle.

    Loads the model at startup and cleans up on shutdown.
    """
    # Startup
    logger.info("Starting FastVLM Inference Server...")
    try:
        logger.info("Loading model at startup...")
        load_model()
        logger.info("Model loaded successfully")
    except Exception as e:
        logger.error(f"Failed to load model at startup: {str(e)}")
        logger.error("Server will start but /analyze endpoint will fail")

    yield

    # Shutdown
    logger.info("Shutting down FastVLM Inference Server...")


# Create FastAPI app
app = FastAPI(
    title="FastVLM Inference Server",
    description="Screenshot analysis using FastVLM-0.5B model via mlx-vlm",
    version="1.0.0",
    lifespan=lifespan
)


@app.get("/", response_model=ServerInfo)
async def root():
    """
    Get server information.

    Returns:
        ServerInfo: Server details and available endpoints
    """
    return ServerInfo(
        name="FastVLM Inference Server",
        version="1.0.0",
        description="Screenshot analysis using FastVLM-0.5B model",
        model=get_model_info(),
        endpoints={
            "/": "Server information",
            "/health": "Health check endpoint",
            "/analyze": "Screenshot analysis endpoint (POST)",
            "/shutdown": "Graceful shutdown endpoint (POST)"
        }
    )


@app.get("/health", response_model=HealthResponse)
async def health():
    """
    Health check endpoint.

    Returns:
        HealthResponse: Server health status and model information
    """
    model_info = get_model_info()

    return HealthResponse(
        status="healthy" if model_info["loaded"] else "model_not_loaded",
        model_loaded=model_info["loaded"],
        model_info=model_info
    )


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(request: AnalyzeRequest):
    """
    Analyze a screenshot and generate a description.

    Args:
        request: AnalyzeRequest with image data and parameters

    Returns:
        AnalyzeResponse: Analysis results with description and confidence

    Raises:
        HTTPException: If analysis fails
    """
    try:
        logger.info("Received analysis request")

        # Perform analysis
        result = analyze_screenshot(
            image_path=request.image_path,
            image_base64=request.image_base64,
            app_name=request.app_name,
            window_title=request.window_title,
            prompt=request.prompt,
            max_tokens=request.max_tokens,
            temperature=request.temperature
        )

        # Check if analysis was successful
        if not result["success"]:
            logger.error(f"Analysis failed: {result.get('error', 'Unknown error')}")
            raise HTTPException(
                status_code=500,
                detail=f"Analysis failed: {result.get('error', 'Unknown error')}"
            )

        logger.info("Analysis completed successfully")
        return AnalyzeResponse(**result)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error during analysis: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error: {str(e)}"
        )


@app.post("/shutdown")
async def shutdown(background_tasks: BackgroundTasks):
    """
    Gracefully shutdown the server.

    Returns:
        JSONResponse: Confirmation message
    """
    logger.info("Shutdown request received")

    async def shutdown_task():
        """Background task to shutdown the server."""
        await asyncio.sleep(1)  # Give time for response to be sent
        shutdown_event.set()

    background_tasks.add_task(shutdown_task)

    return JSONResponse(
        content={"message": "Server shutting down..."},
        status_code=200
    )


# Error handlers
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """
    Global exception handler for unhandled errors.
    """
    logger.error(f"Unhandled exception: {str(exc)}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Internal server error",
            "error": str(exc)
        }
    )


async def run_server(host: str, port: int):
    """
    Run the FastAPI server with uvicorn.

    Args:
        host: Host to bind to
        port: Port to listen on
    """
    config = uvicorn.Config(
        app,
        host=host,
        port=port,
        log_level="info",
        access_log=True
    )
    server = uvicorn.Server(config)

    # Create shutdown task
    async def check_shutdown():
        """Monitor shutdown event."""
        await shutdown_event.wait()
        logger.info("Shutdown event triggered")
        server.should_exit = True

    # Run both server and shutdown monitor
    shutdown_task = asyncio.create_task(check_shutdown())

    try:
        await server.serve()
    finally:
        shutdown_task.cancel()
        try:
            await shutdown_task
        except asyncio.CancelledError:
            pass


def main():
    """
    Main entry point for the server.

    Parses command-line arguments and starts the server.
    """
    import argparse

    parser = argparse.ArgumentParser(
        description="FastVLM Inference Server for Screenshot Analysis"
    )
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"Port to listen on (default: {DEFAULT_PORT})"
    )
    parser.add_argument(
        "--host",
        type=str,
        default=DEFAULT_HOST,
        help=f"Host to bind to (default: {DEFAULT_HOST})"
    )

    args = parser.parse_args()

    logger.info(f"Starting server on {args.host}:{args.port}")

    # Setup signal handlers for graceful shutdown
    def signal_handler(sig, frame):
        logger.info(f"Received signal {sig}, initiating shutdown...")
        shutdown_event.set()

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # Run the server
    try:
        asyncio.run(run_server(args.host, args.port))
    except KeyboardInterrupt:
        logger.info("Server stopped by user")
    except Exception as e:
        logger.error(f"Server error: {str(e)}", exc_info=True)
        sys.exit(1)

    logger.info("Server shutdown complete")


if __name__ == "__main__":
    main()

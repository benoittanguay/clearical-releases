"""
FastVLM Inference Server

A FastAPI server that provides screenshot analysis endpoints using the FastVLM-0.5B model
and text reasoning capabilities using the Qwen2.5-0.5B-Instruct-4bit model.
Both models are preloaded at server startup and cached for reuse.

Endpoints:
    GET / - Server information
    GET /health - Check if the server is ready
    POST /analyze - Analyze a screenshot and return a description
    POST /summarize - Summarize multiple activity descriptions
    POST /classify - Classify an activity to one of provided options
    GET /reasoning/health - Health check for reasoning model
    GET /reasoning/info - Get reasoning model information
    POST /shutdown - Gracefully shutdown the server

Usage:
    python server.py [--port PORT] [--host HOST]

Example:
    python server.py --port 5123
"""

import asyncio
import signal
import sys
from contextlib import asynccontextmanager
from typing import Optional, Dict, Any, List
import logging

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, validator
import uvicorn

from inference import analyze_screenshot, get_model_info, load_model
from reasoning import (
    summarize_activities,
    classify_activity,
    get_reasoning_model_info,
    load_reasoning_model
)

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
        500,
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


# Reasoning Request/Response Models
class ClassifyOption(BaseModel):
    """Option for classification."""

    id: str = Field(..., description="Unique identifier for the option")
    name: str = Field(..., description="Display name of the option")


class SummarizeRequest(BaseModel):
    """Request model for activity summarization."""

    descriptions: List[str] = Field(
        ...,
        description="List of activity descriptions to summarize",
        min_items=1
    )
    app_names: Optional[List[str]] = Field(
        None,
        description="Optional list of application names used"
    )


class SummarizeResponse(BaseModel):
    """Response model for summarization."""

    success: bool = Field(..., description="Whether summarization was successful")
    summary: str = Field(..., description="Generated summary")
    error: Optional[str] = Field(None, description="Error message if failed")


class ClassifyRequest(BaseModel):
    """Request model for activity classification."""

    description: str = Field(
        ...,
        description="Activity description to classify"
    )
    options: List[ClassifyOption] = Field(
        ...,
        description="List of classification options",
        min_items=1
    )
    context: Optional[str] = Field(
        None,
        description="Additional context (window titles, app names, etc.)"
    )


class ClassifyResponse(BaseModel):
    """Response model for classification."""

    success: bool = Field(..., description="Whether classification was successful")
    selected_id: Optional[str] = Field(None, description="ID of the selected option")
    selected_name: Optional[str] = Field(None, description="Name of the selected option")
    confidence: Optional[float] = Field(None, description="Confidence score (0.0-1.0)")
    error: Optional[str] = Field(None, description="Error message if failed")


class ReasoningHealthResponse(BaseModel):
    """Response model for reasoning health check."""

    status: str = Field(..., description="Reasoning model status")
    model_loaded: bool = Field(..., description="Whether the reasoning model is loaded")
    model_info: Dict[str, Any] = Field(..., description="Reasoning model information")


# Lifespan context manager for startup/shutdown
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Manage application lifecycle.

    Loads both VLM and reasoning models at startup and cleans up on shutdown.
    This ensures the first requests to /analyze, /summarize, and /classify
    don't have to wait for model loading (which can take 10-20 seconds).
    """
    # Startup
    logger.info("Starting FastVLM Inference Server...")

    # Load VLM model (nanoLLaVA)
    try:
        logger.info("Loading VLM model at startup...")
        load_model()
        logger.info("VLM model loaded successfully")
    except Exception as e:
        logger.error(f"Failed to load VLM model at startup: {str(e)}")
        logger.error("Server will start but /analyze endpoint will fail")

    # Load reasoning model (Qwen2.5)
    try:
        logger.info("Loading reasoning model at startup...")
        load_reasoning_model()
        logger.info("Reasoning model loaded successfully")
    except Exception as e:
        logger.error(f"Failed to load reasoning model at startup: {str(e)}")
        logger.error("Server will start but /summarize and /classify endpoints will fail")

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
            "/summarize": "Activity summarization endpoint (POST)",
            "/classify": "Activity classification endpoint (POST)",
            "/reasoning/health": "Reasoning model health check (GET)",
            "/reasoning/info": "Reasoning model info (GET)",
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
    reasoning_info = get_reasoning_model_info()

    # Add reasoning model status to model_info
    model_info["reasoning_model_loaded"] = reasoning_info["loaded"]

    # Server is healthy only if both models are loaded
    all_models_loaded = model_info["loaded"] and reasoning_info["loaded"]

    if not all_models_loaded:
        logger.warning(f"Health check: VLM loaded={model_info['loaded']}, Reasoning loaded={reasoning_info['loaded']}")

    return HealthResponse(
        status="healthy" if all_models_loaded else "model_not_loaded",
        model_loaded=all_models_loaded,
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


# Reasoning Endpoints
@app.post("/summarize", response_model=SummarizeResponse)
async def summarize(request: SummarizeRequest):
    """
    Summarize multiple activity descriptions into a cohesive narrative.

    Args:
        request: SummarizeRequest with list of descriptions

    Returns:
        SummarizeResponse: Generated summary
    """
    try:
        logger.info(f"Received summarization request with {len(request.descriptions)} descriptions")

        # Run summarization in thread pool to avoid blocking event loop
        # This is critical because mlx-lm operations are CPU-intensive and synchronous
        import concurrent.futures
        import functools
        loop = asyncio.get_event_loop()

        with concurrent.futures.ThreadPoolExecutor() as pool:
            # Use functools.partial to create a callable with arguments
            func = functools.partial(
                summarize_activities,
                descriptions=request.descriptions,
                app_names=request.app_names
            )
            result = await asyncio.wait_for(
                loop.run_in_executor(pool, func),
                timeout=55.0  # 55s timeout (less than client's 60s timeout)
            )

        if not result["success"]:
            logger.error(f"Summarization failed: {result.get('error', 'Unknown error')}")
            raise HTTPException(
                status_code=500,
                detail=f"Summarization failed: {result.get('error', 'Unknown error')}"
            )

        logger.info("Summarization completed successfully")
        return SummarizeResponse(**result)

    except asyncio.TimeoutError:
        logger.error("Summarization timed out after 55 seconds")
        raise HTTPException(
            status_code=504,
            detail="Summarization timed out. This may indicate the model is not properly cached or is taking too long to process."
        )
    except HTTPException:
        raise
    except BrokenPipeError:
        # Client disconnected before we could send the response
        logger.warning("Client disconnected during summarization (broken pipe)")
        raise HTTPException(
            status_code=499,  # Client Closed Request (non-standard but widely used)
            detail="Client disconnected before response could be sent"
        )
    except Exception as e:
        logger.error(f"Unexpected error during summarization: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error: {str(e)}"
        )


@app.post("/classify", response_model=ClassifyResponse)
async def classify(request: ClassifyRequest):
    """
    Classify an activity to one of the provided options.

    Args:
        request: ClassifyRequest with description and options

    Returns:
        ClassifyResponse: Selected classification with confidence
    """
    try:
        logger.info(f"Received classification request with {len(request.options)} options")

        # Convert Pydantic models to dicts for the reasoning module
        options_dicts = [{"id": opt.id, "name": opt.name} for opt in request.options]

        result = classify_activity(
            description=request.description,
            options=options_dicts,
            context=request.context or ""
        )

        if not result["success"]:
            logger.error(f"Classification failed: {result.get('error', 'Unknown error')}")
            raise HTTPException(
                status_code=500,
                detail=f"Classification failed: {result.get('error', 'Unknown error')}"
            )

        logger.info("Classification completed successfully")
        return ClassifyResponse(**result)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error during classification: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error: {str(e)}"
        )


@app.get("/reasoning/health", response_model=ReasoningHealthResponse)
async def reasoning_health():
    """
    Health check endpoint for the reasoning model.

    Returns:
        ReasoningHealthResponse: Reasoning model health status
    """
    model_info = get_reasoning_model_info()

    if not model_info["loaded"]:
        logger.warning("Reasoning health check: Model NOT loaded! This will cause timeouts on summarization requests.")

    return ReasoningHealthResponse(
        status="healthy" if model_info["loaded"] else "model_not_loaded",
        model_loaded=model_info["loaded"],
        model_info=model_info
    )


@app.get("/reasoning/info")
async def reasoning_info():
    """
    Get information about the reasoning model.

    Returns:
        Dict with reasoning model details
    """
    return get_reasoning_model_info()


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
        access_log=True,
        timeout_keep_alive=75  # Keep connection alive for 75s (longer than client timeout of 60s)
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

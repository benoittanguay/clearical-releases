"""
FastVLM Inference Module

This module provides core inference functionality for screenshot analysis using
the nanoLLaVA-1.5-4bit quantized model via mlx-vlm. It handles model loading,
image processing, and description generation.

Features:
- 4-bit quantized model for smaller size and faster inference
- Model caching for efficient reuse
- Base64 and file path image input support
- Structured prompt for screenshot analysis
- Error handling and validation
"""

import base64
from pathlib import Path
from typing import Dict, Any, Optional, Tuple
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Global model cache
_model_cache: Optional[Tuple[Any, Any]] = None

# Default prompt for screenshot analysis
# Note: nanoLLaVA requires the <image> token to be present in the prompt
DEFAULT_PROMPT = """<image>
App: {app_name}
Window: {window_title}

Describe what work is being done in this screenshot. Be specific and concise (2-3 sentences maximum).

What to include:
- The specific file, document, or webpage name visible in tabs or title bars
- Specific content you can read: function names, class names, error messages, document sections, data being edited
- The specific task: editing code, reviewing documents, debugging errors, designing UI, analyzing data, etc.

What to avoid:
- Generic phrases like "working on a project", "code snippets", "development process"
- Vague descriptions that apply to any screenshot
- Listing UI elements unless directly relevant to the task

Example good output: "Editing the ScreenshotAnalyzer.swift file in Xcode. Working on the processScreenshot() function that handles image compression. Several build warnings visible in the issues navigator."

Example bad output: "The user is working on a project using code. There are various UI elements visible including panels and toolbars. The specific task is not clear from this image."


def get_model_path() -> str:
    """
    Get the path to the bundled model, falling back to HuggingFace download.

    Returns:
        str: Path to model directory or model ID for HuggingFace download

    The function checks multiple locations in this order:
    1. Bundled model (when running as PyInstaller executable)
    2. Local models directory (for development)
    3. Falls back to HuggingFace model ID (will download on first use)
    """
    import sys
    import os

    # Model ID for HuggingFace fallback (4-bit quantized version)
    model_id = "mlx-community/nanoLLaVA-1.5-4bit"

    # Check if running as a PyInstaller bundle
    if getattr(sys, 'frozen', False):
        # Running as compiled executable
        # PyInstaller sets sys._MEIPASS to the temporary directory with bundled files
        bundle_dir = Path(sys._MEIPASS)
        # Model is bundled directly at nanoLLaVA-1.5-4bit (not models/nanoLLaVA-1.5-4bit)
        bundled_model = bundle_dir / "nanoLLaVA-1.5-4bit"

        if bundled_model.exists():
            logger.info(f"Using bundled model from: {bundled_model}")
            return str(bundled_model)
        else:
            logger.warning(f"Bundled model not found at: {bundled_model}")
    else:
        # Running in development mode
        # Check for local model directory (relative to this file)
        script_dir = Path(__file__).parent
        local_model = script_dir / "models" / "nanoLLaVA-1.5-4bit"

        if local_model.exists():
            logger.info(f"Using local model from: {local_model}")
            return str(local_model)
        else:
            logger.info(f"Local model not found at: {local_model}")

    # Fall back to HuggingFace download
    logger.info(f"Falling back to HuggingFace download: {model_id}")
    logger.info("Model will be downloaded to HuggingFace cache on first use")
    return model_id


def load_model() -> Tuple[Any, Any]:
    """
    Load the FastVLM-0.5B model and processor.

    Uses a global cache to ensure the model is loaded only once.
    Subsequent calls return the cached model.

    Returns:
        Tuple[model, processor]: The loaded model and processor

    Raises:
        ImportError: If mlx-vlm is not installed
        RuntimeError: If model loading fails
    """
    global _model_cache

    # Return cached model if available
    if _model_cache is not None:
        logger.info("Using cached model")
        return _model_cache

    try:
        logger.info("Loading FastVLM-0.5B model...")
        from mlx_vlm import load as mlx_load

        # Get model path (bundled, local, or HuggingFace)
        model_path = get_model_path()

        # Load the model and processor
        # nanoLLaVA requires trust_remote_code=True due to custom modeling code
        logger.info(f"Loading model from: {model_path}")
        model, processor = mlx_load(model_path, trust_remote_code=True)

        # Cache for future use
        _model_cache = (model, processor)

        logger.info("Model loaded successfully and cached")
        return model, processor

    except ImportError as e:
        logger.error("mlx-vlm not installed. Install with: pip install mlx-vlm")
        raise ImportError(
            "mlx-vlm package not found. Install it with: pip install mlx-vlm"
        ) from e
    except Exception as e:
        logger.error(f"Failed to load model: {str(e)}")
        raise RuntimeError(f"Model loading failed: {str(e)}") from e


def decode_base64_image(base64_str: str) -> bytes:
    """
    Decode a base64-encoded image string.

    Args:
        base64_str: Base64-encoded image data

    Returns:
        bytes: Decoded image data

    Raises:
        ValueError: If base64 string is invalid
    """
    try:
        # Remove data URL prefix if present
        if ',' in base64_str:
            base64_str = base64_str.split(',', 1)[1]

        return base64.b64decode(base64_str)
    except Exception as e:
        logger.error(f"Failed to decode base64 image: {str(e)}")
        raise ValueError(f"Invalid base64 image data: {str(e)}") from e


def validate_image_path(image_path: str) -> Path:
    """
    Validate that an image path exists and is readable.

    Args:
        image_path: Path to the image file

    Returns:
        Path: Validated Path object

    Raises:
        FileNotFoundError: If image file doesn't exist
        ValueError: If path is invalid
    """
    try:
        path = Path(image_path).resolve()

        if not path.exists():
            raise FileNotFoundError(f"Image file not found: {image_path}")

        if not path.is_file():
            raise ValueError(f"Path is not a file: {image_path}")

        # Check if it's likely an image file
        valid_extensions = {'.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'}
        if path.suffix.lower() not in valid_extensions:
            logger.warning(f"Unusual image extension: {path.suffix}")

        return path

    except Exception as e:
        logger.error(f"Image path validation failed: {str(e)}")
        raise


def analyze_screenshot(
    image_path: Optional[str] = None,
    image_base64: Optional[str] = None,
    prompt: Optional[str] = None,
    app_name: Optional[str] = None,
    window_title: Optional[str] = None,
    max_tokens: int = 400,
    temperature: float = 0.7,
    preprocess: bool = True
) -> Dict[str, Any]:
    """
    Analyze a screenshot and generate a description.

    Args:
        image_path: Path to the screenshot PNG file (optional)
        image_base64: Base64-encoded image data (optional)
        prompt: Custom prompt for analysis (optional, uses DEFAULT_PROMPT if not provided)
        app_name: Name of the application being captured (optional)
        window_title: Title of the window being captured (optional)
        max_tokens: Maximum tokens to generate (default: 400)
        temperature: Sampling temperature (default: 0.7)
        preprocess: Whether to auto-crop black borders (default: True)

    Returns:
        Dict containing:
            - description: Generated description of the screenshot
            - confidence: Confidence score (0.0-1.0)
            - success: Boolean indicating success
            - error: Error message if failed (optional)
            - preprocessed: Whether the image was preprocessed (optional)

    Raises:
        ValueError: If neither image_path nor image_base64 is provided
        RuntimeError: If inference fails
    """
    # Validate inputs
    if image_path is None and image_base64 is None:
        raise ValueError("Either image_path or image_base64 must be provided")

    if image_path is not None and image_base64 is not None:
        logger.warning("Both image_path and image_base64 provided, using image_path")
        image_base64 = None

    # Use default prompt if none provided
    if prompt is None:
        prompt = DEFAULT_PROMPT.format(
            app_name=app_name or "Unknown",
            window_title=window_title or "Not available"
        )
    else:
        # Ensure custom prompts include the <image> token
        # If not present, prepend it
        if '<image>' not in prompt:
            prompt = f'<image>\n{prompt}'

    # Track temporary files for cleanup
    temp_files_to_cleanup = []
    was_preprocessed = False

    try:
        # Load model (uses cache if already loaded)
        model, processor = load_model()

        # Prepare image path
        if image_path is not None:
            # Validate and use the provided path
            img_path = validate_image_path(image_path)
            image_source = str(img_path)
            logger.info(f"Analyzing image from path: {image_source}")
        else:
            # Handle base64 image
            # For mlx-vlm, we need to save to a temporary file
            import tempfile
            img_data = decode_base64_image(image_base64)

            # Create temporary file
            with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp:
                tmp.write(img_data)
                image_source = tmp.name
                temp_files_to_cleanup.append(image_source)

            logger.info("Analyzing image from base64 data")

        # Preprocess image to remove black borders
        if preprocess:
            try:
                from image_preprocessing import preprocess_screenshot
                logger.info("Preprocessing image to remove black borders...")
                processed_path, was_cropped = preprocess_screenshot(image_source)

                if was_cropped:
                    logger.info("Image was cropped to remove borders")
                    # Add the temp file to cleanup list
                    temp_files_to_cleanup.append(processed_path)
                    image_source = processed_path
                    was_preprocessed = True
                else:
                    logger.info("No significant borders detected, using original image")

            except ImportError as e:
                logger.warning(f"Preprocessing not available (missing dependencies): {e}")
            except Exception as e:
                logger.warning(f"Preprocessing failed, using original image: {e}")

        # Run inference
        # nanoLLaVA uses a ChatML-style format. The prompt should already contain <image>
        # For best results, wrap it in a chat template
        logger.info(f"Running inference with prompt: {prompt[:50]}...")

        from mlx_vlm import generate as mlx_generate

        # Apply chat template for better results
        # The prompt already contains <image>, so we just format it as a user message
        messages = [
            {"role": "user", "content": prompt}
        ]
        formatted_prompt = processor.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True
        )

        logger.info(f"Formatted prompt: {formatted_prompt[:100]}...")

        # Generate description
        # mlx-vlm expects: generate(model, processor, prompt, image, **kwargs)
        # Note: Parameters are prompt THEN image, not image then prompt
        #
        # Use appropriate generation parameters to avoid repetitive output:
        # - Lower temperature for more focused output
        # - Add repetition_penalty to prevent loops
        output = mlx_generate(
            model,
            processor,
            formatted_prompt,
            image_source,
            max_tokens=max_tokens,
            temperature=max(0.1, temperature * 0.5),  # Use lower temperature for VLM
            repetition_penalty=1.2,  # Penalize repetition
            verbose=False
        )

        # Extract description from output
        # mlx-vlm returns a string that includes the prompt + generated text
        # We need to extract only the generated portion after the prompt
        description = output.strip()

        # Remove the prompt from the output if it's echoed back
        # The model often echoes the prompt before generating the response
        if description.startswith(prompt):
            description = description[len(prompt):].strip()

        # Some models use special separators like "Assistant:" or "\n\n"
        # Try to detect and remove common separators
        separators = ["\nAssistant:", "\nAnswer:", "\nResponse:", "\n\n"]
        for separator in separators:
            if separator in description:
                parts = description.split(separator, 1)
                if len(parts) > 1:
                    description = parts[1].strip()
                    break

        # If the description is still empty or suspiciously short, something went wrong
        if len(description) < 10:
            logger.warning(f"Generated description is very short ({len(description)} chars): '{description}'")
            logger.warning(f"Full model output was: '{output[:200]}'")

        # Calculate a simple confidence score based on output length and quality
        # This is a heuristic - longer, more detailed outputs typically indicate higher confidence
        confidence = min(0.95, 0.5 + (len(description) / 500))

        logger.info(f"Generated description: {description[:100]}...")
        logger.info(f"Confidence: {confidence:.2f}")

        result = {
            "description": description,
            "confidence": round(confidence, 2),
            "success": True
        }

        if was_preprocessed:
            result["preprocessed"] = True

        return result

    except Exception as e:
        logger.error(f"Screenshot analysis failed: {str(e)}", exc_info=True)
        return {
            "description": "",
            "confidence": 0.0,
            "success": False,
            "error": str(e)
        }
    finally:
        # Clean up all temporary files
        for temp_file in temp_files_to_cleanup:
            try:
                Path(temp_file).unlink()
            except Exception as cleanup_error:
                logger.warning(f"Failed to cleanup temp file {temp_file}: {cleanup_error}")


def get_model_info() -> Dict[str, Any]:
    """
    Get information about the loaded model.

    Returns:
        Dict containing model information
    """
    return {
        "model_name": "nanoLLaVA-1.5-4bit",
        "model_id": "mlx-community/nanoLLaVA-1.5-4bit",
        "framework": "mlx-vlm",
        "loaded": _model_cache is not None,
        "device": "Apple Silicon (MLX)",
        "description": "4-bit quantized vision-language model optimized for Apple Silicon"
    }


if __name__ == "__main__":
    # Simple CLI for testing
    import sys

    if len(sys.argv) < 2:
        print("Usage: python inference.py <image_path>")
        print("\nModel Info:")
        info = get_model_info()
        for key, value in info.items():
            print(f"  {key}: {value}")
        sys.exit(1)

    image_path = sys.argv[1]

    print(f"Analyzing: {image_path}")
    print("-" * 60)

    result = analyze_screenshot(image_path=image_path)

    if result["success"]:
        print(f"Description: {result['description']}")
        print(f"Confidence: {result['confidence']}")
    else:
        print(f"Error: {result['error']}")

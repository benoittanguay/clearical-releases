"""
Reasoning Module - Qwen2.5-0.5B for text summarization and classification

This module provides text-only reasoning capabilities using Qwen2.5-0.5B-Instruct-4bit
for tasks like:
- Activity summarization
- Bucket/Jira issue classification
- Tempo account assignment
"""

from typing import Dict, Any, Optional, List
import logging

logger = logging.getLogger(__name__)

# Model configuration
MODEL_ID = "mlx-community/Qwen2.5-0.5B-Instruct-4bit"

# Global model cache
_reasoning_model_cache = None


def get_reasoning_model_path() -> str:
    """
    Get the path to the bundled reasoning model, falling back to HuggingFace download.

    Returns:
        str: Path to model directory or model ID for HuggingFace download
    """
    import sys
    from pathlib import Path

    # Check if running as a PyInstaller bundle
    if getattr(sys, 'frozen', False):
        # Running as compiled executable
        bundle_dir = Path(sys._MEIPASS)
        bundled_model = bundle_dir / "Qwen2.5-0.5B-Instruct-4bit"

        if bundled_model.exists():
            logger.info(f"Using bundled reasoning model from: {bundled_model}")
            return str(bundled_model)
        else:
            logger.warning(f"Bundled reasoning model not found at: {bundled_model}")
    else:
        # Running in development mode
        script_dir = Path(__file__).parent
        local_model = script_dir / "models" / "Qwen2.5-0.5B-Instruct-4bit"

        if local_model.exists():
            logger.info(f"Using local reasoning model from: {local_model}")
            return str(local_model)
        else:
            logger.info(f"Local reasoning model not found at: {local_model}")

    # Fall back to HuggingFace download
    logger.info(f"Falling back to HuggingFace download: {MODEL_ID}")
    return MODEL_ID


def load_reasoning_model():
    """Load the Qwen2.5-0.5B-Instruct-4bit model for reasoning tasks."""
    global _reasoning_model_cache

    if _reasoning_model_cache is not None:
        logger.info("Using cached reasoning model")
        return _reasoning_model_cache

    import sys
    import os

    # Redirect stdout/stderr during model loading to prevent potential broken pipe errors
    # from HuggingFace download progress bars or other output
    original_stdout = sys.stdout
    original_stderr = sys.stderr
    devnull = None

    try:
        model_path = get_reasoning_model_path()
        logger.info(f"Loading reasoning model from: {model_path}")

        # Redirect stdout/stderr to devnull during model loading
        devnull = open(os.devnull, 'w')
        sys.stdout = devnull
        sys.stderr = devnull

        from mlx_lm import load
        model, tokenizer = load(model_path)

        # Restore before caching and logging
        sys.stdout = original_stdout
        sys.stderr = original_stderr
        if devnull is not None:
            devnull.close()
            devnull = None

        _reasoning_model_cache = (model, tokenizer)
        logger.info("Reasoning model loaded successfully")
        return model, tokenizer
    except Exception as e:
        # Restore stderr first so we can log the error
        sys.stderr = original_stderr
        logger.error(f"Failed to load reasoning model: {e}")
        raise
    finally:
        # Always restore stdout/stderr and close devnull
        sys.stdout = original_stdout
        sys.stderr = original_stderr
        if devnull is not None:
            devnull.close()

def generate_text(prompt: str, max_tokens: int = 200, temperature: float = 0.7) -> str:
    """
    Generate text using the reasoning model.

    Note: temperature parameter is currently not supported by mlx-lm Python API.
    The model will use default temperature (deterministic generation).
    """
    import sys
    import os

    model, tokenizer = load_reasoning_model()

    from mlx_lm import generate

    # Suppress any stdout/stderr output from mlx-lm to prevent broken pipe errors
    # when running in FastAPI/uvicorn async context.
    # mlx-lm may write progress bars or other output to stdout/stderr, which causes
    # "[Errno 32] Broken pipe" when the parent process (Electron) isn't consuming
    # the output fast enough or the pipe buffer fills up.
    original_stdout = sys.stdout
    original_stderr = sys.stderr
    devnull = None

    try:
        # Redirect stdout/stderr to devnull
        devnull = open(os.devnull, 'w')
        sys.stdout = devnull
        sys.stderr = devnull

        # Note: mlx-lm's generate function doesn't currently support temperature parameter
        # in the Python API, so we omit it for compatibility
        response = generate(
            model,
            tokenizer,
            prompt=prompt,
            max_tokens=max_tokens,
            verbose=False  # Explicitly disable verbose output
        )
        return response
    except Exception as e:
        # Restore stderr first so we can log the error
        sys.stderr = original_stderr
        logger.error(f"Error during text generation: {e}")
        raise
    finally:
        # Always restore stdout/stderr and close devnull
        sys.stdout = original_stdout
        sys.stderr = original_stderr
        if devnull is not None:
            devnull.close()

def summarize_activities(descriptions: List[str], app_names: List[str] = None) -> Dict[str, Any]:
    """
    Summarize multiple activity descriptions into a cohesive narrative.

    Args:
        descriptions: List of screenshot/activity descriptions
        app_names: Optional list of app names used

    Returns:
        Dict with summary and success status
    """
    if not descriptions:
        return {"success": False, "error": "No descriptions provided", "summary": ""}

    # Build context
    context = "\n".join([f"- {d}" for d in descriptions[:10]])  # Limit to 10
    apps_context = ""
    if app_names:
        unique_apps = list(set(app_names))[:5]
        apps_context = f"\n\nApplications used: {', '.join(unique_apps)}"

    prompt = f"""Create a natural, story-like summary of these work activities. Write 2-3 sentences describing what the user did, focusing on the workflow and context. Start with "The user..." and make it read like a narrative, not a list.

Activities:
{context}
{apps_context}

Natural narrative summary:"""

    try:
        logger.info("Starting summarization...")
        summary = generate_text(prompt, max_tokens=150)
        logger.info("Summarization completed successfully")
        return {"success": True, "summary": summary.strip()}
    except BrokenPipeError as e:
        logger.error(f"Broken pipe error during summarization: {e}", exc_info=True)
        return {"success": False, "error": f"Broken pipe error: {str(e)}", "summary": ""}
    except Exception as e:
        logger.error(f"Summarization failed: {e}", exc_info=True)
        return {"success": False, "error": str(e), "summary": ""}

def classify_activity(
    description: str,
    options: List[Dict[str, str]],
    context: str = ""
) -> Dict[str, Any]:
    """
    Classify an activity to one of the provided options.

    Args:
        description: The activity description to classify
        options: List of dicts with 'id' and 'name' keys
        context: Additional context (window titles, app names, etc.)

    Returns:
        Dict with selected option id and confidence
    """
    if not options:
        return {"success": False, "error": "No options provided"}

    options_text = "\n".join([f"{i+1}. {opt['name']}" for i, opt in enumerate(options)])

    prompt = f"""Given this work activity, select the most appropriate category.

Activity: {description}
{f"Context: {context}" if context else ""}

Options:
{options_text}

Reply with ONLY the number of the best matching option."""

    try:
        logger.info("Starting classification...")
        response = generate_text(prompt, max_tokens=10)
        logger.info("Classification generation completed")

        # Parse the number from response
        import re
        numbers = re.findall(r'\d+', response)
        if numbers:
            idx = int(numbers[0]) - 1
            if 0 <= idx < len(options):
                return {
                    "success": True,
                    "selected_id": options[idx]['id'],
                    "selected_name": options[idx]['name'],
                    "confidence": 0.8
                }

        # Fallback to first option
        return {
            "success": True,
            "selected_id": options[0]['id'],
            "selected_name": options[0]['name'],
            "confidence": 0.5
        }
    except BrokenPipeError as e:
        logger.error(f"Broken pipe error during classification: {e}", exc_info=True)
        return {"success": False, "error": f"Broken pipe error: {str(e)}"}
    except Exception as e:
        logger.error(f"Classification failed: {e}", exc_info=True)
        return {"success": False, "error": str(e)}

def get_reasoning_model_info() -> Dict[str, Any]:
    """Get information about the reasoning model."""
    return {
        "model_name": "Qwen2.5-0.5B-Instruct-4bit",
        "model_id": MODEL_ID,
        "framework": "mlx-lm",
        "loaded": _reasoning_model_cache is not None,
        "device": "Apple Silicon (MLX)",
        "capabilities": ["summarization", "classification", "text_generation"]
    }

"""
Image Preprocessing Module

This module provides utilities for preprocessing screenshots before analysis,
including automatic detection and removal of black borders/frames that may be
captured from window shadows or screen recording padding.

Features:
- Auto-detect black borders using threshold-based edge detection
- Crop to content bounding box
- Preserve original image when no significant borders detected
- Configurable thresholds for border detection
"""

import logging
from pathlib import Path
from typing import Tuple, Optional
import tempfile

logger = logging.getLogger(__name__)

# Default thresholds for black border detection
DEFAULT_BLACK_THRESHOLD = 15  # RGB values below this are considered "black"
DEFAULT_MIN_BORDER_SIZE = 5   # Minimum border size in pixels to be worth cropping


def detect_content_bounds(
    image_data: bytes,
    black_threshold: int = DEFAULT_BLACK_THRESHOLD,
    min_border_size: int = DEFAULT_MIN_BORDER_SIZE
) -> Optional[Tuple[int, int, int, int]]:
    """
    Detect the bounding box of non-black content in an image.

    Args:
        image_data: Raw image bytes (PNG format)
        black_threshold: RGB values below this are considered black (0-255)
        min_border_size: Minimum border size to detect (pixels)

    Returns:
        Tuple of (left, top, right, bottom) coordinates, or None if no borders detected
    """
    try:
        from PIL import Image
        import io
        import numpy as np

        # Load image
        img = Image.open(io.BytesIO(image_data))

        # Convert to RGB if needed (handle RGBA, grayscale, etc.)
        if img.mode != 'RGB':
            img = img.convert('RGB')

        # Convert to numpy array for faster processing
        img_array = np.array(img)
        height, width = img_array.shape[:2]

        logger.info(f"Analyzing image for black borders: {width}x{height}")

        # Detect borders by checking if pixels are below threshold
        # A pixel is "black" if all RGB channels are below the threshold
        is_black = np.all(img_array <= black_threshold, axis=2)

        # Find rows and columns that are NOT all black
        non_black_rows = np.any(~is_black, axis=1)
        non_black_cols = np.any(~is_black, axis=0)

        # Find first and last non-black row/column
        if not np.any(non_black_rows) or not np.any(non_black_cols):
            logger.warning("Image appears to be completely black")
            return None

        top = np.argmax(non_black_rows)
        bottom = height - np.argmax(non_black_rows[::-1]) - 1
        left = np.argmax(non_black_cols)
        right = width - np.argmax(non_black_cols[::-1]) - 1

        # Calculate border sizes
        border_top = top
        border_bottom = height - bottom - 1
        border_left = left
        border_right = width - right - 1

        logger.info(f"Detected borders - top: {border_top}px, bottom: {border_bottom}px, "
                   f"left: {border_left}px, right: {border_right}px")

        # Check if borders are significant enough to crop
        max_border = max(border_top, border_bottom, border_left, border_right)
        if max_border < min_border_size:
            logger.info(f"Borders too small ({max_border}px < {min_border_size}px), skipping crop")
            return None

        # Ensure bounds are valid
        if left >= right or top >= bottom:
            logger.warning("Invalid bounds detected, skipping crop")
            return None

        # Calculate crop percentage for logging
        crop_width = right - left + 1
        crop_height = bottom - top + 1
        width_percent = (crop_width / width) * 100
        height_percent = (crop_height / height) * 100

        logger.info(f"Content bounds: ({left}, {top}) to ({right}, {bottom})")
        logger.info(f"Cropped size will be: {crop_width}x{crop_height} "
                   f"({width_percent:.1f}% width, {height_percent:.1f}% height)")

        return (left, top, right, bottom)

    except ImportError:
        logger.error("PIL (Pillow) not installed. Install with: pip install Pillow")
        return None
    except Exception as e:
        logger.error(f"Failed to detect content bounds: {e}", exc_info=True)
        return None


def crop_image(
    image_data: bytes,
    bounds: Tuple[int, int, int, int]
) -> bytes:
    """
    Crop an image to the specified bounds.

    Args:
        image_data: Raw image bytes (PNG format)
        bounds: Tuple of (left, top, right, bottom) coordinates

    Returns:
        Cropped image as PNG bytes
    """
    try:
        from PIL import Image
        import io

        # Load image
        img = Image.open(io.BytesIO(image_data))

        # Crop to bounds
        # PIL crop expects (left, top, right+1, bottom+1)
        left, top, right, bottom = bounds
        cropped = img.crop((left, top, right + 1, bottom + 1))

        # Save to bytes
        output = io.BytesIO()
        cropped.save(output, format='PNG', optimize=False)

        return output.getvalue()

    except ImportError:
        logger.error("PIL (Pillow) not installed. Install with: pip install Pillow")
        raise
    except Exception as e:
        logger.error(f"Failed to crop image: {e}", exc_info=True)
        raise


def preprocess_screenshot(
    image_path: Optional[str] = None,
    image_data: Optional[bytes] = None,
    black_threshold: int = DEFAULT_BLACK_THRESHOLD,
    min_border_size: int = DEFAULT_MIN_BORDER_SIZE
) -> Tuple[Optional[str], bool]:
    """
    Preprocess a screenshot by removing black borders.

    This function detects and removes black borders/frames that may be
    captured from window shadows or screen recording padding.

    Args:
        image_path: Path to the image file (optional)
        image_data: Raw image bytes (optional, will be read from path if not provided)
        black_threshold: RGB values below this are considered black (0-255)
        min_border_size: Minimum border size to detect (pixels)

    Returns:
        Tuple of (processed_image_path, was_cropped)
        - processed_image_path: Path to the processed image (temp file if cropped, original if not)
        - was_cropped: Boolean indicating whether the image was actually cropped

    Raises:
        ValueError: If neither image_path nor image_data is provided
        FileNotFoundError: If image_path doesn't exist
    """
    if image_path is None and image_data is None:
        raise ValueError("Either image_path or image_data must be provided")

    try:
        # Load image data if not provided
        if image_data is None:
            image_path_obj = Path(image_path)
            if not image_path_obj.exists():
                raise FileNotFoundError(f"Image file not found: {image_path}")

            with open(image_path, 'rb') as f:
                image_data = f.read()

            logger.info(f"Loaded image from: {image_path}")

        # Detect content bounds
        bounds = detect_content_bounds(image_data, black_threshold, min_border_size)

        # If no significant borders detected, return original
        if bounds is None:
            logger.info("No significant borders detected, using original image")
            return (image_path, False)

        # Crop the image
        logger.info("Cropping image to remove borders...")
        cropped_data = crop_image(image_data, bounds)

        # Save to temporary file
        # Use original filename suffix to preserve format info
        suffix = '.png'
        if image_path:
            suffix = Path(image_path).suffix or '.png'

        temp_file = tempfile.NamedTemporaryFile(
            mode='wb',
            suffix=suffix,
            delete=False
        )
        temp_file.write(cropped_data)
        temp_file.close()

        logger.info(f"Saved cropped image to: {temp_file.name}")

        return (temp_file.name, True)

    except Exception as e:
        logger.error(f"Preprocessing failed: {e}", exc_info=True)
        # On error, return original path if available
        if image_path:
            logger.warning("Preprocessing failed, falling back to original image")
            return (image_path, False)
        raise


def get_preprocessing_info() -> dict:
    """
    Get information about preprocessing capabilities.

    Returns:
        Dict containing preprocessing configuration and status
    """
    try:
        import PIL
        pil_available = True
        pil_version = PIL.__version__
    except ImportError:
        pil_available = False
        pil_version = None

    try:
        import numpy
        numpy_available = True
        numpy_version = numpy.__version__
    except ImportError:
        numpy_available = False
        numpy_version = None

    return {
        "enabled": pil_available and numpy_available,
        "pil_available": pil_available,
        "pil_version": pil_version,
        "numpy_available": numpy_available,
        "numpy_version": numpy_version,
        "default_black_threshold": DEFAULT_BLACK_THRESHOLD,
        "default_min_border_size": DEFAULT_MIN_BORDER_SIZE,
        "description": "Automatic black border detection and removal for screenshots"
    }


if __name__ == "__main__":
    # Simple CLI for testing
    import sys

    if len(sys.argv) < 2:
        print("Usage: python image_preprocessing.py <image_path> [output_path]")
        print("\nPreprocessing Info:")
        info = get_preprocessing_info()
        for key, value in info.items():
            print(f"  {key}: {value}")
        sys.exit(1)

    image_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None

    print(f"Preprocessing: {image_path}")
    print("-" * 60)

    processed_path, was_cropped = preprocess_screenshot(image_path)

    if was_cropped:
        print(f"Image cropped successfully")
        print(f"Processed image: {processed_path}")

        if output_path:
            import shutil
            shutil.copy(processed_path, output_path)
            print(f"Saved to: {output_path}")

            # Clean up temp file
            Path(processed_path).unlink()
    else:
        print("No cropping needed")
        print(f"Original image: {processed_path}")

#!/usr/bin/env python3
"""
Test script for image preprocessing (black border removal).

This script tests the automatic detection and removal of black borders
from screenshots.

Usage:
    python test_preprocessing.py <input_image> [output_image]

Example:
    python test_preprocessing.py screenshot.png cropped.png
"""

import sys
from pathlib import Path
from image_preprocessing import preprocess_screenshot, get_preprocessing_info


def main():
    """Main test function."""
    if len(sys.argv) < 2:
        print(__doc__)
        print("\nPreprocessing Info:")
        info = get_preprocessing_info()
        for key, value in info.items():
            print(f"  {key}: {value}")
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None

    # Check if input exists
    if not Path(input_path).exists():
        print(f"Error: Input file not found: {input_path}")
        sys.exit(1)

    print(f"Testing preprocessing on: {input_path}")
    print("-" * 60)

    try:
        # Check dependencies
        info = get_preprocessing_info()
        if not info["enabled"]:
            print("Error: Preprocessing not available!")
            print("Missing dependencies:")
            if not info["pil_available"]:
                print("  - Pillow (install: pip install Pillow)")
            if not info["numpy_available"]:
                print("  - numpy (install: pip install numpy)")
            sys.exit(1)

        print("Dependencies:")
        print(f"  PIL version: {info['pil_version']}")
        print(f"  NumPy version: {info['numpy_version']}")
        print()

        # Preprocess the image
        processed_path, was_cropped = preprocess_screenshot(input_path)

        if was_cropped:
            print("✓ Image was cropped (black borders detected and removed)")
            print(f"  Processed image: {processed_path}")

            if output_path:
                import shutil
                shutil.copy(processed_path, output_path)
                print(f"  Saved to: {output_path}")

                # Clean up temp file
                Path(processed_path).unlink()
            else:
                print(f"\nTo save the cropped image, provide an output path:")
                print(f"  python test_preprocessing.py {input_path} output.png")
        else:
            print("✗ No significant borders detected")
            print(f"  Original image: {processed_path}")
            print("\nThis could mean:")
            print("  - The image has no black borders")
            print("  - The borders are too small to be significant")
            print("  - The image content touches the edges")

        print()
        print("Test completed successfully!")

    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()

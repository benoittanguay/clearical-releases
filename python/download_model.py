"""
Download nanoLLaVA Model Script

This script downloads the qnguyen3/nanoLLaVA model from HuggingFace
and saves it to a local directory for bundling with PyInstaller.

Usage:
    python download_model.py

The model will be saved to: python/models/nanoLLaVA/
"""

import sys
import logging
from pathlib import Path

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def download_model(model_id: str = "qnguyen3/nanoLLaVA", target_dir: str = "models/nanoLLaVA"):
    """
    Download the nanoLLaVA model from HuggingFace.

    Args:
        model_id: HuggingFace model identifier
        target_dir: Local directory to save the model
    """
    try:
        from huggingface_hub import snapshot_download

        # Get absolute path to target directory
        script_dir = Path(__file__).parent
        model_path = script_dir / target_dir

        logger.info(f"Downloading model '{model_id}' to '{model_path}'...")
        logger.info("This may take several minutes (model size: ~500MB-1GB)")

        # Create target directory if it doesn't exist
        model_path.mkdir(parents=True, exist_ok=True)

        # Download the model using HuggingFace Hub
        # This downloads all necessary files (config, weights, tokenizer, etc.)
        downloaded_path = snapshot_download(
            repo_id=model_id,
            local_dir=str(model_path),
            local_dir_use_symlinks=False,  # Copy files instead of symlinking
            resume_download=True,  # Resume if interrupted
        )

        logger.info(f"Model downloaded successfully to: {downloaded_path}")
        logger.info("\nDownloaded files:")

        # List downloaded files
        for item in sorted(model_path.rglob("*")):
            if item.is_file():
                size_mb = item.stat().st_size / (1024 * 1024)
                logger.info(f"  {item.relative_to(model_path)} ({size_mb:.2f} MB)")

        return str(model_path)

    except ImportError as e:
        logger.error("huggingface_hub not installed. Install with: pip install huggingface_hub")
        raise ImportError(
            "huggingface_hub package not found. Install it with: pip install huggingface_hub"
        ) from e
    except Exception as e:
        logger.error(f"Failed to download model: {str(e)}")
        raise RuntimeError(f"Model download failed: {str(e)}") from e


def verify_model(model_dir: str = "models/nanoLLaVA"):
    """
    Verify that the downloaded model is valid and complete.

    Args:
        model_dir: Directory containing the model

    Returns:
        bool: True if model is valid
    """
    script_dir = Path(__file__).parent
    model_path = script_dir / model_dir

    logger.info(f"Verifying model at: {model_path}")

    # Check if directory exists
    if not model_path.exists():
        logger.error("Model directory does not exist")
        return False

    # Check for required files (nanoLLaVA doesn't include preprocessor_config.json)
    required_files = [
        "config.json",
    ]

    missing_files = []
    for file in required_files:
        if not (model_path / file).exists():
            missing_files.append(file)

    if missing_files:
        logger.error(f"Missing required files: {missing_files}")
        return False

    # Check for model weights (should have .safetensors or .bin files)
    weight_files = list(model_path.glob("*.safetensors")) + list(model_path.glob("*.bin"))
    if not weight_files:
        logger.error("No model weight files found (.safetensors or .bin)")
        return False

    logger.info("Model verification passed")
    logger.info(f"Found {len(weight_files)} weight file(s)")

    return True


def main():
    """Main entry point."""
    logger.info("=" * 60)
    logger.info("nanoLLaVA Model Downloader")
    logger.info("=" * 60)

    try:
        # Download the model
        model_path = download_model()

        # Verify the download
        if verify_model():
            logger.info("\n" + "=" * 60)
            logger.info("SUCCESS: Model downloaded and verified")
            logger.info(f"Model location: {model_path}")
            logger.info("=" * 60)
            logger.info("\nYou can now run the build script:")
            logger.info("  python build_server.py")
            return 0
        else:
            logger.error("\n" + "=" * 60)
            logger.error("ERROR: Model verification failed")
            logger.error("=" * 60)
            return 1

    except Exception as e:
        logger.error(f"\nFailed to download model: {str(e)}", exc_info=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())

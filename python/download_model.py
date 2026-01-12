"""
Download MLX Models Script

This script downloads the required MLX models from HuggingFace
and saves them to a local directory for bundling with PyInstaller.

Models downloaded:
  - mlx-community/nanoLLaVA-1.5-4bit (vision model)
  - mlx-community/Qwen2.5-0.5B-Instruct-4bit (reasoning model)

Usage:
    python download_model.py

The models will be saved to:
  - python/models/nanoLLaVA-1.5-4bit/
  - python/models/Qwen2.5-0.5B-Instruct-4bit/
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

# Model configurations
MODELS = [
    {
        "id": "mlx-community/nanoLLaVA-1.5-4bit",
        "target_dir": "models/nanoLLaVA-1.5-4bit",
        "description": "Vision model (4-bit quantized)",
        "size_estimate": "~200-400MB"
    },
    {
        "id": "mlx-community/Qwen2.5-0.5B-Instruct-4bit",
        "target_dir": "models/Qwen2.5-0.5B-Instruct-4bit",
        "description": "Reasoning model (4-bit quantized)",
        "size_estimate": "~300-500MB"
    }
]


def download_model(model_id: str, target_dir: str, description: str = "", size_estimate: str = ""):
    """
    Download a model from HuggingFace.

    Args:
        model_id: HuggingFace model identifier
        target_dir: Local directory to save the model
        description: Human-readable description of the model
        size_estimate: Estimated download size

    Returns:
        str: Path to the downloaded model
    """
    try:
        from huggingface_hub import snapshot_download

        # Get absolute path to target directory
        script_dir = Path(__file__).parent
        model_path = script_dir / target_dir

        logger.info(f"Downloading '{model_id}' to '{model_path}'...")
        if description:
            logger.info(f"  Description: {description}")
        if size_estimate:
            logger.info(f"  Estimated size: {size_estimate}")

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
        logger.info("Downloaded files:")

        # List downloaded files
        total_size = 0
        for item in sorted(model_path.rglob("*")):
            if item.is_file():
                size_mb = item.stat().st_size / (1024 * 1024)
                total_size += size_mb
                logger.info(f"  {item.relative_to(model_path)} ({size_mb:.2f} MB)")

        logger.info(f"Total size: {total_size:.2f} MB")

        return str(model_path)

    except ImportError as e:
        logger.error("huggingface_hub not installed. Install with: pip install huggingface_hub")
        raise ImportError(
            "huggingface_hub package not found. Install it with: pip install huggingface_hub"
        ) from e
    except Exception as e:
        logger.error(f"Failed to download model: {str(e)}")
        raise RuntimeError(f"Model download failed: {str(e)}") from e


def verify_model(model_dir: str, model_id: str = ""):
    """
    Verify that a downloaded model is valid and complete.

    Args:
        model_dir: Directory containing the model
        model_id: Model identifier for logging

    Returns:
        bool: True if model is valid
    """
    script_dir = Path(__file__).parent
    model_path = script_dir / model_dir

    display_name = model_id or model_dir
    logger.info(f"Verifying model '{display_name}' at: {model_path}")

    # Check if directory exists
    if not model_path.exists():
        logger.error(f"Model directory does not exist: {model_path}")
        return False

    # Check for required files
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

    logger.info(f"Model '{display_name}' verification passed")
    logger.info(f"Found {len(weight_files)} weight file(s)")

    return True


def download_all_models():
    """
    Download all required models.

    Returns:
        dict: Dictionary mapping model IDs to their local paths
    """
    downloaded_paths = {}

    for model_config in MODELS:
        logger.info("\n" + "-" * 60)
        path = download_model(
            model_id=model_config["id"],
            target_dir=model_config["target_dir"],
            description=model_config["description"],
            size_estimate=model_config["size_estimate"]
        )
        downloaded_paths[model_config["id"]] = path

    return downloaded_paths


def verify_all_models():
    """
    Verify all downloaded models.

    Returns:
        bool: True if all models are valid
    """
    all_valid = True

    for model_config in MODELS:
        logger.info("\n" + "-" * 60)
        if not verify_model(model_config["target_dir"], model_config["id"]):
            all_valid = False

    return all_valid


def main():
    """Main entry point."""
    logger.info("=" * 60)
    logger.info("MLX Models Downloader")
    logger.info("=" * 60)
    logger.info(f"Models to download: {len(MODELS)}")
    for model_config in MODELS:
        logger.info(f"  - {model_config['id']} ({model_config['description']})")

    try:
        # Download all models
        downloaded_paths = download_all_models()

        # Verify all downloads
        logger.info("\n" + "=" * 60)
        logger.info("Verifying downloaded models...")
        logger.info("=" * 60)

        if verify_all_models():
            logger.info("\n" + "=" * 60)
            logger.info("SUCCESS: All models downloaded and verified")
            logger.info("=" * 60)
            logger.info("\nModel locations:")
            for model_id, path in downloaded_paths.items():
                logger.info(f"  {model_id}: {path}")
            logger.info("\nYou can now run the build script:")
            logger.info("  python build_server.py")
            return 0
        else:
            logger.error("\n" + "=" * 60)
            logger.error("ERROR: One or more model verifications failed")
            logger.error("=" * 60)
            return 1

    except Exception as e:
        logger.error(f"\nFailed to download models: {str(e)}", exc_info=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())

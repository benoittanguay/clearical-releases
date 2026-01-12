#!/usr/bin/env python3
"""
FastVLM Server Build Script

This script builds a standalone macOS executable of the FastVLM server
using PyInstaller. It bundles the server code, all dependencies, and
the models (nanoLLaVA-1.5-4bit and Qwen2.5-0.5B-Instruct-4bit) into a single-folder distribution.

Prerequisites:
    1. Run download_model.py first to download the model
    2. Install PyInstaller: pip install pyinstaller

Usage:
    python build_server.py [--clean]

Options:
    --clean    Remove build artifacts before building

Output:
    python/dist/fastvlm-server/    - Standalone executable bundle
    python/dist/fastvlm-server/fastvlm-server    - Main executable
"""

import sys
import os
import shutil
import subprocess
import logging
from pathlib import Path

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def check_prerequisites():
    """
    Check that all prerequisites are met before building.

    Returns:
        bool: True if all prerequisites are met

    Raises:
        SystemExit: If critical prerequisites are missing
    """
    logger.info("Checking prerequisites...")

    # Get script directory
    script_dir = Path(__file__).parent
    errors = []
    warnings = []

    # 1. Check Python version
    if sys.version_info < (3, 8):
        errors.append(f"Python 3.8+ required, found {sys.version_info.major}.{sys.version_info.minor}")

    # 2. Check for PyInstaller
    try:
        import PyInstaller
        logger.info(f"  PyInstaller: {PyInstaller.__version__}")
    except ImportError:
        errors.append("PyInstaller not installed. Install with: pip install pyinstaller")

    # 3. Check for required packages
    required_packages = [
        ('mlx_vlm', 'mlx-vlm'),
        ('fastapi', 'fastapi'),
        ('uvicorn', 'uvicorn'),
        ('pydantic', 'pydantic'),
        ('PIL', 'pillow'),
        ('huggingface_hub', 'huggingface_hub'),
    ]

    for package_name, install_name in required_packages:
        try:
            __import__(package_name)
            logger.info(f"  {install_name}: installed")
        except ImportError:
            errors.append(f"{install_name} not installed. Install with: pip install {install_name}")

    # 4. Check for VLM model directory (nanoLLaVA-1.5-4bit)
    vlm_model_dir = script_dir / "models" / "nanoLLaVA-1.5-4bit"
    if not vlm_model_dir.exists():
        errors.append(
            f"VLM model directory not found: {vlm_model_dir}\n"
            "    Run: python download_model.py"
        )
    else:
        # Check model size
        total_size = sum(f.stat().st_size for f in vlm_model_dir.rglob('*') if f.is_file())
        size_mb = total_size / (1024 * 1024)
        logger.info(f"  VLM model directory: {vlm_model_dir} ({size_mb:.1f} MB)")

        # Check for required model files (nanoLLaVA doesn't include preprocessor_config.json)
        required_files = ['config.json']
        for file in required_files:
            if not (vlm_model_dir / file).exists():
                warnings.append(f"VLM model file missing: {file}")

    # 5. Check for reasoning model directory (Qwen2.5-0.5B-Instruct-4bit)
    reasoning_model_dir = script_dir / "models" / "Qwen2.5-0.5B-Instruct-4bit"
    if not reasoning_model_dir.exists():
        errors.append(
            f"Reasoning model directory not found: {reasoning_model_dir}\n"
            "    Run: python download_model.py"
        )
    else:
        # Check model size
        total_size = sum(f.stat().st_size for f in reasoning_model_dir.rglob('*') if f.is_file())
        size_mb = total_size / (1024 * 1024)
        logger.info(f"  Reasoning model directory: {reasoning_model_dir} ({size_mb:.1f} MB)")

        # Check for required model files
        required_files = ['config.json']
        for file in required_files:
            if not (reasoning_model_dir / file).exists():
                warnings.append(f"Reasoning model file missing: {file}")

    # 6. Check for spec file
    spec_file = script_dir / "fastvlm.spec"
    if not spec_file.exists():
        errors.append(f"PyInstaller spec file not found: {spec_file}")
    else:
        logger.info(f"  Spec file: {spec_file}")

    # 7. Check platform
    if sys.platform != 'darwin':
        warnings.append(f"This build is designed for macOS, but running on: {sys.platform}")

    # 8. Check architecture
    import platform
    arch = platform.machine()
    logger.info(f"  Architecture: {arch}")
    if arch != 'arm64':
        warnings.append(f"This build targets arm64, but running on: {arch}")

    # Display results
    if warnings:
        logger.warning("Warnings:")
        for warning in warnings:
            logger.warning(f"  {warning}")

    if errors:
        logger.error("Errors:")
        for error in errors:
            logger.error(f"  {error}")
        logger.error("\nPrerequisites check failed!")
        return False

    logger.info("Prerequisites check passed")
    return True


def clean_build_artifacts():
    """
    Remove previous build artifacts.
    """
    logger.info("Cleaning build artifacts...")

    script_dir = Path(__file__).parent
    directories_to_remove = [
        script_dir / "build",
        script_dir / "dist",
        script_dir / "__pycache__",
    ]

    for directory in directories_to_remove:
        if directory.exists():
            logger.info(f"  Removing: {directory}")
            shutil.rmtree(directory)

    logger.info("Build artifacts cleaned")


def run_pyinstaller():
    """
    Run PyInstaller to build the executable.

    Returns:
        bool: True if build succeeded
    """
    logger.info("Running PyInstaller...")

    script_dir = Path(__file__).parent
    spec_file = script_dir / "fastvlm.spec"

    # Build command
    cmd = [
        sys.executable,  # Use current Python interpreter
        "-m", "PyInstaller",
        "--clean",  # Clean PyInstaller cache
        "--noconfirm",  # Don't ask for confirmation
        str(spec_file),
    ]

    logger.info(f"  Command: {' '.join(cmd)}")

    try:
        # Run PyInstaller
        result = subprocess.run(
            cmd,
            cwd=str(script_dir),
            check=True,
            capture_output=True,
            text=True
        )

        # Log output
        if result.stdout:
            logger.debug(result.stdout)

        logger.info("PyInstaller build completed successfully")
        return True

    except subprocess.CalledProcessError as e:
        logger.error("PyInstaller build failed!")
        logger.error(f"Exit code: {e.returncode}")

        if e.stdout:
            logger.error("STDOUT:")
            logger.error(e.stdout)

        if e.stderr:
            logger.error("STDERR:")
            logger.error(e.stderr)

        return False


def verify_build():
    """
    Verify that the build output is valid.

    Returns:
        bool: True if build output is valid
    """
    logger.info("Verifying build output...")

    script_dir = Path(__file__).parent
    dist_dir = script_dir / "dist" / "fastvlm-server"
    executable = dist_dir / "fastvlm-server"

    # Check if dist directory exists
    if not dist_dir.exists():
        logger.error(f"Build output directory not found: {dist_dir}")
        return False

    # Check if executable exists
    if not executable.exists():
        logger.error(f"Executable not found: {executable}")
        return False

    # Check if executable is actually executable
    if not os.access(executable, os.X_OK):
        logger.warning(f"Executable does not have execute permissions: {executable}")
        logger.info("Attempting to fix permissions...")
        try:
            executable.chmod(0o755)
            logger.info("Permissions fixed")
        except Exception as e:
            logger.error(f"Failed to fix permissions: {e}")
            return False

    # Calculate total size
    total_size = sum(f.stat().st_size for f in dist_dir.rglob('*') if f.is_file())
    size_mb = total_size / (1024 * 1024)

    logger.info(f"  Executable: {executable}")
    logger.info(f"  Total size: {size_mb:.1f} MB")

    # Check for bundled VLM model (PyInstaller puts data in _internal/)
    bundled_vlm_model = dist_dir / "_internal" / "nanoLLaVA-1.5-4bit"
    if bundled_vlm_model.exists():
        model_files = list(bundled_vlm_model.rglob('*'))
        logger.info(f"  Bundled VLM model: {bundled_vlm_model} ({len(model_files)} files)")
    else:
        logger.warning(f"  Bundled VLM model not found: {bundled_vlm_model}")
        logger.warning("  VLM model will need to be downloaded on first run")

    # Check for bundled reasoning model (PyInstaller puts data in _internal/)
    bundled_reasoning_model = dist_dir / "_internal" / "Qwen2.5-0.5B-Instruct-4bit"
    if bundled_reasoning_model.exists():
        model_files = list(bundled_reasoning_model.rglob('*'))
        logger.info(f"  Bundled reasoning model: {bundled_reasoning_model} ({len(model_files)} files)")
    else:
        logger.warning(f"  Bundled reasoning model not found: {bundled_reasoning_model}")
        logger.warning("  Reasoning model will need to be downloaded on first run")

    logger.info("Build verification passed")
    return True


def print_usage_instructions():
    """
    Print instructions for using the built executable.
    """
    script_dir = Path(__file__).parent
    dist_dir = script_dir / "dist" / "fastvlm-server"
    executable = dist_dir / "fastvlm-server"

    logger.info("\n" + "=" * 60)
    logger.info("BUILD SUCCESSFUL")
    logger.info("=" * 60)
    logger.info("\nThe FastVLM server has been built successfully!")
    logger.info(f"\nExecutable location:")
    logger.info(f"  {executable}")
    logger.info(f"\nTo run the server:")
    logger.info(f"  {executable}")
    logger.info(f"  {executable} --port 5123")
    logger.info(f"\nThe server will start on http://localhost:5123")
    logger.info("\nEndpoints:")
    logger.info("  GET  /           - Server information")
    logger.info("  GET  /health     - Health check")
    logger.info("  POST /analyze    - Analyze screenshot")
    logger.info("  POST /shutdown   - Shutdown server")
    logger.info("\n" + "=" * 60)


def main():
    """Main entry point."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Build FastVLM server standalone executable"
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Clean build artifacts before building"
    )

    args = parser.parse_args()

    logger.info("=" * 60)
    logger.info("FastVLM Server Build Script")
    logger.info("=" * 60)

    # Step 1: Check prerequisites
    if not check_prerequisites():
        logger.error("\nBuild aborted due to missing prerequisites")
        return 1

    # Step 2: Clean if requested
    if args.clean:
        clean_build_artifacts()

    # Step 3: Run PyInstaller
    logger.info("\n" + "=" * 60)
    logger.info("Building executable...")
    logger.info("=" * 60)

    if not run_pyinstaller():
        logger.error("\nBuild failed!")
        return 1

    # Step 4: Verify build
    logger.info("\n" + "=" * 60)
    logger.info("Verifying build...")
    logger.info("=" * 60)

    if not verify_build():
        logger.error("\nBuild verification failed!")
        return 1

    # Step 5: Print usage instructions
    print_usage_instructions()

    return 0


if __name__ == "__main__":
    sys.exit(main())

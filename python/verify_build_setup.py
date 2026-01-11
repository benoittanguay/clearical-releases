#!/usr/bin/env python3
"""
Build System Verification Script

This script verifies that all build system files are present and correctly configured.
Run this before attempting to build to ensure everything is set up properly.

Usage:
    python verify_build_setup.py
"""

import sys
import os
from pathlib import Path
from typing import List, Tuple

# ANSI color codes for output
class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    END = '\033[0m'
    BOLD = '\033[1m'

def print_header(text: str):
    """Print a section header."""
    print(f"\n{Colors.BOLD}{Colors.BLUE}{'='*60}{Colors.END}")
    print(f"{Colors.BOLD}{Colors.BLUE}{text}{Colors.END}")
    print(f"{Colors.BOLD}{Colors.BLUE}{'='*60}{Colors.END}\n")

def print_success(text: str):
    """Print a success message."""
    print(f"{Colors.GREEN}✓{Colors.END} {text}")

def print_error(text: str):
    """Print an error message."""
    print(f"{Colors.RED}✗{Colors.END} {text}")

def print_warning(text: str):
    """Print a warning message."""
    print(f"{Colors.YELLOW}⚠{Colors.END} {text}")

def print_info(text: str):
    """Print an info message."""
    print(f"{Colors.BLUE}ℹ{Colors.END} {text}")

def check_file_exists(file_path: Path, description: str) -> bool:
    """Check if a file exists."""
    if file_path.exists():
        size = file_path.stat().st_size
        size_kb = size / 1024
        print_success(f"{description}: {file_path.name} ({size_kb:.1f} KB)")
        return True
    else:
        print_error(f"{description} not found: {file_path}")
        return False

def check_python_version() -> bool:
    """Check if Python version is adequate."""
    version_info = sys.version_info
    version_str = f"{version_info.major}.{version_info.minor}.{version_info.micro}"

    if version_info.major < 3 or (version_info.major == 3 and version_info.minor < 8):
        print_error(f"Python 3.8+ required, found {version_str}")
        return False
    else:
        print_success(f"Python version: {version_str}")
        return True

def check_package_installed(package_name: str, import_name: str = None) -> bool:
    """Check if a Python package is installed."""
    if import_name is None:
        import_name = package_name

    try:
        __import__(import_name)
        print_success(f"Package installed: {package_name}")
        return True
    except ImportError:
        print_error(f"Package not installed: {package_name}")
        print_info(f"  Install with: pip install {package_name}")
        return False

def check_directory_structure(base_dir: Path) -> Tuple[List[str], List[str]]:
    """Check the directory structure."""
    required_files = [
        ('download_model.py', 'Model download script'),
        ('build_server.py', 'Build orchestration script'),
        ('fastvlm.spec', 'PyInstaller spec file'),
        ('server.py', 'FastAPI server'),
        ('inference.py', 'Inference module'),
        ('requirements.txt', 'Python dependencies'),
        ('BUILD_README.md', 'Build documentation'),
        ('BUILD_QUICKSTART.md', 'Quick start guide'),
        ('BUILD_SUMMARY.md', 'Build system summary'),
        ('example_build_workflow.sh', 'Automated workflow script'),
    ]

    found = []
    missing = []

    for filename, description in required_files:
        file_path = base_dir / filename
        if check_file_exists(file_path, description):
            found.append(filename)
        else:
            missing.append(filename)

    return found, missing

def check_inference_updated(inference_file: Path) -> bool:
    """Check if inference.py has been updated with model path resolution."""
    try:
        with open(inference_file, 'r') as f:
            content = f.read()

        # Check for the new function
        if 'def get_model_path()' in content:
            print_success("inference.py: Updated with model path resolution")
            return True
        else:
            print_error("inference.py: Missing get_model_path() function")
            print_info("  The file may need to be updated")
            return False
    except Exception as e:
        print_error(f"Error reading inference.py: {e}")
        return False

def check_requirements_updated(requirements_file: Path) -> bool:
    """Check if requirements.txt includes build dependencies."""
    try:
        with open(requirements_file, 'r') as f:
            content = f.read()

        required_packages = ['pyinstaller', 'huggingface_hub']
        missing_packages = []

        for package in required_packages:
            if package.lower() in content.lower():
                print_success(f"requirements.txt includes: {package}")
            else:
                print_error(f"requirements.txt missing: {package}")
                missing_packages.append(package)

        return len(missing_packages) == 0
    except Exception as e:
        print_error(f"Error reading requirements.txt: {e}")
        return False

def check_gitignore_updated(gitignore_file: Path) -> bool:
    """Check if .gitignore includes build artifacts."""
    if not gitignore_file.exists():
        print_warning(".gitignore not found")
        return False

    try:
        with open(gitignore_file, 'r') as f:
            content = f.read()

        required_entries = ['build/', 'dist/', 'models/']
        missing_entries = []

        for entry in required_entries:
            if entry in content:
                print_success(f".gitignore includes: {entry}")
            else:
                print_warning(f".gitignore missing: {entry}")
                missing_entries.append(entry)

        return len(missing_entries) == 0
    except Exception as e:
        print_error(f"Error reading .gitignore: {e}")
        return False

def check_model_downloaded(base_dir: Path) -> bool:
    """Check if model has been downloaded."""
    model_dir = base_dir / 'models' / 'nanoLLaVA'

    if not model_dir.exists():
        print_warning("Model not downloaded yet")
        print_info("  Run: python download_model.py")
        return False

    # Check for required files
    required_files = ['config.json', 'preprocessor_config.json']
    all_present = True

    for filename in required_files:
        file_path = model_dir / filename
        if file_path.exists():
            print_success(f"Model file present: {filename}")
        else:
            print_error(f"Model file missing: {filename}")
            all_present = False

    # Check for weight files
    weight_files = list(model_dir.glob('*.safetensors')) + list(model_dir.glob('*.bin'))
    if weight_files:
        print_success(f"Model weights found: {len(weight_files)} file(s)")

        # Calculate total size
        total_size = sum(f.stat().st_size for f in model_dir.rglob('*') if f.is_file())
        size_mb = total_size / (1024 * 1024)
        print_info(f"  Total model size: {size_mb:.1f} MB")
    else:
        print_error("No model weight files found")
        all_present = False

    return all_present

def main():
    """Main verification function."""
    print_header("Build System Verification")

    # Get script directory
    script_dir = Path(__file__).parent.resolve()
    print_info(f"Checking directory: {script_dir}\n")

    all_checks = []

    # Check 1: Python version
    print_header("Python Environment")
    all_checks.append(check_python_version())

    # Check 2: Required packages
    print("\n")
    required_packages = [
        ('fastapi', 'fastapi'),
        ('uvicorn', 'uvicorn'),
        ('mlx-vlm', 'mlx_vlm'),
        ('pydantic', 'pydantic'),
        ('pillow', 'PIL'),
        ('huggingface_hub', 'huggingface_hub'),
        ('pyinstaller', 'PyInstaller'),
    ]

    for package_name, import_name in required_packages:
        all_checks.append(check_package_installed(package_name, import_name))

    # Check 3: File structure
    print_header("Build System Files")
    found, missing = check_directory_structure(script_dir)
    all_checks.append(len(missing) == 0)

    # Check 4: File updates
    print_header("File Updates")
    all_checks.append(check_inference_updated(script_dir / 'inference.py'))
    all_checks.append(check_requirements_updated(script_dir / 'requirements.txt'))
    all_checks.append(check_gitignore_updated(script_dir / '.gitignore'))

    # Check 5: Model download
    print_header("Model Files")
    model_downloaded = check_model_downloaded(script_dir)
    # Don't fail if model not downloaded (it's optional at this stage)

    # Check 6: Build artifacts
    print_header("Build Artifacts")
    if (script_dir / 'build').exists():
        print_info("build/ directory exists (previous build)")
    if (script_dir / 'dist').exists():
        print_info("dist/ directory exists (previous build)")

        executable = script_dir / 'dist' / 'fastvlm-server' / 'fastvlm-server'
        if executable.exists():
            size = sum(f.stat().st_size for f in (script_dir / 'dist' / 'fastvlm-server').rglob('*') if f.is_file())
            size_mb = size / (1024 * 1024)
            print_success(f"Built executable found ({size_mb:.1f} MB)")

    # Summary
    print_header("Verification Summary")

    passed = sum(all_checks)
    total = len(all_checks)

    if all(all_checks):
        print_success(f"All checks passed ({passed}/{total})")
        print("\n")
        print_info("Your build system is ready!")
        print_info("Next steps:")
        if not model_downloaded:
            print_info("  1. Download model: python download_model.py")
            print_info("  2. Build executable: python build_server.py")
        else:
            print_info("  1. Build executable: python build_server.py")
        return 0
    else:
        print_error(f"Some checks failed ({total-passed}/{total} failed)")
        print("\n")
        print_info("Please address the issues above before building.")

        # Provide helpful suggestions
        if any('not installed' in str(c) for c in all_checks):
            print_info("\nTo install missing packages:")
            print_info("  pip install -r requirements.txt")

        return 1

if __name__ == '__main__':
    sys.exit(main())

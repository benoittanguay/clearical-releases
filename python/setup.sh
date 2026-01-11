#!/bin/bash

# FastVLM Inference Server Setup Script
# This script sets up the Python environment and installs dependencies

set -e  # Exit on error

echo "=================================="
echo "FastVLM Inference Server Setup"
echo "=================================="
echo

# Check Python version
if ! command -v python3 &> /dev/null; then
    echo "Error: python3 not found"
    echo "Please install Python 3.9+ first"
    exit 1
fi

PYTHON_VERSION=$(python3 --version | cut -d' ' -f2 | cut -d'.' -f1,2)
echo "Found Python $PYTHON_VERSION"

# Check if we're on macOS with Apple Silicon
if [[ "$(uname)" == "Darwin" ]]; then
    ARCH=$(uname -m)
    if [[ "$ARCH" == "arm64" ]]; then
        echo "✓ Running on Apple Silicon (M-series)"
    else
        echo "⚠ Warning: Not on Apple Silicon"
        echo "  MLX is optimized for M-series Macs"
        echo "  Performance may be degraded"
    fi
else
    echo "⚠ Warning: Not on macOS"
    echo "  MLX requires macOS"
    exit 1
fi

echo

# Create virtual environment
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
    echo "✓ Virtual environment created"
else
    echo "✓ Virtual environment already exists"
fi

echo

# Activate virtual environment
echo "Activating virtual environment..."
source venv/bin/activate

# Upgrade pip
echo "Upgrading pip..."
pip install --upgrade pip > /dev/null

echo

# Install dependencies
echo "Installing dependencies..."
pip install -r requirements.txt

echo
echo "=================================="
echo "Setup Complete!"
echo "=================================="
echo
echo "To start the server:"
echo "  1. Activate the virtual environment:"
echo "     source venv/bin/activate"
echo
echo "  2. Start the server:"
echo "     python server.py"
echo
echo "  3. Test the server:"
echo "     curl http://localhost:5123/health"
echo
echo "Note: First startup will download the FastVLM model (~500MB)"
echo "      This only happens once."
echo

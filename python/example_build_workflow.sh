#!/bin/bash
#
# FastVLM Server - Complete Build Workflow Example
#
# This script demonstrates the complete workflow from setup to distribution.
# Run this to build a production-ready standalone executable.
#
# Usage:
#   chmod +x example_build_workflow.sh
#   ./example_build_workflow.sh
#

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

echo_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

echo_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

echo_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "============================================================"
echo "FastVLM Server - Build Workflow"
echo "============================================================"
echo ""

# Step 1: Check Python version
echo_info "Checking Python version..."
PYTHON_VERSION=$(python3 --version 2>&1 | awk '{print $2}')
PYTHON_MAJOR=$(echo $PYTHON_VERSION | cut -d. -f1)
PYTHON_MINOR=$(echo $PYTHON_VERSION | cut -d. -f2)

if [ "$PYTHON_MAJOR" -lt 3 ] || ([ "$PYTHON_MAJOR" -eq 3 ] && [ "$PYTHON_MINOR" -lt 8 ]); then
    echo_error "Python 3.8+ required, found $PYTHON_VERSION"
    exit 1
fi

echo_success "Python $PYTHON_VERSION detected"
echo ""

# Step 2: Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo_info "Creating virtual environment..."
    python3 -m venv venv
    echo_success "Virtual environment created"
else
    echo_info "Virtual environment already exists"
fi
echo ""

# Step 3: Activate virtual environment
echo_info "Activating virtual environment..."
source venv/bin/activate
echo ""

# Step 4: Install dependencies
echo_info "Installing dependencies..."
pip install -q --upgrade pip
pip install -q -r requirements.txt
echo_success "Dependencies installed"
echo ""

# Step 5: Check if model is already downloaded
if [ -d "models/nanoLLaVA" ]; then
    echo_warning "Model directory already exists at models/nanoLLaVA"
    echo_info "Skipping download. Delete the directory to re-download."
    echo ""
else
    # Download model
    echo_info "Downloading nanoLLaVA model (this may take 5-10 minutes)..."
    python download_model.py
    echo ""
fi

# Step 6: Clean previous build artifacts (optional)
if [ -d "build" ] || [ -d "dist" ]; then
    echo_info "Cleaning previous build artifacts..."
    rm -rf build dist
    echo_success "Build artifacts cleaned"
    echo ""
fi

# Step 7: Build the executable
echo_info "Building standalone executable (this may take 2-5 minutes)..."
python build_server.py --clean
echo ""

# Step 8: Verify the build
if [ ! -f "dist/fastvlm-server/fastvlm-server" ]; then
    echo_error "Build failed! Executable not found."
    exit 1
fi

echo_success "Build completed successfully!"
echo ""

# Step 9: Display build info
echo "============================================================"
echo "Build Information"
echo "============================================================"
EXECUTABLE="dist/fastvlm-server/fastvlm-server"
SIZE=$(du -sh dist/fastvlm-server | awk '{print $1}')
echo "Executable: $SCRIPT_DIR/$EXECUTABLE"
echo "Total size: $SIZE"
echo ""

# Step 10: Test the executable
echo_info "Testing the executable..."
chmod +x "$EXECUTABLE"

# Start server in background
echo_info "Starting server..."
"$EXECUTABLE" --port 5123 > server_test.log 2>&1 &
SERVER_PID=$!

# Wait for server to start
echo_info "Waiting for server to start (10 seconds)..."
sleep 10

# Check if server is running
if ! ps -p $SERVER_PID > /dev/null 2>&1; then
    echo_error "Server failed to start. Check server_test.log for details."
    cat server_test.log
    exit 1
fi

# Test health endpoint
echo_info "Testing health endpoint..."
HEALTH_RESPONSE=$(curl -s http://localhost:5123/health)

if [ $? -eq 0 ]; then
    echo_success "Health check passed!"
    echo "Response: $HEALTH_RESPONSE"
else
    echo_error "Health check failed!"
    kill $SERVER_PID
    exit 1
fi

# Shutdown server
echo_info "Shutting down test server..."
curl -s -X POST http://localhost:5123/shutdown > /dev/null
sleep 2

# Clean up
if ps -p $SERVER_PID > /dev/null 2>&1; then
    kill $SERVER_PID 2>/dev/null || true
fi

echo ""
echo "============================================================"
echo "Build Workflow Complete!"
echo "============================================================"
echo ""
echo "Your standalone executable is ready:"
echo "  $SCRIPT_DIR/$EXECUTABLE"
echo ""
echo "To run the server:"
echo "  ./$EXECUTABLE"
echo "  ./$EXECUTABLE --port 5123"
echo ""
echo "To create a distribution archive:"
echo "  cd dist"
echo "  zip -r fastvlm-server.zip fastvlm-server/"
echo ""
echo "The server will start on http://localhost:5123"
echo ""
echo "API Endpoints:"
echo "  GET  /           - Server information"
echo "  GET  /health     - Health check"
echo "  POST /analyze    - Analyze screenshot"
echo "  POST /shutdown   - Shutdown server"
echo ""
echo_success "Done!"

#!/bin/bash

# Build script for the Screenshot Analyzer Swift helper
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"
SOURCE_FILE="$SCRIPT_DIR/main.swift"
EXECUTABLE="$BUILD_DIR/screenshot-analyzer"

echo "🔨 Building Screenshot Analyzer..."
echo "📁 Source: $SOURCE_FILE"
echo "🎯 Output: $EXECUTABLE"

# Create build directory
mkdir -p "$BUILD_DIR"

# Check if running on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo "❌ Error: This helper can only be built on macOS (Apple Vision Framework requirement)"
    exit 1
fi

# Check for Swift compiler
if ! command -v swiftc &> /dev/null; then
    echo "❌ Error: Swift compiler not found. Please install Xcode Command Line Tools:"
    echo "   xcode-select --install"
    exit 1
fi

# Check macOS version (Vision Framework requires macOS 10.13+)
MACOS_VERSION=$(sw_vers -productVersion)
MACOS_MAJOR=$(echo "$MACOS_VERSION" | cut -d. -f1)
MACOS_MINOR=$(echo "$MACOS_VERSION" | cut -d. -f2)

if [[ $MACOS_MAJOR -lt 10 ]] || [[ $MACOS_MAJOR -eq 10 && $MACOS_MINOR -lt 13 ]]; then
    echo "❌ Error: Vision Framework requires macOS 10.13 or later (found $MACOS_VERSION)"
    exit 1
fi

echo "✅ macOS $MACOS_VERSION detected"
echo "✅ Swift compiler found"

# Build the executable
echo "🔨 Compiling Swift source..."
swiftc \
    -o "$EXECUTABLE" \
    -target x86_64-apple-macos10.15 \
    -import-objc-header /dev/null \
    -framework Vision \
    -framework AppKit \
    -framework CoreImage \
    -framework Foundation \
    "$SOURCE_FILE"

# Check if build was successful
if [[ -f "$EXECUTABLE" ]]; then
    echo "✅ Build successful!"
    echo "📦 Executable created: $EXECUTABLE"
    echo "🔍 File size: $(du -h "$EXECUTABLE" | cut -f1)"
    
    # Make it executable
    chmod +x "$EXECUTABLE"
    
    echo ""
    echo "🧪 Testing the executable..."
    echo "$EXECUTABLE" --version || echo "No version flag implemented"
    
    echo ""
    echo "📖 Usage:"
    echo "  JSON input: echo '{\"imagePath\": \"path/to/image.png\"}' | $EXECUTABLE"
    echo "  Direct:     $EXECUTABLE path/to/image.png"
    
else
    echo "❌ Build failed!"
    exit 1
fi
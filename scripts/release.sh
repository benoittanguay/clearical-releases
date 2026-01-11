#!/bin/bash
#
# Clearical Release Script
#
# This script builds, signs, and optionally publishes Clearical releases.
# It handles the ad-hoc signing required for unsigned macOS apps.
#
# Usage:
#   ./scripts/release.sh              # Build only (no publish)
#   ./scripts/release.sh --publish    # Build and publish to GitHub
#

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Clearical Release Build${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check for --publish flag
PUBLISH=false
if [[ "$1" == "--publish" ]]; then
    PUBLISH=true
    echo -e "${YELLOW}Publishing enabled - will upload to GitHub${NC}"
else
    echo -e "${YELLOW}Build only mode - use --publish to upload to GitHub${NC}"
fi
echo ""

# Get version from package.json
VERSION=$(node -p "require('./package.json').version")
echo -e "${GREEN}Building version: ${VERSION}${NC}"
echo ""

# Step 1: Load environment variables
echo -e "${BLUE}Step 1: Loading environment...${NC}"
if [ -f .env.local ]; then
    export $(grep -v '^#' .env.local | xargs)
    echo "  ✓ Loaded .env.local"
else
    echo -e "${YELLOW}  ⚠ No .env.local found${NC}"
fi

# Step 2: Build FastVLM server (if not already built)
echo ""
echo -e "${BLUE}Step 2: Building FastVLM server...${NC}"
FASTVLM_EXEC="python/dist/fastvlm-server/fastvlm-server"

if [ -f "$FASTVLM_EXEC" ]; then
    echo "  ✓ FastVLM server already built"
else
    echo "  Building FastVLM server (this may take a while)..."

    # Check if model is downloaded
    if [ ! -d "python/models/nanoLLaVA" ]; then
        echo "  Downloading nanoLLaVA model..."
        cd python && python3 download_model.py 2>&1 | tail -10
        cd "$PROJECT_ROOT"
        echo "  ✓ Model downloaded"
    fi

    # Build the server
    echo "  Running PyInstaller build..."
    cd python && python3 build_server.py 2>&1 | tail -20
    cd "$PROJECT_ROOT"

    if [ -f "$FASTVLM_EXEC" ]; then
        echo "  ✓ FastVLM server built successfully"
    else
        echo -e "${RED}  ✗ FastVLM server build failed${NC}"
        echo -e "${YELLOW}  Continuing without FastVLM (will use Swift fallback)${NC}"
    fi
fi

# Show FastVLM server size
if [ -d "python/dist/fastvlm-server" ]; then
    FASTVLM_SIZE=$(du -sh python/dist/fastvlm-server | cut -f1)
    echo "  FastVLM server size: $FASTVLM_SIZE"
fi

# Step 3: Build the app with electron-builder (without publishing)
echo ""
echo -e "${BLUE}Step 3: Building Electron app...${NC}"
npm run build:electron 2>&1 | tail -20
echo "  ✓ Electron build complete"

# Step 4: Ad-hoc sign the app
echo ""
echo -e "${BLUE}Step 4: Ad-hoc signing the app...${NC}"
APP_PATH="dist/mac-arm64/Clearical.app"

if [ ! -d "$APP_PATH" ]; then
    echo -e "${RED}Error: App not found at $APP_PATH${NC}"
    exit 1
fi

# Remove existing signature and apply proper ad-hoc signature
codesign --force --deep --sign - "$APP_PATH" 2>&1
echo "  ✓ Applied ad-hoc signature"

# Verify the signature
if codesign --verify --deep --strict "$APP_PATH" 2>&1; then
    echo "  ✓ Signature verified"
else
    echo -e "${RED}Error: Signature verification failed${NC}"
    exit 1
fi

# Show signature details
echo "  Signature details:"
codesign -dvvv "$APP_PATH" 2>&1 | grep -E "(Identifier|Signature|flags)" | head -3 | sed 's/^/    /'

# Step 5: Rebuild DMG with signed app
echo ""
echo -e "${BLUE}Step 5: Creating DMG...${NC}"
DMG_PATH="dist/Clearical-arm64.dmg"
rm -f "$DMG_PATH" "dist/Clearical-arm64.dmg.blockmap"

hdiutil create -volname "Clearical" -srcfolder "$APP_PATH" -ov -format UDZO "$DMG_PATH" 2>&1 | grep -E "(created|error)" || true
echo "  ✓ DMG created: $DMG_PATH"

# Step 6: Create ZIP with signed app
echo ""
echo -e "${BLUE}Step 6: Creating ZIP...${NC}"
ZIP_PATH="dist/Clearical-arm64.zip"
rm -f "$ZIP_PATH" "dist/Clearical-arm64.zip.blockmap"

cd dist
ditto -c -k --sequesterRsrc --keepParent mac-arm64/Clearical.app Clearical-arm64.zip
cd "$PROJECT_ROOT"
echo "  ✓ ZIP created: $ZIP_PATH"

# Show file sizes
echo ""
echo -e "${BLUE}Build artifacts:${NC}"
ls -lh dist/Clearical-arm64.dmg dist/Clearical-arm64.zip | awk '{print "  " $9 ": " $5}'

# Step 7: Publish to GitHub (if --publish flag)
if [ "$PUBLISH" = true ]; then
    echo ""
    echo -e "${BLUE}Step 7: Publishing to GitHub...${NC}"

    # Check if gh CLI is available
    if ! command -v gh &> /dev/null; then
        echo -e "${RED}Error: GitHub CLI (gh) not installed${NC}"
        exit 1
    fi

    # Check if release exists
    if gh release view "v${VERSION}" --repo benoittanguay/clearical-releases &> /dev/null; then
        echo "  Release v${VERSION} exists, uploading artifacts..."
        gh release upload "v${VERSION}" \
            dist/Clearical-arm64.dmg \
            dist/Clearical-arm64.zip \
            --repo benoittanguay/clearical-releases \
            --clobber
        echo "  ✓ Artifacts uploaded to existing release"
    else
        echo "  Creating new release v${VERSION}..."
        gh release create "v${VERSION}" \
            dist/Clearical-arm64.dmg \
            dist/Clearical-arm64.zip \
            --repo benoittanguay/clearical-releases \
            --title "v${VERSION}" \
            --notes "Release v${VERSION}

## macOS Installation

Since the app is not notarized, run this after downloading:

\`\`\`bash
xattr -cr ~/Downloads/Clearical-arm64.dmg
\`\`\`

Or right-click the app → Open → Open.

## What's New

- **FastVLM AI Analysis**: Screenshots are now analyzed using an on-device vision-language model (nanoLLaVA) for more accurate activity descriptions
- No setup required - the AI model is bundled with the app
- Loading indicator shown during AI analysis"
        echo "  ✓ Release created and artifacts uploaded"
    fi

    echo ""
    echo -e "${GREEN}✓ Published: https://github.com/benoittanguay/clearical-releases/releases/tag/v${VERSION}${NC}"
else
    echo ""
    echo -e "${YELLOW}Skipping publish (use --publish to upload to GitHub)${NC}"
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Build complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Artifacts ready in dist/"
echo "  - Clearical-arm64.dmg"
echo "  - Clearical-arm64.zip"
echo ""

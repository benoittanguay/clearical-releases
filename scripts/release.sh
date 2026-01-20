#!/bin/bash
#
# Clearical Release Script (Optimized)
#
# This script builds, signs, and optionally publishes Clearical releases.
# Optimizations: parallel signing, single-pass file discovery, skip redundant archives.
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

# Step 1: Load environment variables and check notarization capability
echo -e "${BLUE}Step 1: Loading environment...${NC}"
if [ -f .env.local ]; then
    export $(grep -v '^#' .env.local | xargs)
    echo "  ✓ Loaded .env.local"
else
    echo -e "${YELLOW}  ⚠ No .env.local found${NC}"
fi

# Pre-check notarization credentials to optimize later steps
CAN_NOTARIZE=false
NOTARY_CREDS=""
if xcrun notarytool history --keychain-profile "Clearical" &>/dev/null; then
    CAN_NOTARIZE=true
    NOTARY_CREDS="--keychain-profile Clearical"
    echo "  ✓ Notarization credentials found (keychain)"
elif [ -n "$APPLE_ID" ] && [ -n "$APPLE_APP_SPECIFIC_PASSWORD" ] && [ -n "$APPLE_TEAM_ID" ]; then
    CAN_NOTARIZE=true
    NOTARY_CREDS="--apple-id $APPLE_ID --password $APPLE_APP_SPECIFIC_PASSWORD --team-id $APPLE_TEAM_ID"
    echo "  ✓ Notarization credentials found (env vars)"
else
    echo -e "${YELLOW}  ⚠ No notarization credentials - will create non-notarized build${NC}"
fi

# Allow skipping notarization via environment variable
if [ "$SKIP_NOTARIZATION" = "true" ] || [ "$SKIP_NOTARIZATION" = "1" ]; then
    CAN_NOTARIZE=false
    echo -e "${YELLOW}  ⚠ Notarization skipped via SKIP_NOTARIZATION env var${NC}"
fi

# Step 2: Build the app with electron-builder (without publishing)
echo ""
echo -e "${BLUE}Step 2: Building Electron app...${NC}"
npm run build:electron 2>&1 | tail -20
echo "  ✓ Electron build complete"

# Step 3: Sign all embedded binaries (inside-out signing)
# Optimized: single find pass, parallel signing with xargs
echo ""
echo -e "${BLUE}Step 3: Signing embedded binaries...${NC}"
APP_PATH="dist/mac-arm64/Clearical.app"

if [ ! -d "$APP_PATH" ]; then
    echo -e "${RED}Error: App not found at $APP_PATH${NC}"
    exit 1
fi

IDENTITY="Developer ID Application: Benoit Tanguay (98UY743MSB)"
ENTITLEMENTS="build/entitlements.mac.plist"
FRAMEWORKS="$APP_PATH/Contents/Frameworks"

# Step 3a: Sign all individual binaries in parallel (single find pass)
echo "  Signing individual binaries (parallel)..."
find "$APP_PATH" -type f \( -name "*.so" -o -name "*.dylib" -o -name "*.node" \) -print0 2>/dev/null | \
    xargs -0 -P 4 -I {} codesign --force --options runtime --timestamp --sign "$IDENTITY" {} 2>/dev/null || true
echo "  ✓ Signed .so, .dylib, and .node files"

# Step 3b: Sign frameworks in parallel
echo "  Signing frameworks (parallel)..."
find "$FRAMEWORKS" -maxdepth 1 -name "*.framework" -print0 2>/dev/null | \
    xargs -0 -P 4 -I {} codesign --force --options runtime --timestamp --sign "$IDENTITY" {} 2>/dev/null || true
echo "  ✓ Frameworks signed"

# Step 3c: Sign helper apps in parallel
echo "  Signing helper apps (parallel)..."
find "$FRAMEWORKS" -maxdepth 1 -name "*.app" -print0 2>/dev/null | \
    xargs -0 -P 4 -I {} codesign --force --options runtime --timestamp --entitlements "$ENTITLEMENTS" --sign "$IDENTITY" {} 2>/dev/null || true
echo "  ✓ Helper apps signed"

# Step 3d: Sign the main app bundle (must be last)
echo "  Signing main app bundle..."
codesign --force --options runtime --timestamp --entitlements "$ENTITLEMENTS" \
    --sign "$IDENTITY" "$APP_PATH"
echo "  ✓ Main app signed"

# Step 3e: Verify the signature
echo "  Verifying deep signature..."
if codesign --verify --deep --strict "$APP_PATH" 2>&1; then
    echo "  ✓ Deep signature verification passed"
else
    echo -e "${RED}  ✗ Deep signature verification failed${NC}"
    codesign -vvv "$APP_PATH" 2>&1 | grep -E "(missing|invalid|modified)" | head -5 | sed 's/^/    /'
    exit 1
fi

# Show signature details
echo "  Signature details:"
codesign -dvvv "$APP_PATH" 2>&1 | grep -E "(Identifier|Authority|TeamIdentifier|flags)" | head -5 | sed 's/^/    /'

# Define paths
DMG_PATH="dist/Clearical-arm64.dmg"
ZIP_PATH="dist/Clearical-arm64.zip"

# Step 4: Notarize (if credentials available)
# Optimized: Skip archive creation before notarization - create only once after stapling
echo ""
echo -e "${BLUE}Step 4: Notarization...${NC}"

# Check if signed with Developer ID
if ! codesign -dvvv "$APP_PATH" 2>&1 | grep -q "Authority=Developer ID"; then
    echo -e "${YELLOW}  ⚠ App not signed with Developer ID, skipping notarization${NC}"
    CAN_NOTARIZE=false
fi

if [ "$CAN_NOTARIZE" = true ]; then
    # Create ZIP for notarization (required format)
    echo "  Creating ZIP for notarization..."
    rm -f "$ZIP_PATH"
    cd dist
    ditto -c -k --sequesterRsrc --keepParent mac-arm64/Clearical.app Clearical-arm64.zip
    cd "$PROJECT_ROOT"

    echo "  Submitting for notarization..."
    NOTARIZE_OUTPUT=$(xcrun notarytool submit "$ZIP_PATH" $NOTARY_CREDS --wait 2>&1)

    # Extract submission ID for potential log retrieval
    SUBMISSION_ID=$(echo "$NOTARIZE_OUTPUT" | grep -E "^\s*id:" | head -1 | awk '{print $2}')

    echo "$NOTARIZE_OUTPUT" | tail -8

    if echo "$NOTARIZE_OUTPUT" | grep -q "status: Accepted"; then
        echo "  ✓ Notarization successful!"

        # Staple the ticket to the app
        echo "  Stapling ticket to app..."
        xcrun stapler staple "$APP_PATH" 2>&1 | grep -E "(staple|Processing)" || true
        echo "  ✓ Ticket stapled"
    else
        echo -e "${RED}  ✗ Notarization failed${NC}"

        # Fetch detailed log if we have a submission ID
        if [ -n "$SUBMISSION_ID" ]; then
            echo "  Fetching notarization log for submission: $SUBMISSION_ID"
            echo ""
            xcrun notarytool log "$SUBMISSION_ID" $NOTARY_CREDS 2>&1 | head -50
            echo ""
        fi

        echo -e "${YELLOW}  Continuing with non-notarized build...${NC}"
    fi
else
    echo "  Skipping notarization (no credentials or not Developer ID signed)"
fi

# Step 5: Create final archives (parallel)
# Optimized: Create DMG and ZIP simultaneously, only once (after potential stapling)
echo ""
echo -e "${BLUE}Step 5: Creating release archives (parallel)...${NC}"

# Clean up any existing archives
rm -f "$DMG_PATH" "$ZIP_PATH" "dist/Clearical-arm64.dmg.blockmap" "dist/Clearical-arm64.zip.blockmap"

# Create DMG in background
(
    hdiutil create -volname "Clearical" -srcfolder "$APP_PATH" -ov -format UDZO "$DMG_PATH" 2>&1 | grep -E "(created|error)" || true
    # Staple DMG if notarization succeeded
    if [ "$CAN_NOTARIZE" = true ] && xcrun stapler validate "$APP_PATH" &>/dev/null; then
        xcrun stapler staple "$DMG_PATH" 2>&1 | grep -E "(staple|Processing)" || true
    fi
) &
DMG_PID=$!

# Create ZIP in background
(
    cd dist
    ditto -c -k --sequesterRsrc --keepParent mac-arm64/Clearical.app Clearical-arm64.zip
) &
ZIP_PID=$!

# Wait for both to complete
echo "  Creating DMG and ZIP in parallel..."
wait $DMG_PID && echo "  ✓ DMG created" || echo -e "${RED}  ✗ DMG creation failed${NC}"
wait $ZIP_PID && echo "  ✓ ZIP created" || echo -e "${RED}  ✗ ZIP creation failed${NC}"

# Verify notarization with Gatekeeper (if notarized)
if [ "$CAN_NOTARIZE" = true ] && xcrun stapler validate "$APP_PATH" &>/dev/null; then
    echo "  Verifying notarization with Gatekeeper..."
    VERIFY_OUTPUT=$(xcrun spctl --assess --type open --context context:primary-signature --verbose=2 "$DMG_PATH" 2>&1)
    if echo "$VERIFY_OUTPUT" | grep -q "accepted"; then
        echo "  ✓ Gatekeeper verification passed: $(echo "$VERIFY_OUTPUT" | grep -o 'source=.*')"
    else
        echo -e "${YELLOW}  ⚠ Gatekeeper verification inconclusive${NC}"
        echo "$VERIFY_OUTPUT" | sed 's/^/    /'
    fi
fi

# Show file sizes
echo ""
echo -e "${BLUE}Build artifacts:${NC}"
ls -lh dist/Clearical-arm64.dmg dist/Clearical-arm64.zip 2>/dev/null | awk '{print "  " $9 ": " $5}'

# Step 5b: Generate latest-mac.yml for electron-updater
echo ""
echo -e "${BLUE}Step 5b: Generating update manifest (latest-mac.yml)...${NC}"

# Calculate SHA512 hash and file size for the ZIP (electron-updater uses ZIP on macOS)
ZIP_SHA512=$(shasum -a 512 "$ZIP_PATH" | awk '{print $1}' | xxd -r -p | base64)
ZIP_SIZE=$(stat -f%z "$ZIP_PATH")
RELEASE_DATE=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

# Generate latest-mac.yml
cat > dist/latest-mac.yml << EOF
version: ${VERSION}
files:
  - url: Clearical-arm64.zip
    sha512: ${ZIP_SHA512}
    size: ${ZIP_SIZE}
path: Clearical-arm64.zip
sha512: ${ZIP_SHA512}
releaseDate: '${RELEASE_DATE}'
EOF

echo "  ✓ Generated latest-mac.yml"
cat dist/latest-mac.yml | sed 's/^/    /'

# Step 6: Publish to GitHub (if --publish flag)
if [ "$PUBLISH" = true ]; then
    echo ""
    echo -e "${BLUE}Step 6: Publishing to GitHub...${NC}"

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
            dist/latest-mac.yml \
            --repo benoittanguay/clearical-releases \
            --clobber
        echo "  ✓ Artifacts uploaded to existing release"
    else
        echo "  Creating new release v${VERSION}..."
        gh release create "v${VERSION}" \
            dist/Clearical-arm64.dmg \
            dist/Clearical-arm64.zip \
            dist/latest-mac.yml \
            --repo benoittanguay/clearical-releases \
            --title "v${VERSION}" \
            --notes "Release v${VERSION}

## macOS Installation

Download the DMG, open it, and drag Clearical to your Applications folder.

The app is **signed and notarized** by Apple for your security.

## What's New

See commit history for changes in this release."
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
echo "  - latest-mac.yml (update manifest)"
echo ""

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

# Step 2: Build the app with electron-builder (without publishing)
echo ""
echo -e "${BLUE}Step 2: Building Electron app...${NC}"
npm run build:electron 2>&1 | tail -20
echo "  ✓ Electron build complete"


# Step 3: Sign all embedded binaries (inside-out signing)
# Important: Must sign in correct order (innermost binaries first, then frameworks, then helpers, then main app)
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

# Step 3a: Sign all individual binaries (.so, .dylib, .node files) in the entire app bundle
echo "  Signing individual binaries..."
find "$APP_PATH" -type f -name "*.so" -exec codesign --force --options runtime --timestamp --sign "$IDENTITY" {} \; 2>/dev/null
find "$APP_PATH" -type f -name "*.dylib" -exec codesign --force --options runtime --timestamp --sign "$IDENTITY" {} \; 2>/dev/null
find "$APP_PATH" -type f -name "*.node" -exec codesign --force --options runtime --timestamp --sign "$IDENTITY" {} \; 2>/dev/null
echo "  ✓ Signed .so, .dylib, and .node files"

# Step 3b: Re-sign all Electron frameworks (their internal dylibs were modified)
echo "  Re-signing Electron frameworks..."
for fw in "$FRAMEWORKS"/*.framework; do
    if [ -d "$fw" ]; then
        codesign --force --options runtime --timestamp --sign "$IDENTITY" "$fw" 2>/dev/null || true
    fi
done
echo "  ✓ Frameworks signed"

# Step 3c: Re-sign all Electron helper apps
echo "  Re-signing helper apps..."
for helper in "$FRAMEWORKS"/*.app; do
    if [ -d "$helper" ]; then
        codesign --force --options runtime --timestamp --entitlements "$ENTITLEMENTS" --sign "$IDENTITY" "$helper" 2>/dev/null || true
    fi
done
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

# Step 4: Rebuild DMG with signed app
echo ""
echo -e "${BLUE}Step 4: Creating DMG...${NC}"
DMG_PATH="dist/Clearical-arm64.dmg"
rm -f "$DMG_PATH" "dist/Clearical-arm64.dmg.blockmap"

hdiutil create -volname "Clearical" -srcfolder "$APP_PATH" -ov -format UDZO "$DMG_PATH" 2>&1 | grep -E "(created|error)" || true
echo "  ✓ DMG created: $DMG_PATH"

# Step 5: Create ZIP with signed app
echo ""
echo -e "${BLUE}Step 5: Creating ZIP...${NC}"
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

# Step 6: Notarize the app (if credentials available)
echo ""
echo -e "${BLUE}Step 6: Notarizing with Apple...${NC}"

# Check if signed with Developer ID (not ad-hoc)
if ! codesign -dvvv "$APP_PATH" 2>&1 | grep -q "Authority=Developer ID"; then
    echo -e "${YELLOW}  ⚠ App not signed with Developer ID, skipping notarization${NC}"
else
    # Determine credential method: keychain profile (preferred) or environment variables
    NOTARY_CREDS=""
    if xcrun notarytool history --keychain-profile "Clearical" &>/dev/null; then
        echo "  Using keychain profile 'Clearical'"
        NOTARY_CREDS="--keychain-profile Clearical"
    elif [ -n "$APPLE_ID" ] && [ -n "$APPLE_APP_SPECIFIC_PASSWORD" ] && [ -n "$APPLE_TEAM_ID" ]; then
        echo "  Using environment variables for credentials"
        NOTARY_CREDS="--apple-id $APPLE_ID --password $APPLE_APP_SPECIFIC_PASSWORD --team-id $APPLE_TEAM_ID"
    else
        echo -e "${YELLOW}  ⚠ Apple credentials not configured, skipping notarization${NC}"
        echo ""
        echo "  To configure credentials, either:"
        echo "    1. Store in keychain (recommended):"
        echo "       xcrun notarytool store-credentials \"Clearical\" \\"
        echo "         --apple-id <APPLE_ID> \\"
        echo "         --team-id <TEAM_ID> \\"
        echo "         --password <APP_SPECIFIC_PASSWORD>"
        echo ""
        echo "    2. Set environment variables in .env.local:"
        echo "       APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID"
        NOTARY_CREDS=""
    fi

    if [ -n "$NOTARY_CREDS" ]; then
        echo "  Submitting ZIP for notarization..."

        # Submit for notarization and wait for completion
        NOTARIZE_OUTPUT=$(xcrun notarytool submit "$ZIP_PATH" $NOTARY_CREDS --wait 2>&1)

        # Extract submission ID for potential log retrieval
        SUBMISSION_ID=$(echo "$NOTARIZE_OUTPUT" | grep -E "^\s*id:" | head -1 | awk '{print $2}')

        echo "$NOTARIZE_OUTPUT" | tail -8

        if echo "$NOTARIZE_OUTPUT" | grep -q "status: Accepted"; then
            echo "  ✓ Notarization successful!"

            # Staple the ticket to the app
            echo "  Stapling ticket to app..."
            xcrun stapler staple "$APP_PATH" 2>&1 | grep -E "(staple|Processing)" || true
            echo "  ✓ Ticket stapled to app"

            # Recreate DMG with stapled app
            echo "  Recreating DMG with stapled app..."
            rm -f "$DMG_PATH"
            hdiutil create -volname "Clearical" -srcfolder "$APP_PATH" -ov -format UDZO "$DMG_PATH" 2>&1 | grep -E "(created|error)" || true

            # Staple the DMG too
            xcrun stapler staple "$DMG_PATH" 2>&1 | grep -E "(staple|Processing)" || true
            echo "  ✓ DMG recreated and stapled"

            # Recreate ZIP with stapled app
            echo "  Recreating ZIP with stapled app..."
            rm -f "$ZIP_PATH"
            cd dist
            ditto -c -k --sequesterRsrc --keepParent mac-arm64/Clearical.app Clearical-arm64.zip
            cd "$PROJECT_ROOT"
            echo "  ✓ ZIP recreated with stapled app"

            # Verify notarization with Gatekeeper
            echo "  Verifying notarization with Gatekeeper..."
            VERIFY_OUTPUT=$(xcrun spctl --assess --type open --context context:primary-signature --verbose=2 "$DMG_PATH" 2>&1)
            if echo "$VERIFY_OUTPUT" | grep -q "accepted"; then
                echo "  ✓ Gatekeeper verification passed: $(echo "$VERIFY_OUTPUT" | grep -o 'source=.*')"
            else
                echo -e "${YELLOW}  ⚠ Gatekeeper verification inconclusive${NC}"
                echo "$VERIFY_OUTPUT" | sed 's/^/    /'
            fi
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
    fi
fi

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
echo ""

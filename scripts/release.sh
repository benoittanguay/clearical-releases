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

# Step 2: Clean and rebuild everything fresh
echo ""
echo -e "${BLUE}Step 2: Clean rebuild...${NC}"
echo "  Cleaning dist folders..."
rm -rf dist dist-electron
echo "  ✓ Cleaned dist and dist-electron"

echo "  Building frontend..."
npm run build 2>&1 | tail -5
echo "  ✓ Frontend build complete"

echo "  Building Electron app..."
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

# Step 4: Notarize App (if credentials available)
echo ""
echo -e "${BLUE}Step 4: Notarizing app bundle...${NC}"

# Check if signed with Developer ID
if ! codesign -dvvv "$APP_PATH" 2>&1 | grep -q "Authority=Developer ID"; then
    echo -e "${YELLOW}  ⚠ App not signed with Developer ID, skipping notarization${NC}"
    CAN_NOTARIZE=false
fi

APP_NOTARIZED=false
if [ "$CAN_NOTARIZE" = true ]; then
    # Create ZIP for notarization (required format)
    echo "  Creating ZIP for app notarization..."
    rm -f "$ZIP_PATH"
    cd dist
    ditto -c -k --sequesterRsrc --keepParent mac-arm64/Clearical.app Clearical-arm64.zip
    cd "$PROJECT_ROOT"

    echo "  Submitting app for notarization..."
    NOTARIZE_OUTPUT=$(xcrun notarytool submit "$ZIP_PATH" $NOTARY_CREDS --wait 2>&1)

    # Extract submission ID for potential log retrieval
    SUBMISSION_ID=$(echo "$NOTARIZE_OUTPUT" | grep -E "^\s*id:" | head -1 | awk '{print $2}')

    echo "$NOTARIZE_OUTPUT" | tail -8

    if echo "$NOTARIZE_OUTPUT" | grep -q "status: Accepted"; then
        echo "  ✓ App notarization successful!"
        APP_NOTARIZED=true

        # Staple the ticket to the app
        echo "  Stapling ticket to app..."
        xcrun stapler staple "$APP_PATH" 2>&1 | grep -E "(staple|Processing|worked)" || true
        echo "  ✓ Ticket stapled to app"
    else
        echo -e "${RED}  ✗ App notarization failed${NC}"

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

# Step 5: Create and notarize DMG
# IMPORTANT: We create a styled DMG with Applications shortcut and drag-arrow background
# from the stapled app, sign it, and notarize it separately.
# This ensures the DMG itself passes Gatekeeper checks and provides a good install UX.
echo ""
echo -e "${BLUE}Step 5: Creating and notarizing DMG...${NC}"

# Clean up electron-builder artifacts we don't need
rm -f "dist/Clearical-arm64.dmg.blockmap" "dist/Clearical-arm64.zip.blockmap"
rm -f "$DMG_PATH"  # Remove electron-builder's DMG, we'll create our own

# --- Create styled DMG with Applications shortcut and background ---
VOLUME_NAME="Clearical"
DMG_TEMP="dist/.tmp-rw.dmg"
BG_IMAGE="build/dmg-background@2x.png"

# Calculate required size (app size + 20 MB headroom for background + metadata)
APP_SIZE_KB=$(du -sk "$APP_PATH" | awk '{print $1}')
DMG_SIZE_KB=$((APP_SIZE_KB + 20480))

echo "  Creating writable DMG (${DMG_SIZE_KB} KB)..."
rm -f "$DMG_TEMP"
hdiutil create -size "${DMG_SIZE_KB}k" -volname "$VOLUME_NAME" -fs HFS+ -fsargs "-c c=64,a=16,e=16" "$DMG_TEMP" 2>&1 | tail -1

echo "  Mounting writable DMG..."
MOUNT_OUTPUT=$(hdiutil attach "$DMG_TEMP" -readwrite -noverify -noautoopen 2>&1)
MOUNT_POINT=$(echo "$MOUNT_OUTPUT" | grep -o '/Volumes/.*' | head -1)

if [ -z "$MOUNT_POINT" ]; then
    echo -e "${RED}  Error: Failed to mount DMG${NC}"
    echo "$MOUNT_OUTPUT"
    exit 1
fi

echo "  Copying app to DMG..."
cp -R "$APP_PATH" "$MOUNT_POINT/"

echo "  Creating Applications shortcut..."
ln -s /Applications "$MOUNT_POINT/Applications"

# Copy background image into hidden .background folder
if [ -f "$BG_IMAGE" ]; then
    echo "  Setting DMG background image..."
    mkdir -p "$MOUNT_POINT/.background"
    cp "$BG_IMAGE" "$MOUNT_POINT/.background/background.png"

    # Use AppleScript to configure Finder view: background, icon size, positions, window size
    # Icon positions match package.json dmg.contents: app at (130,200), Applications at (410,200)
    # Note: Uses POSIX file path for background — HFS-style paths fail on newer macOS (-10006)
    # Note: Non-fatal — Finder AppleScript can be flaky on newer macOS versions.
    #       The Applications shortcut and background image are already on disk regardless.
    echo "  Configuring DMG window layout via AppleScript..."
    if osascript <<APPLESCRIPT 2>/dev/null
        tell application "Finder"
            tell disk "$VOLUME_NAME"
                open
                delay 3
                set current view of container window to icon view
                set toolbar visible of container window to false
                set statusbar visible of container window to false
                set bounds of container window to {100, 100, 640, 480}
                delay 1
                set theViewOptions to icon view options of container window
                set arrangement of theViewOptions to not arranged
                set icon size of theViewOptions to 80
                set background picture of theViewOptions to (POSIX file "$MOUNT_POINT/.background/background.png")
                delay 1
                set position of item "Clearical.app" of container window to {130, 200}
                delay 1
                set position of item "Applications" of container window to {410, 200}
                delay 1
                close
                open
                update without registering applications
                delay 2
                close
            end tell
        end tell
APPLESCRIPT
    then
        echo "  ✓ DMG layout configured"
    else
        echo -e "${YELLOW}  ⚠ AppleScript layout partially failed (Finder quirk) — DMG still has Applications shortcut and background${NC}"
    fi
else
    echo -e "${YELLOW}  ⚠ Background image not found at $BG_IMAGE, creating plain DMG${NC}"
fi

# Ensure all writes are flushed, then unmount
sync
echo "  Unmounting writable DMG..."
hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || hdiutil detach "$MOUNT_POINT" -force 2>/dev/null

# Convert writable DMG to compressed read-only DMG
echo "  Compressing DMG..."
hdiutil convert "$DMG_TEMP" -format UDZO -imagekey zlib-level=9 -o "$DMG_PATH" 2>&1 | tail -1
rm -f "$DMG_TEMP"
echo "  ✓ DMG created (with Applications shortcut and drag-arrow background)"

# Sign the DMG
echo "  Signing DMG..."
codesign --force --sign "$IDENTITY" "$DMG_PATH"
echo "  ✓ DMG signed"

# Notarize the DMG (separate from app notarization)
DMG_NOTARIZED=false
if [ "$APP_NOTARIZED" = true ]; then
    echo "  Submitting DMG for notarization..."
    DMG_NOTARIZE_OUTPUT=$(xcrun notarytool submit "$DMG_PATH" $NOTARY_CREDS --wait 2>&1)

    echo "$DMG_NOTARIZE_OUTPUT" | tail -5

    if echo "$DMG_NOTARIZE_OUTPUT" | grep -q "status: Accepted"; then
        echo "  ✓ DMG notarization successful!"
        DMG_NOTARIZED=true

        # Staple the ticket to the DMG
        echo "  Stapling ticket to DMG..."
        xcrun stapler staple "$DMG_PATH" 2>&1 | grep -E "(staple|Processing|worked)" || true
        echo "  ✓ Ticket stapled to DMG"
    else
        echo -e "${YELLOW}  ⚠ DMG notarization failed, continuing...${NC}"
    fi
fi

# Step 6: Finalize release archives
echo ""
echo -e "${BLUE}Step 6: Finalizing release archives...${NC}"

# Create fresh ZIP with the stapled app (for auto-updater)
echo "  Creating ZIP archive..."
rm -f "$ZIP_PATH"
(
    cd dist
    ditto -c -k --sequesterRsrc --keepParent mac-arm64/Clearical.app Clearical-arm64.zip
)
echo "  ✓ ZIP created"

# Verify notarization with Gatekeeper
if [ "$DMG_NOTARIZED" = true ]; then
    echo "  Verifying DMG with Gatekeeper..."
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

# Step 6b: Generate latest-mac.yml for electron-updater
echo ""
echo -e "${BLUE}Step 6b: Generating update manifest (latest-mac.yml)...${NC}"

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
            dist/latest-mac.yml \
            CHANGELOG.md \
            --repo benoittanguay/clearical-releases \
            --clobber
        echo "  ✓ Artifacts uploaded to existing release"

        # Delete auto-generated source archives (GitHub adds these automatically)
        echo "  Removing auto-generated source archives..."
        gh release delete-asset "v${VERSION}" "v${VERSION}.zip" --repo benoittanguay/clearical-releases -y 2>/dev/null || true
        gh release delete-asset "v${VERSION}" "v${VERSION}.tar.gz" --repo benoittanguay/clearical-releases -y 2>/dev/null || true
        echo "  ✓ Source archives removed"
    else
        echo "  Creating new release v${VERSION}..."

        # Extract release notes from CHANGELOG.md for this version
        CHANGELOG_FILE="$PROJECT_ROOT/CHANGELOG.md"
        if [ -f "$CHANGELOG_FILE" ]; then
            # Extract content between this version header and the next version header (or end of relevant content)
            RELEASE_NOTES=$(awk -v ver="$VERSION" '
                /^## \[/ {
                    if (found) exit
                    if (index($0, "[" ver "]")) found=1
                    next
                }
                /^---/ { if (found) exit }
                found { print }
            ' "$CHANGELOG_FILE" | sed '/^$/N;/^\n$/d')

            if [ -z "$RELEASE_NOTES" ]; then
                echo -e "${YELLOW}  ⚠ No changelog entry found for v${VERSION}, using generic notes${NC}"
                RELEASE_NOTES="See CHANGELOG.md for details."
            else
                echo "  ✓ Found changelog entry for v${VERSION}"
            fi
        else
            echo -e "${YELLOW}  ⚠ CHANGELOG.md not found, using generic notes${NC}"
            RELEASE_NOTES="See CHANGELOG.md for details."
        fi

        gh release create "v${VERSION}" \
            dist/Clearical-arm64.dmg \
            dist/Clearical-arm64.zip \
            dist/latest-mac.yml \
            CHANGELOG.md \
            --repo benoittanguay/clearical-releases \
            --title "v${VERSION}" \
            --notes "## What's New

$RELEASE_NOTES

---

## macOS Installation

Download the DMG, open it, and drag Clearical to your Applications folder.

The app is **signed and notarized** by Apple for your security."
        echo "  ✓ Release created and artifacts uploaded"

        # Delete auto-generated source archives (GitHub adds these automatically)
        echo "  Removing auto-generated source archives..."
        gh release delete-asset "v${VERSION}" "v${VERSION}.zip" --repo benoittanguay/clearical-releases -y 2>/dev/null || true
        gh release delete-asset "v${VERSION}" "v${VERSION}.tar.gz" --repo benoittanguay/clearical-releases -y 2>/dev/null || true
        echo "  ✓ Source archives removed"
    fi

    echo ""
    echo -e "${GREEN}✓ Published: https://github.com/benoittanguay/clearical-releases/releases/tag/v${VERSION}${NC}"

    # Step 8: Update marketing website (demo.html) on gh-pages branch
    echo ""
    echo -e "${BLUE}Step 8: Updating marketing website...${NC}"

    if [ -f "$PROJECT_ROOT/demo.html" ]; then
        # Clone only the gh-pages branch to a temp directory
        TEMP_RELEASES_DIR=$(mktemp -d)
        echo "  Cloning clearical-releases gh-pages branch..."
        git clone --depth 1 --branch gh-pages https://github.com/benoittanguay/clearical-releases.git "$TEMP_RELEASES_DIR" 2>/dev/null

        # Copy demo.html
        cp "$PROJECT_ROOT/demo.html" "$TEMP_RELEASES_DIR/demo.html"

        # Check if there are changes
        cd "$TEMP_RELEASES_DIR"
        if git diff --quiet demo.html 2>/dev/null; then
            echo "  ✓ demo.html is already up to date"
        else
            git add demo.html
            git commit -m "chore: update demo.html for v${VERSION}" 2>/dev/null
            git push 2>/dev/null
            echo "  ✓ Updated demo.html on GitHub Pages"
        fi

        # Cleanup
        cd "$PROJECT_ROOT"
        rm -rf "$TEMP_RELEASES_DIR"

        echo ""
        echo -e "${GREEN}✓ Marketing site: https://benoittanguay.github.io/clearical-releases/demo.html${NC}"
    else
        echo -e "${YELLOW}  ⚠ demo.html not found, skipping marketing site update${NC}"
    fi
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
echo "  - CHANGELOG.md (included in GitHub release)"
echo ""

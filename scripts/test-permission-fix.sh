#!/bin/bash

# Test script for macOS Permission Fix
# This script helps verify the permission detection and recovery flow

echo "======================================"
echo "Clearical Permission Fix Test Script"
echo "======================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

APP_NAME="Clearical"
APP_PATH="/Applications/Clearical.app"
BUNDLE_ID="com.clearical.app"

echo "This script helps test the permission fix implementation."
echo ""
echo -e "${YELLOW}Prerequisites:${NC}"
echo "1. Clearical must be built and installed in /Applications"
echo "2. You must have granted Screen Recording permission at least once"
echo ""
echo "What this script does:"
echo "- Checks current permission status"
echo "- Provides commands to simulate/test stale permissions"
echo "- Verifies the app detects the issue"
echo ""
echo "========================================"
echo ""

# Check if app exists
if [ ! -d "$APP_PATH" ]; then
    echo -e "${RED}Error: Clearical not found at $APP_PATH${NC}"
    echo "Please build and install the app first."
    exit 1
fi

echo -e "${GREEN}✓ Found Clearical at $APP_PATH${NC}"
echo ""

# Get app binary path
BINARY_PATH="$APP_PATH/Contents/MacOS/Clearical"
echo "Binary path: $BINARY_PATH"
echo ""

# Check current TCC status
echo "Checking current permission status..."
echo ""

# Get TCC database entry (read-only, won't modify)
TCC_DB="$HOME/Library/Application Support/com.apple.TCC/TCC.db"

if [ -f "$TCC_DB" ]; then
    echo "TCC Database exists: $TCC_DB"

    # Try to query (may require Full Disk Access)
    ENTRY=$(sqlite3 "$TCC_DB" "SELECT service, allowed, csreq FROM access WHERE service='kTCCServiceScreenCapture' AND client='$BUNDLE_ID';" 2>/dev/null)

    if [ -n "$ENTRY" ]; then
        echo -e "${GREEN}✓ TCC entry found for Clearical${NC}"
        echo "Entry: $ENTRY"
    else
        echo -e "${YELLOW}⚠ No TCC entry found (permission may not be granted yet)${NC}"
    fi
else
    echo -e "${YELLOW}⚠ TCC database not accessible${NC}"
fi

echo ""
echo "========================================"
echo ""

echo -e "${YELLOW}Testing Options:${NC}"
echo ""
echo "1. View current permission in System Settings:"
echo "   open 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'"
echo ""

echo "2. Reset Screen Recording permissions for Clearical:"
echo "   tccutil reset ScreenCapture \"$BUNDLE_ID\""
echo ""

echo "3. Launch Clearical to test detection:"
echo "   open -a Clearical"
echo ""

echo "4. Check Clearical logs (after launching):"
echo "   tail -f ~/Library/Logs/Clearical/main.log"
echo ""

echo "========================================"
echo ""

echo -e "${YELLOW}Test Procedure:${NC}"
echo ""
echo "Step 1: Grant initial permission"
echo "   - Open Clearical"
echo "   - Grant Screen Recording permission when prompted"
echo "   - Verify screenshots work"
echo ""

echo "Step 2: Simulate stale permission"
echo "   - Close Clearical"
echo "   - Run: tccutil reset ScreenCapture \"$BUNDLE_ID\""
echo "   - Grant permission again in System Settings"
echo "   - DO NOT launch Clearical yet"
echo ""

echo "Step 3: Modify app signature (simulates update)"
echo "   - Close Clearical if running"
echo "   - Run: touch \"$BINARY_PATH\""
echo "   - This changes the binary timestamp, altering signature"
echo "   - Permission is now 'stale' (granted but wrong signature)"
echo ""

echo "Step 4: Test detection"
echo "   - Launch Clearical"
echo "   - Open Settings page"
echo "   - Look for 'NEEDS RESET' status (orange badge)"
echo "   - Verify warning message appears"
echo ""

echo "Step 5: Test recovery"
echo "   - Click 'Fix Permission Issue' button"
echo "   - Verify dialog appears with instructions"
echo "   - Follow instructions to reset permission"
echo "   - Verify status changes to 'GRANTED' (green)"
echo ""

echo "========================================"
echo ""

echo -e "${GREEN}What to look for in the app:${NC}"
echo ""
echo "✓ Settings > Permissions shows 'NEEDS RESET' (orange badge)"
echo "✓ Warning box appears explaining the issue"
echo "✓ 'Fix Permission Issue' button is present"
echo "✓ Clicking button shows native dialog with instructions"
echo "✓ After fixing, status auto-updates to 'GRANTED'"
echo "✓ Screenshots work after fixing"
echo ""

echo "========================================"
echo ""

echo -e "${GREEN}Log messages to look for:${NC}"
echo ""
echo "When stale permission is detected:"
echo "  [Main] check-screen-permission status: granted"
echo "  [Main] STALE PERMISSION DETECTED: System says granted but capture fails!"
echo "  [Main] This typically happens after app updates with ad-hoc signing"
echo ""

echo "When working correctly:"
echo "  [Main] Screen recording test: SUCCESS - captured thumbnail { width: 100, height: 100 }"
echo ""

echo "========================================"
echo ""

read -p "Press Enter to exit..."

#!/bin/bash

# Test script for the improved screenshot analyzer
# This demonstrates the new structured extraction capabilities

echo "=========================================="
echo "Screenshot Analyzer - Extraction Test"
echo "=========================================="
echo ""

ANALYZER="/Users/benoittanguay/Documents/Anti/TimePortal/native/screenshot-analyzer/build/screenshot-analyzer"

# Check if analyzer exists
if [ ! -f "$ANALYZER" ]; then
    echo "ERROR: Analyzer not found at: $ANALYZER"
    echo "Please run ./build.sh first"
    exit 1
fi

echo "Analyzer found: $ANALYZER"
echo ""

# Create a test image path (this would be a real screenshot in production)
# For now, we'll just show the expected JSON structure

echo "Example Input JSON:"
echo '{"imagePath": "/path/to/screenshot.png", "requestId": "test-123"}'
echo ""

echo "Expected Output Structure:"
echo "{"
echo '  "success": true,'
echo '  "description": "Narrative description of what the user is doing",'
echo '  "confidence": 0.85,'
echo '  "extraction": {'
echo '    "extractedText": {'
echo '      "filenames": ["HistoryDetail.tsx", "main.swift"],'
echo '      "code": ["const handleSubmit = async () => {", "func analyzeImage"],'
echo '      "urls": ["localhost:5173", "https://api.tempo.io"],'
echo '      "commands": ["npm run dev", "git status"],'
echo '      "errors": ["TypeError: Cannot read property"],'
echo '      "projectIdentifiers": ["TimePortal", "PROJ-123"]'
echo '    },'
echo '    "visualContext": {'
echo '      "application": "Cursor",'
echo '      "applicationMode": "Editor view",'
echo '      "activeTab": "HistoryDetail.tsx",'
echo '      "visiblePanels": ["Terminal panel", "Problems panel"]'
echo '    },'
echo '    "fileContext": {'
echo '      "filename": "HistoryDetail.tsx",'
echo '      "language": "TypeScript React",'
echo '      "extension": "tsx"'
echo '    },'
echo '    "projectContext": {'
echo '      "projectName": "TimePortal",'
echo '      "directoryStructure": ["src", "components", "native"],'
echo '      "branchName": "main",'
echo '      "issueReferences": ["PROJ-123"],'
echo '      "configFiles": ["package.json", "tsconfig.json"]'
echo '    },'
echo '    "detectedTechnologies": ["React", "TypeScript", "Electron"],'
echo '    "detectedActivities": ["Coding", "Testing"]'
echo '  }'
echo "}"
echo ""

echo "=========================================="
echo "Benefits of Structured Extraction:"
echo "=========================================="
echo "1. Precise project identification from file paths and names"
echo "2. Technology stack detection for better categorization"
echo "3. Activity type recognition (coding, debugging, testing, etc.)"
echo "4. Issue/ticket reference extraction for Jira integration"
echo "5. Enhanced context for AI-powered assignment suggestions"
echo "6. Detailed file and directory information"
echo "7. Error and debugging context capture"
echo ""

echo "This structured data enables:"
echo "- More accurate project/bucket assignment"
echo "- Better activity summaries"
echo "- Improved time tracking categorization"
echo "- Enhanced Jira/Tempo integration"
echo ""

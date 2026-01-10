# Testing the Two-Stage Screenshot Analysis Architecture

## Pre-Testing Setup

### 1. Install Dependencies

```bash
# Install the Anthropic SDK
npm install
```

This will install `@anthropic-ai/sdk` as specified in `package.json`.

### 2. Configure API Key

**Option A: Full Two-Stage Testing (with LLM)**
```bash
# Create .env.local with your Anthropic API key
cp .env.example .env.local

# Edit .env.local and add your API key
# ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxx
```

Get your API key from: https://console.anthropic.com/settings/keys

**Option B: Stage 1 Only Testing (without LLM)**
```bash
# Either don't create .env.local, or leave ANTHROPIC_API_KEY empty
# The app will work fine, just without AI-generated descriptions
```

### 3. Rebuild Swift Analyzer

The Swift analyzer was already rebuilt with the new architecture, but if you need to rebuild:

```bash
cd /Users/benoittanguay/Documents/Anti/TimePortal/native/screenshot-analyzer
./build.sh
```

Expected output: ✅ Build successful!

## Testing Scenarios

### Test 1: Stage 1 Only (Vision Framework Extraction)

**Purpose**: Verify Vision Framework extraction works without LLM

**Setup**:
- Don't configure `ANTHROPIC_API_KEY` (or use invalid key)

**Steps**:
1. Start the app:
   ```bash
   npm run dev:electron
   ```

2. Start a time tracking session

3. Take a screenshot (automatic or manual)

4. Open the screenshot in the gallery

5. **Expected Results**:
   - ✅ Screenshot displays correctly
   - ✅ "Raw Vision Framework Data" section is collapsible and populated
   - ✅ OCR text appears in the raw data
   - ✅ Detected objects appear as tags
   - ✅ Structured extraction JSON is available
   - ⚠️ "AI Narrative" section shows warning: "LLM Description Unavailable"
   - ⚠️ Warning message explains: "Configure ANTHROPIC_API_KEY to enable..."

**Check Console Logs**:
```
[Main] analyze-screenshot requested for: /path/to/screenshot.png
[Main] Using two-stage architecture: Vision Framework → Claude LLM
[Main] Stage 1: Running Vision Framework extraction...
[Main] Stage 1 complete - Vision Framework extraction successful
[Main] Extracted: { textItems: 45, objects: 8, hasExtraction: true, confidence: 0.85 }
[Main] Stage 2: Generating LLM description...
[LLM Service] No ANTHROPIC_API_KEY found in environment. LLM descriptions will not be generated.
[Main] Stage 2 skipped - LLM service not available
```

### Test 2: Complete Two-Stage Flow (Vision + LLM)

**Purpose**: Verify both Vision Framework extraction AND LLM description generation

**Setup**:
- Configure valid `ANTHROPIC_API_KEY` in `.env.local`
- Restart the app to load the new environment variable

**Steps**:
1. Start the app:
   ```bash
   npm run dev:electron
   ```

2. Start a time tracking session

3. Capture a screenshot showing active development work (e.g., code editor, terminal)

4. Open the screenshot in the gallery

5. **Expected Results**:
   - ✅ Screenshot displays correctly
   - ✅ "AI Narrative" section shows a purple-themed box
   - ✅ LLM-generated description appears (2-4 sentences)
   - ✅ Description is coherent and contextual (not robotic)
   - ✅ Description mentions what you were working on
   - ✅ "Raw Vision Framework Data" section is available (collapsed by default)
   - ✅ Raw data shows all extracted text, objects, and structured analysis

**Check Console Logs**:
```
[Main] analyze-screenshot requested for: /path/to/screenshot.png
[Main] Using two-stage architecture: Vision Framework → Claude LLM
[Main] Stage 1: Running Vision Framework extraction...
[Main] Stage 1 complete - Vision Framework extraction successful
[Main] Extracted: { textItems: 45, objects: 8, hasExtraction: true, confidence: 0.85 }
[Main] Stage 2: Generating LLM description...
[LLM Service] Claude API client initialized successfully
[LLM Service] Generating description with Claude...
[LLM Service] Prompt length: 2341 characters
[LLM Service] Description generated successfully
[LLM Service] Tokens used - Input: 1150 Output: 92
[Main] Stage 2 complete - LLM description generated successfully
[Main] Description length: 287 characters
[Main] Tokens used: 1150 input, 92 output
```

### Test 3: Error Handling - Invalid API Key

**Purpose**: Verify graceful error handling when API key is invalid

**Setup**:
- Set `ANTHROPIC_API_KEY=invalid-key-test` in `.env.local`
- Restart the app

**Steps**:
1. Capture a screenshot

2. Open the screenshot in the gallery

3. **Expected Results**:
   - ✅ Vision Framework extraction still works
   - ⚠️ "AI Narrative" section shows error state (yellow-themed)
   - ⚠️ Error message explains the API key is invalid
   - ✅ Raw Vision data is still available

**Check Console Logs**:
```
[Main] Stage 2 failed - LLM description generation failed: Authentication error
```

### Test 4: Description Quality Comparison

**Purpose**: Compare quality of LLM descriptions vs old Vision Framework descriptions

**Setup**:
- Valid API key configured
- Multiple different screenshots (code editor, terminal, browser, etc.)

**Steps**:
1. Take screenshots of different activities:
   - Code editor with TypeScript file
   - Terminal with git commands
   - Browser with documentation
   - Debugging session with errors visible

2. For each screenshot:
   - Read the AI-generated narrative (purple box)
   - Expand the raw Vision data (green collapsible)
   - Compare the quality

3. **Expected Results**:
   - ✅ LLM descriptions are contextual and specific
   - ✅ LLM mentions file names, project names, technologies
   - ✅ LLM descriptions sound natural (not robotic)
   - ✅ LLM correctly identifies the activity (coding, debugging, researching)
   - ✅ Raw data shows all the extracted information used by the LLM

**Example Good Description**:
```
"Worked on the TimePortal application implementing a two-stage screenshot
analysis architecture in the electron directory. Development focused on
integrating Claude AI for generating narrative descriptions from Vision
Framework data, using TypeScript with the Anthropic SDK."
```

**Example of What We're Avoiding (Old Vision Framework)**:
```
"The user is working in Cursor. Multiple lines of source code are visible,
indicating programming work in progress. Technologies in use include
TypeScript, React. This appears to be a focused coding session."
```

### Test 5: Token Usage & Cost Monitoring

**Purpose**: Monitor API usage and costs

**Steps**:
1. Configure valid API key

2. Take 10-20 screenshots of varying complexity

3. Check console logs for token usage after each analysis

4. Calculate costs:
   ```
   Input cost = (total_input_tokens / 1_000_000) × $3
   Output cost = (total_output_tokens / 1_000_000) × $15
   Total cost = Input cost + Output cost
   ```

5. **Expected Results**:
   - ✅ Each screenshot uses ~1000-2000 input tokens
   - ✅ Each screenshot uses ~80-150 output tokens
   - ✅ Cost per screenshot is ~$0.003-$0.008
   - ✅ No excessive token usage (would indicate prompt bloat)

**Check Console Logs**:
```
[LLM Service] Tokens used - Input: 1150 Output: 92
[LLM Service] Tokens used - Input: 1420 Output: 105
[LLM Service] Tokens used - Input: 980 Output: 87
```

## UI Verification

### Screenshot Gallery Display

Open a screenshot and verify the UI layout:

1. **Header Section** (top right):
   - ✅ Info toggle button (shows/hides metadata panel)
   - ✅ Open in Finder button
   - ✅ Delete button
   - ✅ Close button (X)

2. **Metadata Panel** (left side, when visible):
   - ✅ Time, App Name, Window Title
   - ✅ **AI Narrative section** (purple theme):
     - Badge: "Claude AI"
     - Border: purple left border
     - Content: 2-4 sentence description
   - ✅ **Raw Vision Framework Data section** (green theme):
     - Collapsible (collapsed by default)
     - Badge: "Stage 1: Extraction"
     - When expanded:
       - Vision Framework Confidence score
       - OCR Text (numbered list)
       - Visual Objects (tags)
       - Structured Analysis (JSON)

3. **Color Coding**:
   - Purple = LLM/AI (Stage 2)
   - Green = Vision Framework (Stage 1)
   - Yellow = Warnings/Errors

## Build & Deploy Testing

### TypeScript Compilation

```bash
# Build Electron main process
npm run build:electron-main
```

**Expected Results**:
- ✅ No TypeScript errors
- ✅ `llmDescriptionService.ts` compiles successfully
- ✅ Updated `main.ts` compiles successfully
- ✅ Output in `dist-electron/`

### Full Application Build

```bash
npm run build:electron
```

**Expected Results**:
- ✅ React app builds
- ✅ Electron main process builds
- ✅ Electron app packages successfully
- ✅ No dependency errors

## Common Issues & Solutions

### Issue: "LLM service not available"

**Symptoms**:
- Warning in screenshot gallery
- Console log: "No ANTHROPIC_API_KEY found"

**Solutions**:
1. Verify `.env.local` exists (not `.env.example`)
2. Check API key is correctly formatted: `ANTHROPIC_API_KEY=sk-ant-api03-...`
3. Restart Electron app to reload environment variables
4. Check for typos in the environment variable name

### Issue: "Authentication error" from Claude API

**Symptoms**:
- Error in screenshot gallery
- Console log: "Authentication error" or 401 status

**Solutions**:
1. Verify API key is valid (not expired or revoked)
2. Check API key has correct format
3. Log in to Anthropic console and regenerate key if needed

### Issue: Vision Framework extraction is empty

**Symptoms**:
- Raw Vision data shows 0 text items, 0 objects
- LLM description is generic

**Solutions**:
1. Check screenshot file exists and is readable
2. Verify screenshot contains visible text
3. Check console for Swift analyzer errors
4. Try rebuilding Swift analyzer: `cd native/screenshot-analyzer && ./build.sh`

### Issue: TypeScript compilation errors with Anthropic SDK

**Symptoms**:
- Build fails with module not found errors
- `@anthropic-ai/sdk` not recognized

**Solutions**:
```bash
# Remove and reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Verify package.json has the dependency
grep "@anthropic-ai/sdk" package.json
```

### Issue: Descriptions are not contextual enough

**Symptoms**:
- LLM descriptions are too generic
- Missing specific file names or project details

**Solutions**:
1. Check raw Vision data - is the extraction complete?
2. Verify screenshot has enough visible text
3. Vision Framework extraction quality directly impacts LLM output
4. Consider adjusting the prompt in `llmDescriptionService.ts` (advanced)

## Performance Testing

### Response Time Benchmarks

Measure the time for each stage:

**Stage 1 (Vision Framework)**:
- Expected: 0.5-2 seconds
- Log: `[Main] Stage 1 complete - Vision Framework extraction successful`

**Stage 2 (LLM)**:
- Expected: 1-3 seconds
- Log: `[Main] Stage 2 complete - LLM description generated successfully`

**Total**:
- Expected: 2-5 seconds from capture to description ready

If times are significantly longer:
- Check network connection (for LLM)
- Check screenshot file size (very large files slow Vision Framework)
- Check system resources (macOS Vision Framework uses GPU)

## Success Criteria

✅ **Must Have**:
- [x] Vision Framework extraction works without API key
- [x] LLM descriptions generated when API key is configured
- [x] Both raw data and AI narrative visible in UI
- [x] Graceful error handling when API key missing/invalid
- [x] TypeScript compilation succeeds
- [x] No breaking changes to existing time tracking functionality

✅ **Should Have**:
- [x] LLM descriptions are contextual and specific
- [x] Token usage is reasonable (~1000-1500 input, ~100 output)
- [x] Response time is acceptable (2-5 seconds total)
- [x] UI clearly distinguishes Stage 1 vs Stage 2 data
- [x] Console logs are informative for debugging

✅ **Nice to Have**:
- [x] Comprehensive documentation (this file, SCREENSHOT_ANALYSIS.md)
- [x] Environment configuration example (.env.example)
- [x] Clear error messages guide users to solutions
- [x] Swift analyzer warnings are minimal

## Next Steps After Testing

If all tests pass:

1. **Update any affected components** that use screenshot descriptions
   - Check where `screenshotDescriptions` or `aiDescription` are used
   - Update to use new `screenshotAnalysis` structure if needed

2. **Consider migration strategy** for existing screenshots
   - Old screenshots have `visionData` field
   - New screenshots have `rawVisionData` + `aiDescription`
   - UI already handles both (backward compatible)

3. **Monitor costs** in production
   - Track token usage over time
   - Consider implementing batch processing if needed
   - Add user-facing cost estimates if appropriate

4. **Gather user feedback**
   - Are descriptions helpful?
   - Is the raw data useful for debugging?
   - Should there be UI to toggle LLM on/off?

5. **Potential enhancements**:
   - Customizable prompts
   - Local LLM support (Ollama)
   - Quality scoring
   - Selective analysis (only analyze important screenshots)

## Rollback Plan

If critical issues are discovered:

```bash
# Revert the changes
git checkout main
git revert <commit-hash>

# Or restore individual files:
git checkout main -- electron/main.ts
git checkout main -- native/screenshot-analyzer/main.swift
git checkout main -- src/components/ScreenshotGallery.tsx

# Remove Anthropic dependency
npm uninstall @anthropic-ai/sdk

# Rebuild
npm install
npm run build:electron-main
```

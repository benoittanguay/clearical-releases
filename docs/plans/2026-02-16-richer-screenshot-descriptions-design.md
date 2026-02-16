# Richer Screenshot Descriptions Design

## Problem

Screenshot analysis produces generic, repetitive descriptions ("User is editing code in VS Code") because:

1. **Screenshot prompt** asks for "a single, concise sentence (under 100 words)" at temperature 0.2
2. **Summary prompt** contradicts itself: intro says "3-5 sentences" but final instruction says "1-2 sentences"
3. **OCR text** from Vision Framework (`rawVisionData.detectedText`) is collected locally but never sent to Gemini — the LLM guesses specifics from pixels alone
4. **Batch analysis** has the same short prompt and no OCR data

## Solution: Feed OCR Text + Lift Length Constraints

### Changes by File

#### 1. `supabase/functions/gemini-proxy/index.ts`

- **`handleAnalyze()`**: Rewrite prompt — "2-3 sentences with specific details" instead of "single sentence under 100 words". Include `ocrText` from request body as "Detected text on screen:" section.
- **`handleAnalyzeBatch()`**: Pass `ocrText` per image to batch analysis.
- **`buildSummarizationPrompt()`** (line ~928): Remove contradictory "1-2 sentences" final instruction, keep "3-5 sentences".

#### 2. `supabase/functions/_shared/gemini.ts`

- **`analyzeImage()`**: Bump `maxOutputTokens` 1024 → 2048, `temperature` 0.2 → 0.3.
- **`analyzeImageBatch()`**: Updated prompt for "2-3 detailed sentences". Include OCR text per image. Bump `maxOutputTokens` to 4096. Add `ocrText` to `BatchImageInput` type.

#### 3. `electron/ai/aiService.ts`

- **`analyzeScreenshot()`**: Accept optional `ocrText?: string[]`, include in request body.
- **`analyzeScreenshotBatch()`**: Accept optional `ocrText` per `BatchAnalysisInput`, include in request body.

#### 4. `electron/main.ts`

- **Single analysis** (~line 584): Pass `rawVisionData.detectedText` if available.
- **Batch analysis** (~line 746): Pass `ocrText` per input if available.
- **OCR filtering**: Deduplicate, remove strings < 3 chars, cap at ~50 entries.

### OCR Text Filtering (client-side)

Raw OCR includes noise (menu items, status bar, repeated UI chrome). Before sending:
- Deduplicate identical strings
- Remove very short strings (< 3 chars)
- Cap at ~50 most relevant strings (prioritize longer, unique text)

### Not Changed

- No new API calls or operations
- No changes to rate limiting or classification prompt
- No changes to data model
- Vision Framework integration remains optional enrichment

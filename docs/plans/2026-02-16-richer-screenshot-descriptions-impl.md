# Richer Screenshot Descriptions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make AI-generated screenshot descriptions and time entry summaries detailed and specific by improving prompts, lifting length constraints, and wiring OCR text passthrough.

**Architecture:** Four files changed across two layers — the Supabase Edge Function (prompt + generation config) and the Electron client (type plumbing + OCR passthrough). All changes are backward-compatible; the new `ocrText` field is optional everywhere.

**Tech Stack:** TypeScript (Electron main process + Deno Edge Functions), Gemini 2.0 Flash API

---

### Task 1: Update Single Screenshot Analysis Prompt

**Files:**
- Modify: `supabase/functions/gemini-proxy/index.ts:122-147` (RequestBody interface)
- Modify: `supabase/functions/gemini-proxy/index.ts:366-410` (handleAnalyze function)

**Step 1: Add `ocrText` to RequestBody**

In `supabase/functions/gemini-proxy/index.ts`, add `ocrText` field to `RequestBody`:

```typescript
interface RequestBody {
    operation: 'analyze' | 'analyze-batch' | 'classify' | 'summarize';
    taskType?: AITaskType;
    includeUserContext?: boolean;
    // For analyze
    imageBase64?: string;
    appName?: string;
    windowTitle?: string;
    ocrText?: string[];  // <-- ADD THIS: OCR text detected on screen
    // For analyze-batch
    images?: Array<{ base64: string; mimeType: string; appName?: string; windowTitle?: string; ocrText?: string[] }>;
    // ... rest unchanged
}
```

**Step 2: Rewrite the analyze prompt in `handleAnalyze()`**

Replace the prompt construction (lines ~374-391) with:

```typescript
let prompt = `Analyze this screenshot and describe what the user is doing in 2-3 detailed sentences. Include specific details visible on screen: file names, function names, URLs, error messages, UI elements, document titles, or data being viewed. Do NOT give generic descriptions like "editing code" — instead say WHAT code, WHAT file, WHAT function.`;

// Add basic context
if (appName || windowTitle) {
    prompt += `\n\nContext:`;
    if (appName) prompt += `\n- Application: ${appName}`;
    if (windowTitle) prompt += `\n- Window: ${windowTitle}`;
}

// Add OCR text if provided — this gives the LLM exact text from the screen
if (body.ocrText && body.ocrText.length > 0) {
    prompt += `\n\nText detected on screen (use these for specific details):`;
    prompt += `\n${body.ocrText.slice(0, 50).join('\n')}`;
}

// Add context from signals if provided
if (signals && signals.length > 0) {
    const signalContext = buildSignalContextForAnalysis(signals);
    if (signalContext) {
        prompt += `\n\nAdditional Context:${signalContext}`;
    }
}

prompt += `\n\nProvide just the activity description, nothing else.`;
```

**Step 3: Verify the change compiles**

Run: `cd /Users/benoittanguay/Documents/Anti/TimePortal && npx tsc --noEmit --project tsconfig.json 2>&1 | head -20`

Note: Supabase edge functions use Deno, not tsc. Check for syntax errors by reading the file.

**Step 4: Commit**

```bash
git add supabase/functions/gemini-proxy/index.ts
git commit -m "feat(ai): enrich screenshot analysis prompt with OCR text and detail instructions"
```

---

### Task 2: Update Batch Screenshot Analysis Prompt

**Files:**
- Modify: `supabase/functions/_shared/gemini.ts:270-275` (BatchImageInput interface)
- Modify: `supabase/functions/_shared/gemini.ts:303-373` (analyzeImageBatch function)

**Step 1: Add `ocrText` to `BatchImageInput`**

```typescript
export interface BatchImageInput {
    base64: string;
    mimeType: string;
    appName?: string;
    windowTitle?: string;
    ocrText?: string[];  // <-- ADD THIS
}
```

**Step 2: Update the batch prompt and per-image context**

Replace the instruction text (lines ~327-341) with:

```typescript
parts.push({
    text: `Analyze the following ${images.length} screenshots and describe what the user is doing in each one. For each screenshot, provide 2-3 detailed sentences. Include specific details visible on screen: file names, function names, URLs, error messages, UI elements, document titles, or data being viewed. Do NOT give generic descriptions like "editing code" — instead say WHAT code, WHAT file, WHAT function.

Respond with ONLY a JSON array containing exactly ${images.length} objects, one for each image in order. Each object should have:
- "description": a detailed activity description (2-3 sentences)
- "confidence": a number between 0 and 1 indicating your confidence

Example response format:
[
  {"description": "Editing the handleSubmit function in src/components/LoginForm.tsx, adding form validation logic for email and password fields. The VS Code editor shows TypeScript with React hooks.", "confidence": 0.95},
  {"description": "Reviewing pull request #142 on GitHub titled 'Add user authentication flow'. The diff view shows changes to the auth middleware with new JWT token validation.", "confidence": 0.9}
]

Now analyze these ${images.length} screenshots:`
});
```

Replace the per-image context block (lines ~356-362) to include OCR text:

```typescript
// Add context for this image
let context = `\n\nImage ${i + 1}`;
if (img.appName || img.windowTitle) {
    context += ' context:';
    if (img.appName) context += ` Application: ${img.appName}`;
    if (img.windowTitle) context += ` Window: ${img.windowTitle}`;
}
if (img.ocrText && img.ocrText.length > 0) {
    context += `\nText on screen: ${img.ocrText.slice(0, 30).join(', ')}`;
}
parts.push({ text: context });
```

**Step 3: Commit**

```bash
git add supabase/functions/_shared/gemini.ts
git commit -m "feat(ai): update batch analysis prompt for detailed descriptions with OCR text"
```

---

### Task 3: Update Generation Config (Temperature + Max Tokens)

**Files:**
- Modify: `supabase/functions/_shared/gemini.ts:186-192` (analyzeImage generationConfig)
- Modify: `supabase/functions/_shared/gemini.ts:367-373` (analyzeImageBatch generationConfig)

**Step 1: Update `analyzeImage()` generation config**

Change from:
```typescript
generationConfig: {
    temperature: 0.2,
    maxOutputTokens: 1024,
},
```

To:
```typescript
generationConfig: {
    temperature: 0.3,
    maxOutputTokens: 2048,
},
```

**Step 2: Update `analyzeImageBatch()` generation config**

Change from:
```typescript
generationConfig: {
    temperature: 0.2,
    maxOutputTokens: 2048,
},
```

To:
```typescript
generationConfig: {
    temperature: 0.3,
    maxOutputTokens: 4096,
},
```

**Step 3: Commit**

```bash
git add supabase/functions/_shared/gemini.ts
git commit -m "feat(ai): raise temperature to 0.3 and increase max output tokens for richer descriptions"
```

---

### Task 4: Fix Contradictory Summary Prompt

**Files:**
- Modify: `supabase/functions/gemini-proxy/index.ts:927-928` (final instruction in buildSummarizationPrompt)

**Step 1: Fix the contradictory final instruction**

Replace line ~928:
```typescript
sections.push(`\nOutput ONLY the timesheet entry (1-2 sentences). Describe the PRIMARY task, not a list of everything that happened.`);
```

With:
```typescript
sections.push(`\nOutput ONLY the timesheet entry (3-5 sentences). Focus on the PRIMARY productive tasks and include specific details — file names, features, issues, documents. Do not list every app used; describe what was accomplished.`);
```

**Step 2: Commit**

```bash
git add supabase/functions/gemini-proxy/index.ts
git commit -m "fix(ai): resolve contradictory summary length instruction (was 1-2, now consistently 3-5 sentences)"
```

---

### Task 5: Update Batch Proxy Handler to Pass OCR Text

**Files:**
- Modify: `supabase/functions/gemini-proxy/index.ts:416-443` (handleAnalyzeBatch function)

**Step 1: Pass `ocrText` through in the batch handler**

Replace the batch input mapping (lines ~426-431):

```typescript
const batchInput: BatchImageInput[] = images.map(img => ({
    base64: img.base64,
    mimeType: img.mimeType,
    appName: img.appName,
    windowTitle: img.windowTitle,
    ocrText: img.ocrText  // <-- ADD THIS
}));
```

**Step 2: Commit**

```bash
git add supabase/functions/gemini-proxy/index.ts
git commit -m "feat(ai): pass OCR text through batch analysis proxy handler"
```

---

### Task 6: Add OCR Text to Electron Client Types and API Calls

**Files:**
- Modify: `electron/ai/aiService.ts:90-95` (BatchAnalysisInput interface)
- Modify: `electron/ai/aiService.ts:640-670` (analyzeScreenshot method)
- Modify: `electron/ai/aiService.ts:1069-1075` (batch image payload construction)

**Step 1: Add `ocrText` to `BatchAnalysisInput`**

```typescript
export interface BatchAnalysisInput {
    imagePath: string;
    appName?: string;
    windowTitle?: string;
    requestId?: string;
    ocrText?: string[];  // <-- ADD THIS
}
```

**Step 2: Add `ocrText` parameter to `analyzeScreenshot()`**

Update the method signature:

```typescript
async analyzeScreenshot(
    imagePath: string,
    appName?: string,
    windowTitle?: string,
    requestId?: string,
    signals?: AnyContextSignal[],
    ocrText?: string[]  // <-- ADD THIS
): Promise<AnalysisResponse> {
```

Include in the request body:

```typescript
const result = await this.makeRequest({
    operation: 'analyze',
    imageBase64: imageResult.base64,
    appName,
    windowTitle,
    signals,
    ocrText  // <-- ADD THIS
});
```

**Step 3: Add `ocrText` to batch image payload**

Update the payload construction (line ~1070):

```typescript
const imagePayload = validImages.map(img => ({
    base64: img.base64!,
    mimeType: img.mimeType!,
    appName: img.appName,
    windowTitle: img.windowTitle,
    ocrText: img.ocrText  // <-- ADD THIS
}));
```

Also store `ocrText` in the processedImages intermediate array. Find where `processedImages.push` adds successful images (around line ~1035) and add:

```typescript
processedImages.push({
    index: batchStart + i,
    imagePath: input.imagePath,
    base64: imageResult.base64,
    mimeType: imageResult.mimeType,
    appName: input.appName,
    windowTitle: input.windowTitle,
    ocrText: input.ocrText  // <-- ADD THIS
});
```

**Step 4: Run TypeScript compilation check**

Run: `cd /Users/benoittanguay/Documents/Anti/TimePortal && npx tsc --noEmit 2>&1 | head -30`

**Step 5: Commit**

```bash
git add electron/ai/aiService.ts
git commit -m "feat(ai): add ocrText passthrough to screenshot analysis client API"
```

---

### Task 7: Wire OCR Text in IPC Handlers (main.ts + preload)

**Files:**
- Modify: `electron/main.ts:436` (analyze-screenshot IPC handler signature)
- Modify: `electron/main.ts:584-589` (analyzeScreenshot call)
- Modify: `electron/main.ts:657-662` (analyze-screenshot-batch IPC handler)
- Modify: `electron/main.ts:723-728` (batch input construction)
- Modify: `electron/preload.cts:28` (analyzeScreenshot preload bridge)
- Modify: `src/types/electron.d.ts:141` (analyzeScreenshot type)

**Step 1: Update IPC handler to accept `ocrText`**

Update the `analyze-screenshot` handler signature (line ~436):

```typescript
ipcMain.handle('analyze-screenshot', requirePremium('AI Analysis', async (event, imagePath: string, requestId?: string, ocrText?: string[]) => {
```

Pass it through to `aiService.analyzeScreenshot()` (line ~584):

```typescript
const aiResult = await aiService.analyzeScreenshot(
    analyzeImagePath,
    appName,
    windowTitle,
    requestId,
    contextSignals.length > 0 ? contextSignals : undefined,
    ocrText  // <-- ADD THIS
);
```

**Step 2: Update batch IPC handler input type**

Update the batch handler signature (line ~657) to include `ocrText`:

```typescript
ipcMain.handle('analyze-screenshot-batch', requirePremium('AI Analysis', async (event, inputs: Array<{
    imagePath: string;
    appName?: string;
    windowTitle?: string;
    requestId?: string;
    ocrText?: string[];  // <-- ADD THIS
}>) => {
```

Update batch input construction (line ~723):

```typescript
batchInputs.push({
    imagePath: analyzeImagePath,
    appName,
    windowTitle,
    requestId: input.requestId,
    ocrText: input.ocrText  // <-- ADD THIS
});
```

**Step 3: Update preload bridge**

In `electron/preload.cts` (line ~28):

```typescript
analyzeScreenshot: (imagePath: string, requestId?: string, ocrText?: string[]) =>
    ipcRenderer.invoke('analyze-screenshot', imagePath, requestId, ocrText),
```

Update batch input type (lines ~29-34):

```typescript
analyzeScreenshotBatch: (inputs: Array<{
    imagePath: string;
    appName?: string;
    windowTitle?: string;
    requestId?: string;
    ocrText?: string[];  // <-- ADD THIS
}>) => ipcRenderer.invoke('analyze-screenshot-batch', inputs),
```

**Step 4: Update TypeScript type definition**

In `src/types/electron.d.ts` (line ~141):

```typescript
analyzeScreenshot: (imagePath: string, requestId?: string, ocrText?: string[]) => Promise<ScreenshotAnalysisResult>;
```

**Step 5: Run TypeScript compilation**

Run: `cd /Users/benoittanguay/Documents/Anti/TimePortal && npx tsc --noEmit 2>&1 | head -30`

**Step 6: Commit**

```bash
git add electron/main.ts electron/preload.cts src/types/electron.d.ts
git commit -m "feat(ai): wire ocrText through IPC handlers and preload bridge"
```

---

### Task 8: Add OCR Text Filtering Utility

**Files:**
- Modify: `electron/ai/aiService.ts` (add filterOcrText helper near top of file, after imports)

**Step 1: Add the filtering function**

Add after the `IMAGE_CONFIG` constant (around line ~25):

```typescript
/**
 * Filter and deduplicate OCR text for AI prompt inclusion.
 * Removes noise (short strings, duplicates) and caps at a reasonable count.
 */
export function filterOcrText(texts: string[], maxEntries = 50): string[] {
    if (!texts || texts.length === 0) return [];

    const seen = new Set<string>();
    const filtered: string[] = [];

    for (const text of texts) {
        const trimmed = text.trim();
        // Skip very short strings (UI chrome, single chars)
        if (trimmed.length < 3) continue;
        // Skip duplicates (case-insensitive)
        const key = trimmed.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        filtered.push(trimmed);
    }

    // Prioritize longer strings (more likely to be meaningful content)
    filtered.sort((a, b) => b.length - a.length);

    return filtered.slice(0, maxEntries);
}
```

**Step 2: Commit**

```bash
git add electron/ai/aiService.ts
git commit -m "feat(ai): add filterOcrText utility for cleaning OCR data before AI prompt inclusion"
```

---

### Task 9: Verify End-to-End (Manual Test)

**Step 1: Start the dev server**

Run: `cd /Users/benoittanguay/Documents/Anti/TimePortal && npm run dev:electron`

**Step 2: Trigger a screenshot capture and verify in logs that:**
- The analyze prompt now asks for "2-3 detailed sentences"
- The summary prompt final instruction says "3-5 sentences"
- No TypeScript errors on startup

**Step 3: Check a generated description is longer and more specific than before**

**Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(ai): address issues found during manual testing"
```

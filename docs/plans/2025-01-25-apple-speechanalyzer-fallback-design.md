# Apple SpeechAnalyzer Fallback for Transcription

**Date:** 2025-01-25
**Status:** Implementing

## Overview

Add Apple's on-device Speech Recognition as a fallback/primary transcription engine based on user tier and usage quotas.

## User Tiers & Transcription Logic

| Tier | Primary Engine | Fallback | Monthly Limit |
|------|---------------|----------|---------------|
| Free | Apple on-device | Groq (if Apple unavailable) | 8 hrs/month |
| Premium/Trial | Groq (first 20 hrs) | Apple on-device (after 20 hrs) | 20 hrs Groq + unlimited Apple |

### Routing Logic:

**Free users:**
- Use Apple Speech Recognition (on-device)
- 8 hours/month limit
- If Apple unavailable (macOS < 10.15, Intel Mac): Fall back to Groq with same 8hr limit

**Premium/Trial users:**
- First 20 hours: Groq Whisper Large v3 Turbo (best quality)
- After 20 hours: Apple on-device (unlimited)
- If Apple unavailable: Continue with Groq (no hard cutoff)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   TranscriptionService                       │
├─────────────────────────────────────────────────────────────┤
│  transcribe(audio, entryId)                                 │
│    │                                                        │
│    ├─ isFree?                                               │
│    │    └─ Apple (8hr/month limit)                          │
│    │         └─ Groq fallback if Apple unavailable          │
│    │                                                        │
│    └─ isPremium/Trial?                                      │
│         ├─ Groq quota remaining? ──► Groq (track usage)     │
│         └─ Groq quota exceeded? ───► Apple (unlimited)      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────┐     ┌─────────────────────┐
│  AppleTranscriber   │     │   GroqTranscriber   │
│  (native module)    │     │  (edge function)    │
├─────────────────────┤     ├─────────────────────┤
│ - On-device         │     │ - Cloud-based       │
│ - macOS 10.15+      │     │ - Any platform      │
│ - Free              │     │ - Higher quality    │
│ - Unlimited (after  │     │ - ~$0.04/hr         │
│   Groq quota)       │     │ - 20hr premium cap  │
└─────────────────────┘     └─────────────────────┘
```

## Implementation Components

### 1. Native Module (`electron/native/`)

**New files:**
- `src/speech_transcriber.h` - Header with N-API bindings
- `src/speech_transcriber.mm` - Objective-C++ implementation using SFSpeechRecognizer

**Exported functions:**
- `isSpeechTranscriptionAvailable()` - Check if Apple Speech is available
- `getSupportedTranscriptionLanguages()` - List available languages
- `transcribeAudioFile(filePath, language?)` - Transcribe from file
- `transcribeAudioBuffer(buffer, sampleRate, language?)` - Transcribe from buffer

**Framework linkage (binding.gyp):**
```
"-framework Speech",
"-framework AudioToolbox"
```

### 2. TypeScript Service Layer (`electron/meeting/`)

**New file:** `appleTranscriber.ts`
- Wraps native module
- Provides same interface as Groq transcriber
- Handles availability checks

**Modified:** `transcriptionService.ts`
- Added `shouldUseAppleTranscription()` routing logic
- Added `groqUsageSeconds` tracking for premium users
- Added `setPremiumStatus()` and `setGroqUsage()` methods
- Routes based on tier and quota

### 3. Edge Function (`supabase/functions/groq-transcribe/`)

**Updated limits:**
```typescript
const MONTHLY_LIMIT_FREE_SECONDS = 8 * 60 * 60;    // 8 hours
const MONTHLY_LIMIT_PREMIUM_SECONDS = 20 * 60 * 60; // 20 hours
```

**New response field:**
- `quotaExceeded: true` - Signals client to use Apple fallback

## Data Flow

### Premium user (within Groq quota):
```
Audio → TranscriptionService
         ├─ isPremium? Yes
         ├─ Groq quota remaining? Yes
         └─ GroqTranscriber → Edge Function → Groq API
              └─ Track usage in DB
              └─ Return result
```

### Premium user (Groq quota exceeded):
```
Audio → TranscriptionService
         ├─ isPremium? Yes
         ├─ Groq quota remaining? No
         └─ AppleTranscriber → Native Module → SFSpeechRecognizer
              └─ Return result (no quota tracking)
```

### Free user:
```
Audio → TranscriptionService
         ├─ isPremium? No
         └─ AppleTranscriber → Native Module → SFSpeechRecognizer
              └─ Check 8hr limit (local)
              └─ Return result
```

## API Compatibility

Both transcribers return the same `TranscriptionResult` interface:

```typescript
interface TranscriptionResult {
  success: boolean;
  transcriptionId: string;
  segments: TranscriptionSegment[];
  fullText: string;
  language: string;
  duration: number;
  wordCount: number;
  error?: string;
}
```

## DMG Size Impact

| Component | Size |
|-----------|------|
| Speech.framework | 0 MB (system) |
| AudioToolbox.framework | 0 MB (system) |
| Native module code | ~50-100 KB |
| **Total** | **< 0.1 MB** |

Current DMG: 217 MB → New DMG: ~217 MB (negligible increase)

## Runtime Requirements

- **Apple Speech:** macOS 10.15+ (Catalina), any processor
- **On-device recognition:** macOS 13+ (Ventura) for best performance
- **Groq:** Any macOS with internet

## Files Modified/Created

**Created:**
- `electron/native/src/speech_transcriber.h`
- `electron/native/src/speech_transcriber.mm`
- `electron/meeting/appleTranscriber.ts`

**Modified:**
- `electron/native/binding.gyp` - Added Speech, AudioToolbox frameworks
- `electron/native/src/index.mm` - Export new functions
- `electron/meeting/transcriptionService.ts` - Routing logic
- `electron/auth/ipcHandlers.ts` - Premium status updates
- `supabase/functions/groq-transcribe/index.ts` - New limits

## Migration Notes

- Free users: Now use Apple on-device (8hr/month)
- Premium users: Get 20hrs Groq then unlimited Apple
- Existing usage tracking continues to work
- No database migrations needed

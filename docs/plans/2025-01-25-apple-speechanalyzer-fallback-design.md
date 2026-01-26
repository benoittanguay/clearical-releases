# Apple SpeechAnalyzer Fallback for Transcription

**Date:** 2025-01-25
**Status:** Draft

## Overview

Add Apple's on-device SpeechAnalyzer API as the primary transcription engine for free-tier users, with Groq Whisper as a fallback when Apple's API is unavailable.

## User Tiers & Transcription Logic

| Tier | Primary Engine | Fallback | Limit |
|------|---------------|----------|-------|
| Free | Apple SpeechAnalyzer | Groq (if Apple unavailable) | 10hr/month on Groq |
| Premium/Trial | Groq Whisper Large v3 Turbo | - | Unlimited |

### When Apple SpeechAnalyzer is unavailable:
- macOS < 16.0 (Tahoe)
- Intel Macs (no Apple Silicon)
- API failure/crash

In these cases, free-tier users fall back to Groq with the existing 10hr/month cap.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   TranscriptionService                       │
├─────────────────────────────────────────────────────────────┤
│  transcribe(audio, entryId)                                 │
│    ├─ isPremium? ──────────────────────► GroqTranscriber    │
│    └─ isFree?                                               │
│         ├─ isAppleAvailable? ──────────► AppleTranscriber   │
│         └─ else (fallback) ────────────► GroqTranscriber    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────┐     ┌─────────────────────┐
│  AppleTranscriber   │     │   GroqTranscriber   │
│  (native module)    │     │  (edge function)    │
├─────────────────────┤     ├─────────────────────┤
│ - On-device         │     │ - Cloud-based       │
│ - macOS 16+ only    │     │ - Any platform      │
│ - Apple Silicon     │     │ - Higher quality    │
│ - Free              │     │ - ~$0.04/hr         │
└─────────────────────┘     └─────────────────────┘
```

## Implementation Components

### 1. Native Module Extension (`electron/native/`)

Add SpeechAnalyzer wrapper to existing `media_monitor` native module:

**New files:**
- `src/speech_transcriber.h` - Header with N-API bindings
- `src/speech_transcriber.mm` - Objective-C++ implementation

**Capabilities to expose:**
- `isAvailable()` - Check if SpeechAnalyzer is available (macOS 16+, Apple Silicon)
- `transcribe(audioBuffer, language?)` - Transcribe audio, return text + segments
- `getSupportedLanguages()` - List available languages

**Framework linkage (binding.gyp):**
```
"-framework Speech"
```

### 2. TypeScript Service Layer (`electron/meeting/`)

**Modify:** `transcriptionService.ts`
- Add `AppleTranscriber` class that calls native module
- Update `transcribe()` to route based on tier + availability
- Emit same events for UI compatibility

**New:** `appleTranscriber.ts`
```typescript
export class AppleTranscriber {
  static isAvailable(): boolean
  async transcribe(audioBase64: string, language?: string): Promise<TranscriptionResult>
}
```

### 3. Native Module TypeScript Types

**Modify:** `src/types/electron.d.ts`
- Add `speechTranscriber` to native module types

## Data Flow

### Free-tier user (Apple available):
```
Audio Buffer
    │
    ▼
TranscriptionService.transcribe()
    │
    ├─ Check: isPremium? → No
    ├─ Check: AppleTranscriber.isAvailable()? → Yes
    │
    ▼
AppleTranscriber.transcribe()
    │
    ▼
Native Module (speech_transcriber.mm)
    │
    ▼
SpeechAnalyzer Framework (on-device)
    │
    ▼
TranscriptionResult { text, segments, language, duration }
```

### Free-tier user (Apple NOT available):
```
Audio Buffer
    │
    ▼
TranscriptionService.transcribe()
    │
    ├─ Check: isPremium? → No
    ├─ Check: AppleTranscriber.isAvailable()? → No
    ├─ Check: monthlyUsage < 10hr? → Yes
    │
    ▼
GroqTranscriber (existing flow via Edge Function)
    │
    ▼
TranscriptionResult
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

interface TranscriptionSegment {
  id: number;
  start: number;  // seconds
  end: number;    // seconds
  text: string;
}
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Apple transcription fails mid-process | Return error, do NOT fall back to Groq (avoid double-billing risk) |
| Apple not available at start | Fall back to Groq (with limit check) |
| Groq limit exceeded | Return error with upgrade prompt |
| Network error (Groq) | Return error, suggest retry |

## DMG Size Impact

| Component | Size |
|-----------|------|
| Speech.framework | 0 MB (system) |
| Native module code | ~50-100 KB |
| **Total** | **< 0.1 MB** |

Current DMG: 217 MB → New DMG: ~217 MB (negligible increase)

## Runtime Requirements

- **Apple SpeechAnalyzer:** macOS 16.0+ (Tahoe), Apple Silicon
- **Groq fallback:** Any macOS with internet

## Testing Plan

1. **Unit tests:** Mock native module, test routing logic
2. **Integration tests:**
   - Transcribe sample audio with Apple
   - Verify fallback triggers on simulated unavailability
3. **Manual testing:**
   - Test on macOS 16 (Apple path)
   - Test on macOS 14 (Groq fallback path)

## Migration Notes

- Existing premium users: No change
- Existing free users on macOS 16+: Automatic upgrade to on-device
- Existing free users on older macOS: Continue using Groq with limits

## Files to Modify/Create

**Create:**
- `electron/native/src/speech_transcriber.h`
- `electron/native/src/speech_transcriber.mm`
- `electron/meeting/appleTranscriber.ts`

**Modify:**
- `electron/native/binding.gyp` - Add Speech framework
- `electron/native/src/index.mm` - Export new functions
- `electron/meeting/transcriptionService.ts` - Add routing logic
- `src/types/electron.d.ts` - Add types

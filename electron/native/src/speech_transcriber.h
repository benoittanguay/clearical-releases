// electron/native/src/speech_transcriber.h
#ifndef SPEECH_TRANSCRIBER_H
#define SPEECH_TRANSCRIBER_H

#import <Foundation/Foundation.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Transcription segment with timing information
 */
@interface TranscriptionSegment : NSObject
@property (nonatomic, assign) NSInteger segmentId;
@property (nonatomic, assign) double startTime;
@property (nonatomic, assign) double endTime;
@property (nonatomic, copy) NSString *text;
@end

/**
 * Result from a transcription operation
 */
@interface TranscriptionResult : NSObject
@property (nonatomic, assign) BOOL success;
@property (nonatomic, copy) NSString *text;
@property (nonatomic, copy) NSString *language;
@property (nonatomic, assign) double duration;
@property (nonatomic, strong) NSArray<TranscriptionSegment *> *segments;
@property (nonatomic, copy) NSString *error;
@end

/**
 * SpeechTranscriberWrapper
 *
 * Wraps Apple's SpeechAnalyzer API (macOS 16+) for on-device transcription.
 * Falls back gracefully on older systems.
 */
@interface SpeechTranscriberWrapper : NSObject

/**
 * Check if Apple's SpeechAnalyzer is available on this system.
 * Requires macOS 16.0+ and Apple Silicon.
 */
+ (BOOL)isAvailable;

/**
 * Get the list of supported language codes (ISO 639-1)
 */
+ (NSArray<NSString *> *)supportedLanguages;

/**
 * Transcribe audio data synchronously.
 *
 * @param audioData Raw audio data (PCM float32, mono, 16kHz preferred)
 * @param sampleRate Sample rate of the audio data
 * @param language Optional language hint (ISO 639-1 code, e.g., "en", "fr")
 * @return TranscriptionResult with text, segments, and timing information
 */
+ (TranscriptionResult *)transcribeAudioData:(NSData *)audioData
                                  sampleRate:(double)sampleRate
                                    language:(NSString *)language;

/**
 * Transcribe audio from a file path.
 *
 * @param filePath Path to audio file (supports wav, m4a, mp3, etc.)
 * @param language Optional language hint (ISO 639-1 code)
 * @return TranscriptionResult with text, segments, and timing information
 */
+ (TranscriptionResult *)transcribeFile:(NSString *)filePath
                               language:(NSString *)language;

@end

#ifdef __cplusplus
}
#endif

#endif // SPEECH_TRANSCRIBER_H

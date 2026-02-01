// electron/native/src/system_audio_capture.h
#ifndef SYSTEM_AUDIO_CAPTURE_H
#define SYSTEM_AUDIO_CAPTURE_H

#import <Foundation/Foundation.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <CoreMedia/CoreMedia.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Callback for receiving audio samples
 * @param samples Pointer to interleaved float audio samples
 * @param sampleCount Number of samples (per channel)
 * @param channelCount Number of channels (usually 2 for stereo)
 * @param sampleRate Sample rate in Hz
 */
typedef void (*AudioSamplesCallback)(const float* samples, size_t sampleCount, int channelCount, double sampleRate);

API_AVAILABLE(macos(13.0))
@interface SystemAudioCapture : NSObject <SCStreamDelegate, SCStreamOutput>

@property (nonatomic, assign) AudioSamplesCallback audioCallback;
@property (nonatomic, assign, readonly) BOOL isCapturing;
@property (nonatomic, assign, readonly) double detectedSampleRate;
@property (nonatomic, assign, readonly) BOOL isResampling;
@property (nonatomic, assign, readonly) BOOL sampleRateDetected;
@property (nonatomic, assign, readonly) BOOL isRecordingToFile;
@property (nonatomic, copy, readonly) NSString * _Nullable outputFilePath;
@property (nonatomic, assign, readonly) double actualSampleRate;

+ (instancetype)sharedInstance;

/**
 * Check if system audio capture is available (macOS 12.3+)
 */
+ (BOOL)isAvailable;

/**
 * Start capturing system audio
 * Requires Screen Recording permission
 */
- (void)startCaptureWithCompletion:(void (^)(BOOL success, NSError * _Nullable error))completion;

/**
 * Stop capturing system audio
 */
- (void)stopCapture;

/**
 * Start recording audio to a WAV file
 * @param filePath Path where the WAV file will be written
 * @return YES if recording started successfully
 */
- (BOOL)startRecordingToFile:(NSString * _Nonnull)filePath;

/**
 * Stop recording and finalize the WAV file
 * @return Path to the recorded file, or nil if not recording
 */
- (NSString * _Nullable)stopRecording;

@end

#ifdef __cplusplus
}
#endif

#endif // SYSTEM_AUDIO_CAPTURE_H

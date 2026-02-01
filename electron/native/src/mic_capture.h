// electron/native/src/mic_capture.h
#ifndef MIC_CAPTURE_H
#define MIC_CAPTURE_H

#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreAudio/CoreAudio.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Callback for receiving microphone audio samples
 * @param samples Pointer to interleaved float audio samples
 * @param sampleCount Number of samples (per channel)
 * @param channelCount Number of channels (usually 1 for mono mic)
 * @param sampleRate Sample rate in Hz
 */
typedef void (*MicAudioSamplesCallback)(const float* _Nonnull samples, size_t sampleCount, int channelCount, double sampleRate);

/**
 * Native microphone capture using AVFoundation
 * This bypasses getUserMedia limitations where Chrome has exclusive mic access
 */
@interface MicCapture : NSObject <AVCaptureAudioDataOutputSampleBufferDelegate>

@property (nonatomic, assign) MicAudioSamplesCallback _Nullable audioCallback;
@property (nonatomic, assign, readonly) BOOL isCapturing;
@property (nonatomic, assign, readonly) double detectedSampleRate;
@property (nonatomic, assign, readonly) BOOL isResampling;
@property (nonatomic, assign, readonly) BOOL sampleRateDetected;
@property (nonatomic, assign, readonly) BOOL isRecordingToFile;
@property (nonatomic, copy, readonly) NSString * _Nullable outputFilePath;
@property (nonatomic, assign, readonly) double actualSampleRate;

+ (instancetype _Nonnull)sharedInstance;

/**
 * Check if microphone capture is available
 */
+ (BOOL)isAvailable;

/**
 * Start capturing microphone audio
 * Requires Microphone permission
 */
- (void)startCaptureWithCompletion:(void (^ _Nullable)(BOOL success, NSError * _Nullable error))completion;

/**
 * Stop capturing microphone audio
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

#endif // MIC_CAPTURE_H

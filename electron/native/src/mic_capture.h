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

@end

#ifdef __cplusplus
}
#endif

#endif // MIC_CAPTURE_H

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

@end

#ifdef __cplusplus
}
#endif

#endif // SYSTEM_AUDIO_CAPTURE_H

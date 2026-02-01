// electron/native/src/system_audio_capture.mm
#import "system_audio_capture.h"
#import <AVFoundation/AVFoundation.h>
#import <Accelerate/Accelerate.h>

// Target sample rate for output (must match AudioContext in renderer)
static const double kTargetSampleRate = 48000.0;

API_AVAILABLE(macos(12.3))
@implementation SystemAudioCapture {
    SCStream *_stream;
    SCStreamConfiguration *_config;
    SCContentFilter *_filter;
    dispatch_queue_t _captureQueue;
    BOOL _isCapturing;

    // Resampling state
    double _lastSourceSampleRate;
    float *_resampleBuffer;
    size_t _resampleBufferCapacity;
}

+ (instancetype)sharedInstance {
    static SystemAudioCapture *instance = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        if (@available(macOS 13.0, *)) {
            instance = [[SystemAudioCapture alloc] init];
        }
    });
    return instance;
}

+ (BOOL)isAvailable {
    // Audio capture requires macOS 13.0+ (when capturesAudio was added)
    if (@available(macOS 13.0, *)) {
        return YES;
    }
    return NO;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        _isCapturing = NO;
        _audioCallback = NULL;
        _captureQueue = dispatch_queue_create("com.systemaudocapture.queue", DISPATCH_QUEUE_SERIAL);
        _lastSourceSampleRate = 0;
        _resampleBuffer = NULL;
        _resampleBufferCapacity = 0;
    }
    return self;
}

- (void)dealloc {
    if (_resampleBuffer) {
        free(_resampleBuffer);
        _resampleBuffer = NULL;
    }
}

- (BOOL)isCapturing {
    return _isCapturing;
}

- (void)startCaptureWithCompletion:(void (^)(BOOL success, NSError * _Nullable error))completion {
    if (@available(macOS 13.0, *)) {
        if (_isCapturing) {
            NSLog(@"[SystemAudioCapture] Already capturing");
            if (completion) {
                completion(YES, nil);
            }
            return;
        }

        NSLog(@"[SystemAudioCapture] Starting system audio capture...");

        // Get shareable content
        [SCShareableContent getShareableContentWithCompletionHandler:^(SCShareableContent * _Nullable content, NSError * _Nullable error) {
            if (error) {
                NSLog(@"[SystemAudioCapture] Failed to get shareable content: %@", error);
                if (completion) {
                    completion(NO, error);
                }
                return;
            }

            // Create a content filter that captures all audio (no specific window/app)
            // We use the first display as the base, but configure to capture audio only
            SCDisplay *display = content.displays.firstObject;
            if (!display) {
                NSLog(@"[SystemAudioCapture] No display found");
                if (completion) {
                    NSError *noDisplayError = [NSError errorWithDomain:@"SystemAudioCapture"
                                                                  code:-1
                                                              userInfo:@{NSLocalizedDescriptionKey: @"No display found"}];
                    completion(NO, noDisplayError);
                }
                return;
            }

            // Create filter to capture entire display (but we only want audio)
            self->_filter = [[SCContentFilter alloc] initWithDisplay:display excludingWindows:@[]];

            // Configure for audio-only capture
            self->_config = [[SCStreamConfiguration alloc] init];

            // Minimize video (we only want audio)
            self->_config.width = 2;
            self->_config.height = 2;
            self->_config.minimumFrameInterval = CMTimeMake(1, 1); // 1 fps minimum
            self->_config.showsCursor = NO;

            // Audio configuration
            self->_config.capturesAudio = YES;
            self->_config.sampleRate = 48000;
            self->_config.channelCount = 2;

            // Exclude our own app's audio to prevent feedback
            if (@available(macOS 13.0, *)) {
                self->_config.excludesCurrentProcessAudio = YES;
            }

            // Create the stream
            self->_stream = [[SCStream alloc] initWithFilter:self->_filter
                                               configuration:self->_config
                                                    delegate:self];

            NSError *addOutputError = nil;

            // Add audio output
            BOOL audioAdded = [self->_stream addStreamOutput:self
                                                        type:SCStreamOutputTypeAudio
                                          sampleHandlerQueue:self->_captureQueue
                                                       error:&addOutputError];

            if (!audioAdded) {
                NSLog(@"[SystemAudioCapture] Failed to add audio output: %@", addOutputError);
                if (completion) {
                    completion(NO, addOutputError);
                }
                return;
            }

            // Start capturing
            [self->_stream startCaptureWithCompletionHandler:^(NSError * _Nullable startError) {
                if (startError) {
                    NSLog(@"[SystemAudioCapture] Failed to start capture: %@", startError);
                    if (completion) {
                        completion(NO, startError);
                    }
                    return;
                }

                self->_isCapturing = YES;
                NSLog(@"[SystemAudioCapture] System audio capture started successfully");
                if (completion) {
                    completion(YES, nil);
                }
            }];
        }];
    } else {
        NSLog(@"[SystemAudioCapture] ScreenCaptureKit not available on this macOS version");
        if (completion) {
            NSError *unavailableError = [NSError errorWithDomain:@"SystemAudioCapture"
                                                            code:-2
                                                        userInfo:@{NSLocalizedDescriptionKey: @"ScreenCaptureKit requires macOS 12.3 or later"}];
            completion(NO, unavailableError);
        }
    }
}

- (void)stopCapture {
    if (@available(macOS 13.0, *)) {
        if (!_isCapturing) {
            NSLog(@"[SystemAudioCapture] Not capturing");
            return;
        }

        NSLog(@"[SystemAudioCapture] Stopping system audio capture...");

        [_stream stopCaptureWithCompletionHandler:^(NSError * _Nullable error) {
            if (error) {
                NSLog(@"[SystemAudioCapture] Error stopping capture: %@", error);
            } else {
                NSLog(@"[SystemAudioCapture] System audio capture stopped");
            }
        }];

        _stream = nil;
        _filter = nil;
        _config = nil;
        _isCapturing = NO;
    }
}

#pragma mark - SCStreamDelegate

- (void)stream:(SCStream *)stream didStopWithError:(NSError *)error API_AVAILABLE(macos(12.3)) {
    NSLog(@"[SystemAudioCapture] Stream stopped with error: %@", error);
    _isCapturing = NO;
}

#pragma mark - SCStreamOutput

// Helper method to resample audio from source rate to target rate using linear interpolation
- (float *)resampleAudio:(const float *)inputSamples
             inputLength:(size_t)inputLength
          sourceSampleRate:(double)sourceSampleRate
            outputLength:(size_t *)outputLength {

    double ratio = kTargetSampleRate / sourceSampleRate;
    size_t newLength = (size_t)(inputLength * ratio);
    *outputLength = newLength;

    // Ensure we have enough buffer capacity
    if (newLength > _resampleBufferCapacity) {
        if (_resampleBuffer) {
            free(_resampleBuffer);
        }
        _resampleBufferCapacity = newLength * 2; // Allocate extra to reduce reallocations
        _resampleBuffer = (float *)malloc(_resampleBufferCapacity * sizeof(float));
        if (!_resampleBuffer) {
            _resampleBufferCapacity = 0;
            return NULL;
        }
    }

    // Linear interpolation resampling
    for (size_t i = 0; i < newLength; i++) {
        double srcIndex = i / ratio;
        size_t srcIndexFloor = (size_t)srcIndex;
        size_t srcIndexCeil = srcIndexFloor + 1;
        double frac = srcIndex - srcIndexFloor;

        if (srcIndexCeil >= inputLength) {
            srcIndexCeil = inputLength - 1;
        }

        _resampleBuffer[i] = (float)((1.0 - frac) * inputSamples[srcIndexFloor] + frac * inputSamples[srcIndexCeil]);
    }

    return _resampleBuffer;
}

- (void)stream:(SCStream *)stream didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer ofType:(SCStreamOutputType)type API_AVAILABLE(macos(12.3)) {
    if (type != SCStreamOutputTypeAudio) {
        return; // Ignore video frames
    }

    if (!_audioCallback) {
        return; // No callback registered
    }

    // Get audio buffer list
    CMBlockBufferRef blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer);
    if (!blockBuffer) {
        return;
    }

    // Get format description
    CMFormatDescriptionRef formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer);
    const AudioStreamBasicDescription *asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc);
    if (!asbd) {
        return;
    }

    size_t totalBytes = 0;
    char *dataPointer = NULL;
    OSStatus status = CMBlockBufferGetDataPointer(blockBuffer, 0, NULL, &totalBytes, &dataPointer);
    if (status != noErr || !dataPointer) {
        return;
    }

    // Check audio format flags
    BOOL isFloat = (asbd->mFormatFlags & kAudioFormatFlagIsFloat) != 0;
    BOOL is32Bit = (asbd->mBitsPerChannel == 32);
    double sourceSampleRate = asbd->mSampleRate;
    BOOL needsResampling = (fabs(sourceSampleRate - kTargetSampleRate) > 1.0); // Allow 1Hz tolerance

    static int callbackCount = 0;
    callbackCount++;

    if (callbackCount % 100 == 1) {
        NSLog(@"[SystemAudioCapture] Audio callback #%d: sampleRate=%.0f (target=%.0f, resample=%d), channels=%u, bitsPerChannel=%u, isFloat=%d, bytesPerFrame=%u, totalBytes=%zu",
              callbackCount, sourceSampleRate, kTargetSampleRate, needsResampling, asbd->mChannelsPerFrame, asbd->mBitsPerChannel, isFloat, asbd->mBytesPerFrame, totalBytes);
    }

    // First, get the audio as float samples
    float *floatSamples = NULL;
    size_t totalSamples = 0;
    BOOL needsFree = NO;

    if (isFloat && is32Bit) {
        // Already in float format
        totalSamples = totalBytes / sizeof(float);
        floatSamples = (float *)dataPointer;
    } else if (!isFloat && asbd->mBitsPerChannel == 16) {
        // Convert from 16-bit signed int to float
        totalSamples = totalBytes / sizeof(int16_t);
        floatSamples = (float *)malloc(totalSamples * sizeof(float));
        if (!floatSamples) {
            return;
        }
        needsFree = YES;

        vDSP_vflt16((const int16_t *)dataPointer, 1, floatSamples, 1, totalSamples);
        float scale = 1.0f / 32768.0f;
        vDSP_vsmul(floatSamples, 1, &scale, floatSamples, 1, totalSamples);
    } else if (!isFloat && asbd->mBitsPerChannel == 32) {
        // Convert from 32-bit signed int to float
        totalSamples = totalBytes / sizeof(int32_t);
        floatSamples = (float *)malloc(totalSamples * sizeof(float));
        if (!floatSamples) {
            return;
        }
        needsFree = YES;

        vDSP_vflt32((const int32_t *)dataPointer, 1, floatSamples, 1, totalSamples);
        float scale = 1.0f / 2147483648.0f;
        vDSP_vsmul(floatSamples, 1, &scale, floatSamples, 1, totalSamples);
    } else {
        // Unsupported format
        if (callbackCount % 100 == 1) {
            NSLog(@"[SystemAudioCapture] Unsupported audio format: isFloat=%d, bitsPerChannel=%u", isFloat, asbd->mBitsPerChannel);
        }
        return;
    }

    // Now resample if needed
    size_t samplesPerChannel = totalSamples / asbd->mChannelsPerFrame;

    if (needsResampling) {
        size_t resampledLength = 0;
        float *resampledSamples = [self resampleAudio:floatSamples
                                          inputLength:totalSamples
                                       sourceSampleRate:sourceSampleRate
                                         outputLength:&resampledLength];

        if (resampledSamples) {
            size_t resampledSamplesPerChannel = resampledLength / asbd->mChannelsPerFrame;
            _audioCallback(resampledSamples,
                           resampledSamplesPerChannel,
                           asbd->mChannelsPerFrame,
                           kTargetSampleRate); // Report target rate since we resampled
        }
    } else {
        // No resampling needed, pass through
        _audioCallback(floatSamples,
                       samplesPerChannel,
                       asbd->mChannelsPerFrame,
                       sourceSampleRate);
    }

    if (needsFree && floatSamples) {
        free(floatSamples);
    }
}

@end

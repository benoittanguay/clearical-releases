// electron/native/src/system_audio_capture.mm
#import "system_audio_capture.h"
#import <AVFoundation/AVFoundation.h>

API_AVAILABLE(macos(12.3))
@implementation SystemAudioCapture {
    SCStream *_stream;
    SCStreamConfiguration *_config;
    SCContentFilter *_filter;
    dispatch_queue_t _captureQueue;
    BOOL _isCapturing;
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
    }
    return self;
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

    // Calculate sample count
    size_t bytesPerSample = sizeof(float);
    size_t totalSamples = totalBytes / bytesPerSample;
    size_t samplesPerChannel = totalSamples / asbd->mChannelsPerFrame;

    // Pass to callback
    _audioCallback((const float *)dataPointer,
                   samplesPerChannel,
                   asbd->mChannelsPerFrame,
                   asbd->mSampleRate);
}

@end

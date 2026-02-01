// electron/native/src/mic_capture.mm
#import "mic_capture.h"
#import <Accelerate/Accelerate.h>

// Target sample rate for output (must match AudioContext in renderer)
static const double kTargetSampleRate = 48000.0;

@implementation MicCapture {
    AVCaptureSession *_captureSession;
    AVCaptureAudioDataOutput *_audioOutput;
    dispatch_queue_t _captureQueue;
    BOOL _isCapturing;

    // Resampling state
    float *_resampleBuffer;
    size_t _resampleBufferCapacity;
}

+ (instancetype)sharedInstance {
    static MicCapture *instance = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        instance = [[MicCapture alloc] init];
    });
    return instance;
}

+ (BOOL)isAvailable {
    // Check if we have microphone access authorization
    AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];

    // Available if authorized or not yet determined (we can request)
    return (status == AVAuthorizationStatusAuthorized || status == AVAuthorizationStatusNotDetermined);
}

- (instancetype)init {
    self = [super init];
    if (self) {
        _isCapturing = NO;
        _audioCallback = NULL;
        _captureQueue = dispatch_queue_create("com.miccapture.queue", DISPATCH_QUEUE_SERIAL);
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

- (BOOL)isCapturing {
    return _isCapturing;
}

- (void)startCaptureWithCompletion:(void (^)(BOOL success, NSError * _Nullable error))completion {
    if (_isCapturing) {
        NSLog(@"[MicCapture] Already capturing");
        if (completion) {
            completion(YES, nil);
        }
        return;
    }

    NSLog(@"[MicCapture] Starting microphone capture...");

    // Check/request microphone permission
    AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];

    if (status == AVAuthorizationStatusNotDetermined) {
        NSLog(@"[MicCapture] Requesting microphone permission...");
        [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio completionHandler:^(BOOL granted) {
            if (granted) {
                NSLog(@"[MicCapture] Microphone permission granted");
                [self setupAndStartCapture:completion];
            } else {
                NSLog(@"[MicCapture] Microphone permission denied");
                if (completion) {
                    NSError *error = [NSError errorWithDomain:@"MicCapture"
                                                        code:-1
                                                    userInfo:@{NSLocalizedDescriptionKey: @"Microphone permission denied"}];
                    completion(NO, error);
                }
            }
        }];
    } else if (status == AVAuthorizationStatusAuthorized) {
        [self setupAndStartCapture:completion];
    } else {
        NSLog(@"[MicCapture] Microphone permission not authorized: %ld", (long)status);
        if (completion) {
            NSError *error = [NSError errorWithDomain:@"MicCapture"
                                                code:-2
                                            userInfo:@{NSLocalizedDescriptionKey: @"Microphone access not authorized"}];
            completion(NO, error);
        }
    }
}

- (void)setupAndStartCapture:(void (^)(BOOL success, NSError * _Nullable error))completion {
    // IMPORTANT: Do NOT use dispatch_get_main_queue() here!
    // The caller (StartMicCapture in index.mm) blocks the main thread with a semaphore,
    // so dispatching to main queue would cause a deadlock.
    // Use a serial queue instead for AVCaptureSession setup.
    dispatch_async(self->_captureQueue, ^{
        NSError *error = nil;

        // Create capture session
        self->_captureSession = [[AVCaptureSession alloc] init];
        [self->_captureSession beginConfiguration];

        // Get default audio device (microphone)
        AVCaptureDevice *audioDevice = [AVCaptureDevice defaultDeviceWithMediaType:AVMediaTypeAudio];
        if (!audioDevice) {
            NSLog(@"[MicCapture] No audio device found");
            if (completion) {
                NSError *noDeviceError = [NSError errorWithDomain:@"MicCapture"
                                                            code:-3
                                                        userInfo:@{NSLocalizedDescriptionKey: @"No audio input device found"}];
                completion(NO, noDeviceError);
            }
            return;
        }

        NSLog(@"[MicCapture] Using audio device: %@", audioDevice.localizedName);

        // Create audio input
        AVCaptureDeviceInput *audioInput = [AVCaptureDeviceInput deviceInputWithDevice:audioDevice error:&error];
        if (error || !audioInput) {
            NSLog(@"[MicCapture] Failed to create audio input: %@", error);
            if (completion) {
                completion(NO, error);
            }
            return;
        }

        if ([self->_captureSession canAddInput:audioInput]) {
            [self->_captureSession addInput:audioInput];
        } else {
            NSLog(@"[MicCapture] Cannot add audio input to session");
            if (completion) {
                NSError *addError = [NSError errorWithDomain:@"MicCapture"
                                                       code:-4
                                                   userInfo:@{NSLocalizedDescriptionKey: @"Cannot add audio input to capture session"}];
                completion(NO, addError);
            }
            return;
        }

        // Create audio output
        self->_audioOutput = [[AVCaptureAudioDataOutput alloc] init];
        [self->_audioOutput setSampleBufferDelegate:self queue:self->_captureQueue];

        // Configure audio settings - request 48kHz mono float
        NSDictionary *audioSettings = @{
            AVFormatIDKey: @(kAudioFormatLinearPCM),
            AVSampleRateKey: @48000.0,
            AVNumberOfChannelsKey: @1,
            AVLinearPCMBitDepthKey: @32,
            AVLinearPCMIsFloatKey: @YES,
            AVLinearPCMIsBigEndianKey: @NO,
            AVLinearPCMIsNonInterleaved: @NO
        };

        // Note: audioSettings may be ignored by AVCaptureAudioDataOutput on some systems
        // We'll handle format conversion in the callback if needed

        if ([self->_captureSession canAddOutput:self->_audioOutput]) {
            [self->_captureSession addOutput:self->_audioOutput];
        } else {
            NSLog(@"[MicCapture] Cannot add audio output to session");
            if (completion) {
                NSError *addError = [NSError errorWithDomain:@"MicCapture"
                                                       code:-5
                                                   userInfo:@{NSLocalizedDescriptionKey: @"Cannot add audio output to capture session"}];
                completion(NO, addError);
            }
            return;
        }

        [self->_captureSession commitConfiguration];

        // Start the session
        [self->_captureSession startRunning];

        if ([self->_captureSession isRunning]) {
            self->_isCapturing = YES;
            NSLog(@"[MicCapture] Microphone capture started successfully");
            if (completion) {
                completion(YES, nil);
            }
        } else {
            NSLog(@"[MicCapture] Failed to start capture session");
            if (completion) {
                NSError *startError = [NSError errorWithDomain:@"MicCapture"
                                                         code:-6
                                                     userInfo:@{NSLocalizedDescriptionKey: @"Failed to start capture session"}];
                completion(NO, startError);
            }
        }
    });
}

- (void)stopCapture {
    if (!_isCapturing) {
        NSLog(@"[MicCapture] Not capturing");
        return;
    }

    NSLog(@"[MicCapture] Stopping microphone capture...");

    if (_captureSession) {
        // Stop the session first
        if ([_captureSession isRunning]) {
            [_captureSession stopRunning];
        }

        // Remove all inputs to fully release audio devices
        // This is critical for Bluetooth headsets to switch back to A2DP codec
        for (AVCaptureInput *input in [_captureSession.inputs copy]) {
            [_captureSession removeInput:input];
            NSLog(@"[MicCapture] Removed input: %@", input);
        }

        // Remove all outputs
        for (AVCaptureOutput *output in [_captureSession.outputs copy]) {
            [_captureSession removeOutput:output];
            NSLog(@"[MicCapture] Removed output: %@", output);
        }
    }

    _captureSession = nil;
    _audioOutput = nil;
    _isCapturing = NO;

    NSLog(@"[MicCapture] Microphone capture stopped and all inputs/outputs released");
}

#pragma mark - AVCaptureAudioDataOutputSampleBufferDelegate

- (void)captureOutput:(AVCaptureOutput *)output
didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer
       fromConnection:(AVCaptureConnection *)connection {

    if (!_audioCallback) {
        return; // No callback registered
    }

    // Get audio buffer
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

    // Check if we need to convert format
    BOOL isFloat = (asbd->mFormatFlags & kAudioFormatFlagIsFloat) != 0;
    BOOL is32Bit = (asbd->mBitsPerChannel == 32);
    double sourceSampleRate = asbd->mSampleRate;
    BOOL needsResampling = (fabs(sourceSampleRate - kTargetSampleRate) > 1.0); // Allow 1Hz tolerance

    static int callbackCount = 0;
    callbackCount++;

    if (callbackCount % 100 == 1) {
        NSLog(@"[MicCapture] Audio callback #%d: sampleRate=%.0f (target=%.0f, resample=%d), channels=%u, bitsPerChannel=%u, isFloat=%d, bytesPerFrame=%u, totalBytes=%zu",
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
            NSLog(@"[MicCapture] Unsupported audio format: isFloat=%d, bitsPerChannel=%u", isFloat, asbd->mBitsPerChannel);
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

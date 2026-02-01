// electron/native/src/mic_capture.mm
#import "mic_capture.h"
#import <Accelerate/Accelerate.h>
#import <mach/mach_time.h>

// Target sample rate for output (must match AudioContext in renderer)
static const double kTargetSampleRate = 48000.0;

@implementation MicCapture {
    AVCaptureSession *_captureSession;
    AVCaptureAudioDataOutput *_audioOutput;
    dispatch_queue_t _captureQueue;
    BOOL _isCapturing;

    // Resampling state (kept for callback compatibility but not used for file recording)
    float *_resampleBuffer;
    size_t _resampleBufferCapacity;
    BOOL _isResampling;

    // Timing-based sample rate detection
    uint64_t _firstCallbackTime;
    size_t _totalSamplesReceived;
    double _detectedSampleRate;
    BOOL _sampleRateDetected;

    // Diagnostic logging counters (reset each session)
    int _diagLogCount;

    // File recording state
    BOOL _isRecordingToFile;
    NSString *_outputFilePath;
    NSFileHandle *_fileHandle;
    size_t _totalSamplesWritten;
    int _fileChannelCount;
    double _fileSampleRate;
}

- (double)detectedSampleRate {
    return _detectedSampleRate;
}

- (BOOL)isResampling {
    return _isResampling;
}

- (BOOL)sampleRateDetected {
    return _sampleRateDetected;
}

- (BOOL)isRecordingToFile {
    return _isRecordingToFile;
}

- (NSString *)outputFilePath {
    return _outputFilePath;
}

- (double)actualSampleRate {
    return _fileSampleRate;
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
        _firstCallbackTime = 0;
        _totalSamplesReceived = 0;
        _detectedSampleRate = 0;
        _sampleRateDetected = NO;
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
    // Reset timing detection for new capture session
    _firstCallbackTime = 0;
    _totalSamplesReceived = 0;
    _detectedSampleRate = 0;
    _sampleRateDetected = NO;
    _diagLogCount = 0;

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
    double reportedSampleRate = asbd->mSampleRate;

    static int callbackCount = 0;
    callbackCount++;

    // Calculate samples per channel for timing detection
    size_t bytesPerSample = isFloat ? sizeof(float) : (asbd->mBitsPerChannel / 8);
    size_t samplesThisCallback = totalBytes / bytesPerSample / asbd->mChannelsPerFrame;

    // Detect actual sample rate from timing (macOS sometimes lies about sample rate)
    uint64_t now = mach_absolute_time();
    if (_firstCallbackTime == 0) {
        _firstCallbackTime = now;
        _totalSamplesReceived = 0;
        _sampleRateDetected = NO;
    }
    _totalSamplesReceived += samplesThisCallback;

    // After ~500ms of data, calculate the actual sample rate
    static mach_timebase_info_data_t timebaseInfo;
    if (timebaseInfo.denom == 0) {
        mach_timebase_info(&timebaseInfo);
    }
    uint64_t elapsedNanos = (now - _firstCallbackTime) * timebaseInfo.numer / timebaseInfo.denom;
    double elapsedSeconds = elapsedNanos / 1000000000.0;

    // Debug: log timing detection progress every 100 callbacks
    if (callbackCount % 100 == 1) {
        NSLog(@"[MicCapture] Detection progress #%d: elapsed=%.3fs, totalSamples=%zu, detected=%d, rate=%.0f",
              callbackCount, elapsedSeconds, _totalSamplesReceived, _sampleRateDetected, _detectedSampleRate);
    }

    if (!_sampleRateDetected && elapsedSeconds >= 0.5 && _totalSamplesReceived > 0) {
        _detectedSampleRate = _totalSamplesReceived / elapsedSeconds;
        _sampleRateDetected = YES;
        NSLog(@"[MicCapture] *** DETECTED ACTUAL SAMPLE RATE: %.0f Hz (reported: %.0f Hz) ***",
              _detectedSampleRate, reportedSampleRate);
    }

    // IMPORTANT: Always use the reported sample rate for resampling.
    // Changing the ratio mid-stream (after detection) causes discontinuities that manifest
    // as chipmunk effect because the AudioWorklet suddenly receives fewer samples.
    // A consistent ratio with slight timing drift is far better than a mid-stream change.
    double sourceSampleRate = reportedSampleRate;
    BOOL needsResampling = (fabs(sourceSampleRate - kTargetSampleRate) > 100.0); // Allow 100Hz tolerance

    if (callbackCount % 100 == 1) {
        NSLog(@"[MicCapture] Audio callback #%d: reportedRate=%.0f, detectedRate=%.0f, effectiveRate=%.0f (target=%.0f, resample=%d), channels=%u, bitsPerChannel=%u, isFloat=%d, bytesPerFrame=%u, totalBytes=%zu",
              callbackCount, reportedSampleRate, _detectedSampleRate, sourceSampleRate, kTargetSampleRate, needsResampling, asbd->mChannelsPerFrame, asbd->mBitsPerChannel, isFloat, asbd->mBytesPerFrame, totalBytes);
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

    // Track resampling state for diagnostics
    _isResampling = needsResampling;

    if (needsResampling) {
        // Log resampling details for first 20 callbacks to diagnose ratio issues
        if (_diagLogCount < 20) {
            double ratio = kTargetSampleRate / sourceSampleRate;
            NSLog(@"[MicCapture] RESAMPLE #%d: detected=%d, sourceSampleRate=%.0f, ratio=%.4f, inputSamples=%zu",
                  _diagLogCount, _sampleRateDetected, sourceSampleRate, ratio, totalSamples);
        }

        size_t resampledLength = 0;
        float *resampledSamples = [self resampleAudio:floatSamples
                                          inputLength:totalSamples
                                       sourceSampleRate:sourceSampleRate
                                         outputLength:&resampledLength];

        if (resampledSamples) {
            size_t resampledSamplesPerChannel = resampledLength / asbd->mChannelsPerFrame;
            // Log output sample count for first 20 callbacks
            if (_diagLogCount < 20) {
                NSLog(@"[MicCapture] OUTPUT #%d: inputSamples=%zu, outputSamples=%zu, ratio=%.4f",
                      _diagLogCount, totalSamples, resampledLength, (double)resampledLength / totalSamples);
                _diagLogCount++;
            }
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

    // Write to file if recording (write original samples, no resampling)
    if (_isRecordingToFile && _fileHandle && floatSamples) {
        // Store sample rate on first write
        if (_fileSampleRate == 0) {
            _fileSampleRate = reportedSampleRate;
            _fileChannelCount = asbd->mChannelsPerFrame;
            NSLog(@"[MicCapture] Recording at %.0f Hz, %d channels", _fileSampleRate, _fileChannelCount);
        }

        // Convert float samples to 16-bit PCM for better compatibility
        size_t sampleCount = totalSamples;
        int16_t *pcmSamples = (int16_t *)malloc(sampleCount * sizeof(int16_t));
        if (pcmSamples) {
            for (size_t i = 0; i < sampleCount; i++) {
                float sample = floatSamples[i];
                // Clamp to [-1, 1] and convert to 16-bit
                if (sample > 1.0f) sample = 1.0f;
                if (sample < -1.0f) sample = -1.0f;
                pcmSamples[i] = (int16_t)(sample * 32767.0f);
            }

            NSData *data = [NSData dataWithBytes:pcmSamples length:sampleCount * sizeof(int16_t)];
            @try {
                [_fileHandle writeData:data];
                _totalSamplesWritten += sampleCount;
            } @catch (NSException *e) {
                NSLog(@"[MicCapture] Error writing to file: %@", e);
            }
            free(pcmSamples);
        }
    }

    if (needsFree && floatSamples) {
        free(floatSamples);
    }
}

#pragma mark - File Recording

- (BOOL)startRecordingToFile:(NSString *)filePath {
    if (_isRecordingToFile) {
        NSLog(@"[MicCapture] Already recording to file");
        return NO;
    }

    NSLog(@"[MicCapture] Starting file recording to: %@", filePath);

    // Create the file with a placeholder WAV header (will be updated when recording stops)
    NSFileManager *fm = [NSFileManager defaultManager];

    // Create directory if needed
    NSString *directory = [filePath stringByDeletingLastPathComponent];
    if (![fm fileExistsAtPath:directory]) {
        NSError *error = nil;
        [fm createDirectoryAtPath:directory withIntermediateDirectories:YES attributes:nil error:&error];
        if (error) {
            NSLog(@"[MicCapture] Failed to create directory: %@", error);
            return NO;
        }
    }

    // Create file with empty header (44 bytes for WAV)
    uint8_t emptyHeader[44] = {0};
    NSData *headerData = [NSData dataWithBytes:emptyHeader length:44];
    if (![headerData writeToFile:filePath atomically:YES]) {
        NSLog(@"[MicCapture] Failed to create file");
        return NO;
    }

    // Open file for writing
    _fileHandle = [NSFileHandle fileHandleForWritingAtPath:filePath];
    if (!_fileHandle) {
        NSLog(@"[MicCapture] Failed to open file for writing");
        return NO;
    }

    // Seek past header
    [_fileHandle seekToFileOffset:44];

    _outputFilePath = [filePath copy];
    _totalSamplesWritten = 0;
    _fileSampleRate = 0; // Will be set on first audio callback
    _fileChannelCount = 1;
    _isRecordingToFile = YES;

    NSLog(@"[MicCapture] File recording started");
    return YES;
}

- (NSString *)stopRecording {
    if (!_isRecordingToFile) {
        NSLog(@"[MicCapture] Not recording to file");
        return nil;
    }

    NSLog(@"[MicCapture] Stopping file recording, samples written: %zu", _totalSamplesWritten);

    _isRecordingToFile = NO;

    // Finalize the WAV header
    if (_fileHandle && _outputFilePath) {
        // Calculate sizes
        uint32_t dataSize = (uint32_t)(_totalSamplesWritten * sizeof(int16_t));
        uint32_t fileSize = dataSize + 36; // Total file size minus 8 bytes for RIFF header
        uint16_t channels = (uint16_t)_fileChannelCount;
        uint32_t sampleRate = (uint32_t)_fileSampleRate;
        uint16_t bitsPerSample = 16;
        uint16_t blockAlign = channels * (bitsPerSample / 8);
        uint32_t byteRate = sampleRate * blockAlign;

        // Build WAV header
        uint8_t header[44];

        // RIFF header
        header[0] = 'R'; header[1] = 'I'; header[2] = 'F'; header[3] = 'F';
        header[4] = fileSize & 0xFF;
        header[5] = (fileSize >> 8) & 0xFF;
        header[6] = (fileSize >> 16) & 0xFF;
        header[7] = (fileSize >> 24) & 0xFF;
        header[8] = 'W'; header[9] = 'A'; header[10] = 'V'; header[11] = 'E';

        // fmt chunk
        header[12] = 'f'; header[13] = 'm'; header[14] = 't'; header[15] = ' ';
        header[16] = 16; header[17] = 0; header[18] = 0; header[19] = 0; // Chunk size (16 for PCM)
        header[20] = 1; header[21] = 0; // Audio format (1 = PCM)
        header[22] = channels & 0xFF; header[23] = (channels >> 8) & 0xFF;
        header[24] = sampleRate & 0xFF;
        header[25] = (sampleRate >> 8) & 0xFF;
        header[26] = (sampleRate >> 16) & 0xFF;
        header[27] = (sampleRate >> 24) & 0xFF;
        header[28] = byteRate & 0xFF;
        header[29] = (byteRate >> 8) & 0xFF;
        header[30] = (byteRate >> 16) & 0xFF;
        header[31] = (byteRate >> 24) & 0xFF;
        header[32] = blockAlign & 0xFF; header[33] = (blockAlign >> 8) & 0xFF;
        header[34] = bitsPerSample & 0xFF; header[35] = (bitsPerSample >> 8) & 0xFF;

        // data chunk
        header[36] = 'd'; header[37] = 'a'; header[38] = 't'; header[39] = 'a';
        header[40] = dataSize & 0xFF;
        header[41] = (dataSize >> 8) & 0xFF;
        header[42] = (dataSize >> 16) & 0xFF;
        header[43] = (dataSize >> 24) & 0xFF;

        // Write header at beginning of file
        [_fileHandle seekToFileOffset:0];
        [_fileHandle writeData:[NSData dataWithBytes:header length:44]];
        [_fileHandle closeFile];

        NSLog(@"[MicCapture] WAV file finalized: %@ (%.2f seconds at %.0f Hz)",
              _outputFilePath, (double)_totalSamplesWritten / _fileChannelCount / _fileSampleRate, _fileSampleRate);
    }

    _fileHandle = nil;
    NSString *result = _outputFilePath;
    _outputFilePath = nil;
    _totalSamplesWritten = 0;

    return result;
}

@end

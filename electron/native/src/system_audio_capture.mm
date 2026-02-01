// electron/native/src/system_audio_capture.mm
#import "system_audio_capture.h"
#import <AVFoundation/AVFoundation.h>
#import <Accelerate/Accelerate.h>
#import <mach/mach_time.h>

// Target sample rate for output (must match AudioContext in renderer)
static const double kTargetSampleRate = 48000.0;

API_AVAILABLE(macos(12.3))
@implementation SystemAudioCapture {
    SCStream *_stream;
    SCStreamConfiguration *_config;
    SCContentFilter *_filter;
    dispatch_queue_t _captureQueue;
    BOOL _isCapturing;

    // Resampling state (kept for callback compatibility)
    double _lastSourceSampleRate;
    float *_resampleBuffer;
    size_t _resampleBufferCapacity;
    BOOL _isResampling;

    // Timing-based sample rate detection
    uint64_t _firstCallbackTime;
    size_t _totalSamplesReceived;
    double _detectedSampleRate;
    BOOL _sampleRateDetected;

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

- (BOOL)isCapturing {
    return _isCapturing;
}

- (void)startCaptureWithCompletion:(void (^)(BOOL success, NSError * _Nullable error))completion {
    // Reset timing detection for new capture session
    _firstCallbackTime = 0;
    _totalSamplesReceived = 0;
    _detectedSampleRate = 0;
    _sampleRateDetected = NO;

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
            // Try matching the Bluetooth HFP sample rate to avoid resampling artifacts
            self->_config.capturesAudio = YES;
            self->_config.sampleRate = 16000; // Match Bluetooth HFP rate
            self->_config.channelCount = 2;

            NSLog(@"[SystemAudioCapture] Configured with sampleRate=16000 Hz");

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
    BOOL isNonInterleaved = (asbd->mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0;
    BOOL isPacked = (asbd->mFormatFlags & kAudioFormatFlagIsPacked) != 0;
    double reportedSampleRate = asbd->mSampleRate;

    static int callbackCount = 0;
    callbackCount++;

    // Log detailed format info on first callback
    if (callbackCount == 1) {
        NSLog(@"[SystemAudioCapture] AUDIO FORMAT DETAILS:");
        NSLog(@"[SystemAudioCapture]   mSampleRate: %.0f", asbd->mSampleRate);
        NSLog(@"[SystemAudioCapture]   mFormatID: %u", (unsigned int)asbd->mFormatID);
        NSLog(@"[SystemAudioCapture]   mFormatFlags: 0x%X", (unsigned int)asbd->mFormatFlags);
        NSLog(@"[SystemAudioCapture]   mBytesPerPacket: %u", (unsigned int)asbd->mBytesPerPacket);
        NSLog(@"[SystemAudioCapture]   mFramesPerPacket: %u", (unsigned int)asbd->mFramesPerPacket);
        NSLog(@"[SystemAudioCapture]   mBytesPerFrame: %u", (unsigned int)asbd->mBytesPerFrame);
        NSLog(@"[SystemAudioCapture]   mChannelsPerFrame: %u", (unsigned int)asbd->mChannelsPerFrame);
        NSLog(@"[SystemAudioCapture]   mBitsPerChannel: %u", (unsigned int)asbd->mBitsPerChannel);
        NSLog(@"[SystemAudioCapture]   isFloat: %d, is32Bit: %d, isNonInterleaved: %d, isPacked: %d",
              isFloat, is32Bit, isNonInterleaved, isPacked);
        NSLog(@"[SystemAudioCapture]   totalBytes in buffer: %zu", totalBytes);
    }

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

    if (!_sampleRateDetected && elapsedSeconds >= 0.5 && _totalSamplesReceived > 0) {
        _detectedSampleRate = _totalSamplesReceived / elapsedSeconds;
        _sampleRateDetected = YES;
        NSLog(@"[SystemAudioCapture] *** DETECTED ACTUAL SAMPLE RATE: %.0f Hz (reported: %.0f Hz) ***",
              _detectedSampleRate, reportedSampleRate);
    }

    // IMPORTANT: Always use the reported sample rate for resampling.
    // Changing the ratio mid-stream (after detection) causes discontinuities that manifest
    // as audio artifacts because the AudioWorklet suddenly receives a different number of samples.
    // A consistent ratio with slight timing drift is far better than a mid-stream change.
    double sourceSampleRate = reportedSampleRate;
    BOOL needsResampling = (fabs(sourceSampleRate - kTargetSampleRate) > 100.0); // Allow 100Hz tolerance

    if (callbackCount % 100 == 1) {
        NSLog(@"[SystemAudioCapture] Audio callback #%d: reportedRate=%.0f, detectedRate=%.0f, effectiveRate=%.0f (target=%.0f, resample=%d), channels=%u, bitsPerChannel=%u, isFloat=%d, bytesPerFrame=%u, totalBytes=%zu",
              callbackCount, reportedSampleRate, _detectedSampleRate, sourceSampleRate, kTargetSampleRate, needsResampling, asbd->mChannelsPerFrame, asbd->mBitsPerChannel, isFloat, asbd->mBytesPerFrame, totalBytes);
    }

    // First, get the audio as float samples
    float *floatSamples = NULL;
    size_t totalSamples = 0;
    BOOL needsFree = NO;

    // Handle non-interleaved (planar) audio - ScreenCaptureKit delivers audio this way
    if (isNonInterleaved && isFloat && is32Bit) {
        // Non-interleaved float32: [L L L L...][R R R R...]
        // We need to interleave to: [L R L R L R...]
        size_t samplesPerChannel = totalBytes / asbd->mChannelsPerFrame / sizeof(float);
        totalSamples = samplesPerChannel * asbd->mChannelsPerFrame;

        floatSamples = (float *)malloc(totalSamples * sizeof(float));
        if (!floatSamples) {
            return;
        }
        needsFree = YES;

        float *srcData = (float *)dataPointer;
        size_t channels = asbd->mChannelsPerFrame;

        // Interleave the channels
        for (size_t i = 0; i < samplesPerChannel; i++) {
            for (size_t ch = 0; ch < channels; ch++) {
                // Source: channel ch, sample i
                // In non-interleaved: srcData[ch * samplesPerChannel + i]
                // Dest: interleaved position
                floatSamples[i * channels + ch] = srcData[ch * samplesPerChannel + i];
            }
        }

        if (callbackCount == 1) {
            NSLog(@"[SystemAudioCapture] Interleaving non-interleaved audio: %zu samples/channel, %zu channels -> %zu total interleaved samples",
                  samplesPerChannel, channels, totalSamples);
        }
    } else if (isFloat && is32Bit) {
        // Already in interleaved float format
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
            NSLog(@"[SystemAudioCapture] Unsupported audio format: isFloat=%d, bitsPerChannel=%u, isNonInterleaved=%d",
                  isFloat, asbd->mBitsPerChannel, isNonInterleaved);
        }
        return;
    }

    // Now resample if needed
    size_t samplesPerChannel = totalSamples / asbd->mChannelsPerFrame;

    // Track resampling state for diagnostics
    _isResampling = needsResampling;

    if (needsResampling) {
        // Log when resampling starts (only once)
        static BOOL loggedResamplingStart = NO;
        if (!loggedResamplingStart) {
            NSLog(@"[SystemAudioCapture] *** RESAMPLING ACTIVATED: from %.0f Hz to %.0f Hz (ratio: %.4f) ***",
                  sourceSampleRate, kTargetSampleRate, kTargetSampleRate / sourceSampleRate);
            loggedResamplingStart = YES;
        }

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

    // Write to file if recording (write original samples, no resampling)
    if (_isRecordingToFile && _fileHandle && floatSamples) {
        // Store sample rate - prefer detected rate once available, otherwise use reported
        // This is critical for Bluetooth: ScreenCaptureKit may report 48kHz but deliver ~16kHz
        if (_fileSampleRate == 0 || (_sampleRateDetected && _fileSampleRate != _detectedSampleRate)) {
            double previousRate = _fileSampleRate;
            // Use detected rate if available and significantly different from reported
            if (_sampleRateDetected && fabs(_detectedSampleRate - reportedSampleRate) > 1000) {
                _fileSampleRate = _detectedSampleRate;
                NSLog(@"[SystemAudioCapture] Using DETECTED sample rate for file: %.0f Hz (reported was %.0f Hz)",
                      _fileSampleRate, reportedSampleRate);
            } else {
                _fileSampleRate = reportedSampleRate;
            }
            _fileChannelCount = asbd->mChannelsPerFrame;
            if (previousRate > 0 && previousRate != _fileSampleRate) {
                NSLog(@"[SystemAudioCapture] WARNING: Sample rate changed from %.0f to %.0f Hz during recording",
                      previousRate, _fileSampleRate);
            }
            NSLog(@"[SystemAudioCapture] Recording at %.0f Hz, %d channels", _fileSampleRate, _fileChannelCount);
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
                NSLog(@"[SystemAudioCapture] Error writing to file: %@", e);
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
        NSLog(@"[SystemAudioCapture] Already recording to file");
        return NO;
    }

    NSLog(@"[SystemAudioCapture] Starting file recording to: %@", filePath);

    // Create the file with a placeholder WAV header
    NSFileManager *fm = [NSFileManager defaultManager];

    // Create directory if needed
    NSString *directory = [filePath stringByDeletingLastPathComponent];
    if (![fm fileExistsAtPath:directory]) {
        NSError *error = nil;
        [fm createDirectoryAtPath:directory withIntermediateDirectories:YES attributes:nil error:&error];
        if (error) {
            NSLog(@"[SystemAudioCapture] Failed to create directory: %@", error);
            return NO;
        }
    }

    // Create file with empty header (44 bytes for WAV)
    uint8_t emptyHeader[44] = {0};
    NSData *headerData = [NSData dataWithBytes:emptyHeader length:44];
    if (![headerData writeToFile:filePath atomically:YES]) {
        NSLog(@"[SystemAudioCapture] Failed to create file");
        return NO;
    }

    // Open file for writing
    _fileHandle = [NSFileHandle fileHandleForWritingAtPath:filePath];
    if (!_fileHandle) {
        NSLog(@"[SystemAudioCapture] Failed to open file for writing");
        return NO;
    }

    // Seek past header
    [_fileHandle seekToFileOffset:44];

    _outputFilePath = [filePath copy];
    _totalSamplesWritten = 0;
    _fileSampleRate = 0; // Will be set on first audio callback
    _fileChannelCount = 2; // Default stereo
    _isRecordingToFile = YES;

    NSLog(@"[SystemAudioCapture] File recording started");
    return YES;
}

- (NSString *)stopRecording {
    if (!_isRecordingToFile) {
        NSLog(@"[SystemAudioCapture] Not recording to file");
        return nil;
    }

    NSLog(@"[SystemAudioCapture] Stopping file recording, samples written: %zu", _totalSamplesWritten);
    NSLog(@"[SystemAudioCapture] Sample rate detection: detected=%d, detectedRate=%.0f, fileRate=%.0f",
          _sampleRateDetected, _detectedSampleRate, _fileSampleRate);

    _isRecordingToFile = NO;

    // If we have a detected sample rate that differs significantly from what we recorded,
    // update the file sample rate now (in case we missed the window during recording)
    if (_sampleRateDetected && fabs(_detectedSampleRate - _fileSampleRate) > 1000) {
        NSLog(@"[SystemAudioCapture] CORRECTING sample rate in header: %.0f -> %.0f Hz",
              _fileSampleRate, _detectedSampleRate);
        _fileSampleRate = _detectedSampleRate;
    }

    // Finalize the WAV header
    if (_fileHandle && _outputFilePath) {
        // Calculate sizes
        uint32_t dataSize = (uint32_t)(_totalSamplesWritten * sizeof(int16_t));
        uint32_t fileSize = dataSize + 36;
        uint16_t channels = (uint16_t)_fileChannelCount;
        uint32_t sampleRate = (uint32_t)_fileSampleRate;

        NSLog(@"[SystemAudioCapture] Writing WAV header with sampleRate=%u, channels=%u, dataSize=%u",
              sampleRate, channels, dataSize);
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
        header[16] = 16; header[17] = 0; header[18] = 0; header[19] = 0;
        header[20] = 1; header[21] = 0; // PCM
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

        NSLog(@"[SystemAudioCapture] WAV file finalized: %@ (%.2f seconds at %.0f Hz)",
              _outputFilePath, (double)_totalSamplesWritten / _fileChannelCount / _fileSampleRate, _fileSampleRate);
    }

    _fileHandle = nil;
    NSString *result = _outputFilePath;
    _outputFilePath = nil;
    _totalSamplesWritten = 0;

    return result;
}

@end

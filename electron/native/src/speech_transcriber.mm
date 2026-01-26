// electron/native/src/speech_transcriber.mm
#import "speech_transcriber.h"
#import <Speech/Speech.h>
#import <AVFoundation/AVFoundation.h>

@implementation TranscriptionSegment
@end

@implementation TranscriptionResult
@end

@implementation SpeechTranscriberWrapper

+ (BOOL)isAvailable {
    // Check for macOS 10.15+ (Catalina) for SFSpeechRecognizer
    // SpeechAnalyzer requires macOS 16+ but we use SFSpeechRecognizer for broader compatibility
    if (@available(macOS 10.15, *)) {
        // Check if speech recognition is available
        SFSpeechRecognizerAuthorizationStatus status = [SFSpeechRecognizer authorizationStatus];

        // If not determined, we consider it "available" - auth will be requested on first use
        if (status == SFSpeechRecognizerAuthorizationStatusNotDetermined) {
            return YES;
        }

        // Check if authorized
        if (status != SFSpeechRecognizerAuthorizationStatusAuthorized) {
            NSLog(@"[SpeechTranscriber] Not authorized: status=%ld", (long)status);
            return NO;
        }

        // Check if a recognizer is available for the default locale
        SFSpeechRecognizer *recognizer = [[SFSpeechRecognizer alloc] init];
        if (!recognizer) {
            NSLog(@"[SpeechTranscriber] No recognizer available for default locale");
            return NO;
        }

        if (!recognizer.isAvailable) {
            NSLog(@"[SpeechTranscriber] Recognizer not available (possibly offline model not downloaded)");
            return NO;
        }

        // Check for on-device recognition support (macOS 13+)
        if (@available(macOS 13.0, *)) {
            if (!recognizer.supportsOnDeviceRecognition) {
                NSLog(@"[SpeechTranscriber] On-device recognition not supported for this locale");
                // Still return YES - we can use server-based recognition as fallback
            }
        }

        return YES;
    }

    return NO;
}

+ (NSArray<NSString *> *)supportedLanguages {
    if (@available(macOS 10.15, *)) {
        NSSet<NSLocale *> *locales = [SFSpeechRecognizer supportedLocales];
        NSMutableArray<NSString *> *languages = [NSMutableArray array];

        for (NSLocale *locale in locales) {
            NSString *langCode = [locale languageCode];
            if (langCode && ![languages containsObject:langCode]) {
                [languages addObject:langCode];
            }
        }

        return [languages sortedArrayUsingSelector:@selector(compare:)];
    }

    return @[];
}

+ (TranscriptionResult *)transcribeAudioData:(NSData *)audioData
                                  sampleRate:(double)sampleRate
                                    language:(NSString *)language {
    TranscriptionResult *result = [[TranscriptionResult alloc] init];
    result.segments = @[];

    if (@available(macOS 10.15, *)) {
        // Create a temporary file for the audio data
        NSString *tempDir = NSTemporaryDirectory();
        NSString *tempFile = [tempDir stringByAppendingPathComponent:
                              [NSString stringWithFormat:@"transcribe_%@.wav", [[NSUUID UUID] UUIDString]]];

        // Write audio data as WAV file
        NSError *writeError = nil;
        BOOL writeSuccess = [self writeAudioData:audioData
                                      sampleRate:sampleRate
                                          toFile:tempFile
                                           error:&writeError];

        if (!writeSuccess) {
            result.success = NO;
            result.error = writeError ? writeError.localizedDescription : @"Failed to write temporary audio file";
            return result;
        }

        // Transcribe the file
        result = [self transcribeFile:tempFile language:language];

        // Clean up temp file
        [[NSFileManager defaultManager] removeItemAtPath:tempFile error:nil];

        return result;
    }

    result.success = NO;
    result.error = @"Speech recognition requires macOS 10.15 or later";
    return result;
}

+ (TranscriptionResult *)transcribeFile:(NSString *)filePath
                               language:(NSString *)language {
    TranscriptionResult *result = [[TranscriptionResult alloc] init];
    result.segments = @[];

    if (@available(macOS 10.15, *)) {
        // Check file exists
        if (![[NSFileManager defaultManager] fileExistsAtPath:filePath]) {
            result.success = NO;
            result.error = @"Audio file not found";
            return result;
        }

        // Create URL
        NSURL *audioURL = [NSURL fileURLWithPath:filePath];

        // Create recognizer with specified language or default
        SFSpeechRecognizer *recognizer;
        if (language && language.length > 0) {
            NSLocale *locale = [NSLocale localeWithLocaleIdentifier:language];
            recognizer = [[SFSpeechRecognizer alloc] initWithLocale:locale];
        } else {
            recognizer = [[SFSpeechRecognizer alloc] init];
        }

        if (!recognizer) {
            result.success = NO;
            result.error = [NSString stringWithFormat:@"No speech recognizer available for language: %@",
                           language ?: @"default"];
            return result;
        }

        // Request authorization if needed
        __block SFSpeechRecognizerAuthorizationStatus authStatus = [SFSpeechRecognizer authorizationStatus];

        if (authStatus == SFSpeechRecognizerAuthorizationStatusNotDetermined) {
            dispatch_semaphore_t authSemaphore = dispatch_semaphore_create(0);

            [SFSpeechRecognizer requestAuthorization:^(SFSpeechRecognizerAuthorizationStatus status) {
                authStatus = status;
                dispatch_semaphore_signal(authSemaphore);
            }];

            dispatch_semaphore_wait(authSemaphore, dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC));
        }

        if (authStatus != SFSpeechRecognizerAuthorizationStatusAuthorized) {
            result.success = NO;
            result.error = @"Speech recognition not authorized. Please enable in System Preferences > Privacy & Security > Speech Recognition.";
            return result;
        }

        // Create recognition request
        SFSpeechURLRecognitionRequest *request = [[SFSpeechURLRecognitionRequest alloc] initWithURL:audioURL];

        // Configure for best results
        request.shouldReportPartialResults = NO;

        // Use on-device recognition if available (macOS 13+)
        if (@available(macOS 13.0, *)) {
            if (recognizer.supportsOnDeviceRecognition) {
                request.requiresOnDeviceRecognition = YES;
                NSLog(@"[SpeechTranscriber] Using on-device recognition");
            } else {
                NSLog(@"[SpeechTranscriber] On-device recognition not available, using server");
            }
        }

        // Add punctuation if available (macOS 13+)
        if (@available(macOS 13.0, *)) {
            request.addsPunctuation = YES;
        }

        // Perform recognition synchronously using semaphore
        dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
        __block SFSpeechRecognitionResult *recognitionResult = nil;
        __block NSError *recognitionError = nil;

        NSLog(@"[SpeechTranscriber] Starting transcription of: %@", filePath);

        [recognizer recognitionTaskWithRequest:request
                                 resultHandler:^(SFSpeechRecognitionResult * _Nullable taskResult,
                                                NSError * _Nullable error) {
            if (error) {
                recognitionError = error;
                dispatch_semaphore_signal(semaphore);
                return;
            }

            if (taskResult.isFinal) {
                recognitionResult = taskResult;
                dispatch_semaphore_signal(semaphore);
            }
        }];

        // Wait for completion with timeout (5 minutes for long recordings)
        dispatch_time_t timeout = dispatch_time(DISPATCH_TIME_NOW, 300 * NSEC_PER_SEC);
        long waitResult = dispatch_semaphore_wait(semaphore, timeout);

        if (waitResult != 0) {
            result.success = NO;
            result.error = @"Transcription timed out";
            return result;
        }

        if (recognitionError) {
            result.success = NO;
            result.error = recognitionError.localizedDescription;
            NSLog(@"[SpeechTranscriber] Error: %@", recognitionError);
            return result;
        }

        if (!recognitionResult) {
            result.success = NO;
            result.error = @"No transcription result received";
            return result;
        }

        // Extract results
        result.success = YES;
        result.text = recognitionResult.bestTranscription.formattedString;
        result.language = language ?: recognizer.locale.languageCode;

        // Calculate duration from segments
        NSArray<SFTranscriptionSegment *> *sfSegments = recognitionResult.bestTranscription.segments;
        NSMutableArray<TranscriptionSegment *> *segments = [NSMutableArray array];
        double maxEndTime = 0;

        for (NSInteger i = 0; i < sfSegments.count; i++) {
            SFTranscriptionSegment *sfSeg = sfSegments[i];

            TranscriptionSegment *seg = [[TranscriptionSegment alloc] init];
            seg.segmentId = i;
            seg.startTime = sfSeg.timestamp;
            seg.endTime = sfSeg.timestamp + sfSeg.duration;
            seg.text = sfSeg.substring;

            [segments addObject:seg];

            if (seg.endTime > maxEndTime) {
                maxEndTime = seg.endTime;
            }
        }

        result.segments = segments;
        result.duration = maxEndTime;

        NSLog(@"[SpeechTranscriber] Transcription complete: %lu segments, %.1f seconds",
              (unsigned long)segments.count, maxEndTime);

        return result;
    }

    result.success = NO;
    result.error = @"Speech recognition requires macOS 10.15 or later";
    return result;
}

#pragma mark - Private Helpers

+ (BOOL)writeAudioData:(NSData *)audioData
            sampleRate:(double)sampleRate
                toFile:(NSString *)filePath
                 error:(NSError **)error {
    // Audio data is expected to be float32 mono PCM
    // We need to convert to a WAV file that SFSpeechRecognizer can read

    NSUInteger sampleCount = audioData.length / sizeof(float);
    const float *samples = (const float *)audioData.bytes;

    // Create audio file
    NSURL *fileURL = [NSURL fileURLWithPath:filePath];

    // Audio format: 16-bit PCM WAV (more compatible than float32)
    AudioStreamBasicDescription format = {0};
    format.mSampleRate = sampleRate;
    format.mFormatID = kAudioFormatLinearPCM;
    format.mFormatFlags = kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked;
    format.mBitsPerChannel = 16;
    format.mChannelsPerFrame = 1;
    format.mBytesPerFrame = 2;
    format.mFramesPerPacket = 1;
    format.mBytesPerPacket = 2;

    AudioFileID audioFile;
    OSStatus status = AudioFileCreateWithURL((__bridge CFURLRef)fileURL,
                                             kAudioFileWAVEType,
                                             &format,
                                             kAudioFileFlags_EraseFile,
                                             &audioFile);

    if (status != noErr) {
        if (error) {
            *error = [NSError errorWithDomain:@"SpeechTranscriber"
                                         code:status
                                     userInfo:@{NSLocalizedDescriptionKey:
                                                    [NSString stringWithFormat:@"Failed to create audio file: %d", (int)status]}];
        }
        return NO;
    }

    // Convert float32 to int16 and write
    int16_t *int16Samples = (int16_t *)malloc(sampleCount * sizeof(int16_t));
    if (!int16Samples) {
        AudioFileClose(audioFile);
        if (error) {
            *error = [NSError errorWithDomain:@"SpeechTranscriber"
                                         code:-1
                                     userInfo:@{NSLocalizedDescriptionKey: @"Failed to allocate memory"}];
        }
        return NO;
    }

    for (NSUInteger i = 0; i < sampleCount; i++) {
        float sample = samples[i];
        // Clamp and convert to int16
        if (sample > 1.0f) sample = 1.0f;
        if (sample < -1.0f) sample = -1.0f;
        int16Samples[i] = (int16_t)(sample * 32767.0f);
    }

    UInt32 bytesToWrite = (UInt32)(sampleCount * sizeof(int16_t));
    status = AudioFileWriteBytes(audioFile, false, 0, &bytesToWrite, int16Samples);

    free(int16Samples);
    AudioFileClose(audioFile);

    if (status != noErr) {
        if (error) {
            *error = [NSError errorWithDomain:@"SpeechTranscriber"
                                         code:status
                                     userInfo:@{NSLocalizedDescriptionKey:
                                                    [NSString stringWithFormat:@"Failed to write audio data: %d", (int)status]}];
        }
        return NO;
    }

    return YES;
}

@end

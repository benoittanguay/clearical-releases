// electron/native/src/index.mm
#include <napi.h>
#include <atomic>
#include "media_monitor.h"
#include "system_audio_capture.h"
#include "mic_capture.h"

// Store reference to JS callback function for media state
static Napi::ThreadSafeFunction tsfn;
static bool tsfnInitialized = false;

// Store reference to JS callback function for system audio samples
static Napi::ThreadSafeFunction audioTsfn;
static bool audioTsfnInitialized = false;

// Store reference to JS callback function for mic audio samples
static Napi::ThreadSafeFunction micTsfn;
static bool micTsfnInitialized = false;

// Callback from Objective-C
void mediaStateChanged(bool isActive, const char* deviceType) {
    if (!tsfnInitialized) return;

    // Create data to pass to JS
    struct CallbackData {
        bool isActive;
        std::string deviceType;
    };

    auto* data = new CallbackData{isActive, std::string(deviceType)};

    tsfn.BlockingCall(data, [](Napi::Env env, Napi::Function jsCallback, CallbackData* data) {
        jsCallback.Call({
            Napi::Boolean::New(env, data->isActive),
            Napi::String::New(env, data->deviceType)
        });
        delete data;
    });
}

Napi::Value Start(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Callback function required").ThrowAsJavaScriptException();
        return env.Null();
    }

    // Clean up previous TSFN if start() called twice without stop()
    if (tsfnInitialized) {
        tsfn.Release();
        tsfnInitialized = false;
    }

    // Create thread-safe function for callbacks
    tsfn = Napi::ThreadSafeFunction::New(
        env,
        info[0].As<Napi::Function>(),
        "MediaMonitorCallback",
        0,
        1
    );
    tsfnInitialized = true;

    // Set callback and start monitoring
    MediaMonitor *monitor = [MediaMonitor sharedInstance];
    monitor.callback = mediaStateChanged;
    [monitor startMonitoring];

    return env.Undefined();
}

Napi::Value Stop(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    MediaMonitor *monitor = [MediaMonitor sharedInstance];
    [monitor stopMonitoring];
    monitor.callback = NULL;

    if (tsfnInitialized) {
        tsfn.Release();
        tsfnInitialized = false;
    }

    return env.Undefined();
}

Napi::Value IsMicrophoneInUse(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    MediaMonitor *monitor = [MediaMonitor sharedInstance];
    return Napi::Boolean::New(env, [monitor isMicrophoneInUse]);
}

Napi::Value IsCameraInUse(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    MediaMonitor *monitor = [MediaMonitor sharedInstance];
    return Napi::Boolean::New(env, [monitor isCameraInUse]);
}

// Helper for nil-safe NSString to const char* conversion
static inline const char* SafeUTF8String(NSString *str) {
    return str ? [str UTF8String] : "";
}

Napi::Value GetRunningMeetingApps(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    MediaMonitor *monitor = [MediaMonitor sharedInstance];

    NSArray<NSDictionary *> *apps = [monitor getRunningMeetingApps];
    Napi::Array result = Napi::Array::New(env, apps.count);

    for (NSUInteger i = 0; i < apps.count; i++) {
        NSDictionary *app = apps[i];
        Napi::Object appObj = Napi::Object::New(env);
        appObj.Set("bundleId", Napi::String::New(env, SafeUTF8String(app[@"bundleId"])));
        appObj.Set("appName", Napi::String::New(env, SafeUTF8String(app[@"appName"])));
        appObj.Set("localizedName", Napi::String::New(env, SafeUTF8String(app[@"localizedName"])));
        appObj.Set("pid", Napi::Number::New(env, [app[@"pid"] intValue]));
        appObj.Set("isActive", Napi::Boolean::New(env, [app[@"isActive"] boolValue]));
        result.Set(i, appObj);
    }

    return result;
}

Napi::Value GetLikelyMeetingAppUsingMic(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    MediaMonitor *monitor = [MediaMonitor sharedInstance];

    NSDictionary *app = [monitor getLikelyMeetingAppUsingMic];

    if (!app) {
        return env.Null();
    }

    Napi::Object appObj = Napi::Object::New(env);
    appObj.Set("bundleId", Napi::String::New(env, SafeUTF8String(app[@"bundleId"])));
    appObj.Set("appName", Napi::String::New(env, SafeUTF8String(app[@"appName"])));
    appObj.Set("localizedName", Napi::String::New(env, SafeUTF8String(app[@"localizedName"])));
    appObj.Set("pid", Napi::Number::New(env, [app[@"pid"] intValue]));
    appObj.Set("isActive", Napi::Boolean::New(env, [app[@"isActive"] boolValue]));

    return appObj;
}

Napi::Value GetCurrentMeetingApp(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    MediaMonitor *monitor = [MediaMonitor sharedInstance];

    // Return the cached likely meeting app (set when mic became active)
    NSDictionary *app = monitor.likelyMeetingApp;

    if (!app) {
        return env.Null();
    }

    Napi::Object appObj = Napi::Object::New(env);
    appObj.Set("bundleId", Napi::String::New(env, SafeUTF8String(app[@"bundleId"])));
    appObj.Set("appName", Napi::String::New(env, SafeUTF8String(app[@"appName"])));
    appObj.Set("localizedName", Napi::String::New(env, SafeUTF8String(app[@"localizedName"])));
    appObj.Set("pid", Napi::Number::New(env, [app[@"pid"] intValue]));
    appObj.Set("isActive", Napi::Boolean::New(env, [app[@"isActive"] boolValue]));

    return appObj;
}

// System Audio Capture functions

// Counter for logging frequency
static int audioCallbackCount = 0;

// Callback from Objective-C for audio samples
void audioSamplesReceived(const float* samples, size_t sampleCount, int channelCount, double sampleRate) {
    audioCallbackCount++;

    // Log every 100th callback to avoid spam
    if (audioCallbackCount % 100 == 1) {
        NSLog(@"[SystemAudioCapture] audioSamplesReceived called #%d: sampleCount=%zu, channelCount=%d, sampleRate=%.0f",
              audioCallbackCount, sampleCount, channelCount, sampleRate);
    }

    if (!audioTsfnInitialized) {
        if (audioCallbackCount % 100 == 1) {
            NSLog(@"[SystemAudioCapture] Warning: audioTsfnInitialized is false, dropping samples");
        }
        return;
    }

    // Create data to pass to JS - we need to copy the samples as the buffer may be reused
    struct AudioData {
        std::vector<float> samples;
        int channelCount;
        double sampleRate;
    };

    size_t totalSamples = sampleCount * channelCount;
    auto* data = new AudioData{
        std::vector<float>(samples, samples + totalSamples),
        channelCount,
        sampleRate
    };

    audioTsfn.BlockingCall(data, [](Napi::Env env, Napi::Function jsCallback, AudioData* data) {
        // Create Float32Array for the samples
        Napi::Float32Array samplesArray = Napi::Float32Array::New(env, data->samples.size());
        for (size_t i = 0; i < data->samples.size(); i++) {
            samplesArray[i] = data->samples[i];
        }

        // Create info object
        Napi::Object info = Napi::Object::New(env);
        info.Set("samples", samplesArray);
        info.Set("channelCount", Napi::Number::New(env, data->channelCount));
        info.Set("sampleRate", Napi::Number::New(env, data->sampleRate));
        info.Set("sampleCount", Napi::Number::New(env, data->samples.size() / data->channelCount));

        jsCallback.Call({info});
        delete data;
    });
}

Napi::Value IsSystemAudioCaptureAvailable(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (@available(macOS 13.0, *)) {
        return Napi::Boolean::New(env, [SystemAudioCapture isAvailable]);
    }
    return Napi::Boolean::New(env, false);
}

// Store for tracking capture start result
static std::atomic<bool> captureStartPending{false};
static std::atomic<bool> captureStartSuccess{false};
static std::string captureStartError;

Napi::Value StartSystemAudioCapture(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Callback function required").ThrowAsJavaScriptException();
        return env.Null();
    }

    // Check availability - audio capture requires macOS 13.0+
    if (@available(macOS 13.0, *)) {
        // Clean up previous TSFN if called twice without stop
        if (audioTsfnInitialized) {
            audioTsfn.Release();
            audioTsfnInitialized = false;
        }

        // Create thread-safe function for audio callbacks
        audioTsfn = Napi::ThreadSafeFunction::New(
            env,
            info[0].As<Napi::Function>(),
            "SystemAudioCallback",
            0,  // Unlimited queue
            1   // Initial thread count
        );
        audioTsfnInitialized = true;

        // Set callback and start capture
        SystemAudioCapture *capture = [SystemAudioCapture sharedInstance];
        capture.audioCallback = audioSamplesReceived;

        // Use a semaphore to wait for the async result
        dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
        __block BOOL blockSuccess = NO;
        __block NSString *blockError = nil;

        [capture startCaptureWithCompletion:^(BOOL success, NSError * _Nullable error) {
            blockSuccess = success;
            if (error) {
                blockError = [error.localizedDescription copy];
            }
            dispatch_semaphore_signal(semaphore);
        }];

        // Wait for completion (with timeout)
        dispatch_time_t timeout = dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC);
        long result = dispatch_semaphore_wait(semaphore, timeout);

        if (result != 0) {
            // Timeout
            Napi::Object resultObj = Napi::Object::New(env);
            resultObj.Set("success", Napi::Boolean::New(env, false));
            resultObj.Set("error", Napi::String::New(env, "Timeout waiting for capture to start"));
            return resultObj;
        }

        Napi::Object resultObj = Napi::Object::New(env);
        resultObj.Set("success", Napi::Boolean::New(env, blockSuccess));
        if (blockError) {
            resultObj.Set("error", Napi::String::New(env, [blockError UTF8String]));
        }
        return resultObj;
    } else {
        Napi::Object resultObj = Napi::Object::New(env);
        resultObj.Set("success", Napi::Boolean::New(env, false));
        resultObj.Set("error", Napi::String::New(env, "System audio capture requires macOS 12.3 or later"));
        return resultObj;
    }
}

Napi::Value StopSystemAudioCapture(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (@available(macOS 13.0, *)) {
        SystemAudioCapture *capture = [SystemAudioCapture sharedInstance];
        [capture stopCapture];
        capture.audioCallback = NULL;

        if (audioTsfnInitialized) {
            audioTsfn.Release();
            audioTsfnInitialized = false;
        }
    }

    return env.Undefined();
}

Napi::Value IsSystemAudioCapturing(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (@available(macOS 13.0, *)) {
        SystemAudioCapture *capture = [SystemAudioCapture sharedInstance];
        return Napi::Boolean::New(env, [capture isCapturing]);
    }
    return Napi::Boolean::New(env, false);
}

// Microphone Capture functions

// Counter for logging frequency
static int micCallbackCount = 0;

// Callback from Objective-C for mic audio samples
void micSamplesReceived(const float* samples, size_t sampleCount, int channelCount, double sampleRate) {
    micCallbackCount++;

    // Log every 100th callback to avoid spam
    if (micCallbackCount % 100 == 1) {
        // Calculate RMS and peak for logging
        float rms = 0;
        float peak = 0;
        size_t totalSamples = sampleCount * channelCount;
        for (size_t i = 0; i < totalSamples; i++) {
            rms += samples[i] * samples[i];
            float absVal = fabsf(samples[i]);
            if (absVal > peak) peak = absVal;
        }
        rms = sqrtf(rms / totalSamples);

        NSLog(@"[MicCapture] micSamplesReceived #%d: sampleCount=%zu, channelCount=%d, sampleRate=%.0f, rms=%.6f, peak=%.6f",
              micCallbackCount, sampleCount, channelCount, sampleRate, rms, peak);
    }

    if (!micTsfnInitialized) {
        if (micCallbackCount % 100 == 1) {
            NSLog(@"[MicCapture] Warning: micTsfnInitialized is false, dropping samples");
        }
        return;
    }

    // Create data to pass to JS - we need to copy the samples as the buffer may be reused
    struct MicAudioData {
        std::vector<float> samples;
        int channelCount;
        double sampleRate;
    };

    size_t totalSamples = sampleCount * channelCount;
    auto* data = new MicAudioData{
        std::vector<float>(samples, samples + totalSamples),
        channelCount,
        sampleRate
    };

    micTsfn.BlockingCall(data, [](Napi::Env env, Napi::Function jsCallback, MicAudioData* data) {
        // Create Float32Array for the samples
        Napi::Float32Array samplesArray = Napi::Float32Array::New(env, data->samples.size());
        for (size_t i = 0; i < data->samples.size(); i++) {
            samplesArray[i] = data->samples[i];
        }

        // Create info object
        Napi::Object info = Napi::Object::New(env);
        info.Set("samples", samplesArray);
        info.Set("channelCount", Napi::Number::New(env, data->channelCount));
        info.Set("sampleRate", Napi::Number::New(env, data->sampleRate));
        info.Set("sampleCount", Napi::Number::New(env, data->samples.size() / data->channelCount));

        jsCallback.Call({info});
        delete data;
    });
}

Napi::Value IsMicCaptureAvailable(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return Napi::Boolean::New(env, [MicCapture isAvailable]);
}

Napi::Value StartMicCapture(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Callback function required").ThrowAsJavaScriptException();
        return env.Null();
    }

    // Clean up previous TSFN if called twice without stop
    if (micTsfnInitialized) {
        micTsfn.Release();
        micTsfnInitialized = false;
    }

    // Create thread-safe function for mic audio callbacks
    micTsfn = Napi::ThreadSafeFunction::New(
        env,
        info[0].As<Napi::Function>(),
        "MicCaptureCallback",
        0,  // Unlimited queue
        1   // Initial thread count
    );
    micTsfnInitialized = true;

    // Set callback and start capture
    MicCapture *capture = [MicCapture sharedInstance];
    capture.audioCallback = micSamplesReceived;

    // Use a semaphore to wait for the async result
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    __block BOOL blockSuccess = NO;
    __block NSString *blockError = nil;

    [capture startCaptureWithCompletion:^(BOOL success, NSError * _Nullable error) {
        blockSuccess = success;
        if (error) {
            blockError = [error.localizedDescription copy];
        }
        dispatch_semaphore_signal(semaphore);
    }];

    // Wait for completion (with timeout)
    dispatch_time_t timeout = dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC);
    long result = dispatch_semaphore_wait(semaphore, timeout);

    if (result != 0) {
        // Timeout
        Napi::Object resultObj = Napi::Object::New(env);
        resultObj.Set("success", Napi::Boolean::New(env, false));
        resultObj.Set("error", Napi::String::New(env, "Timeout waiting for mic capture to start"));
        return resultObj;
    }

    Napi::Object resultObj = Napi::Object::New(env);
    resultObj.Set("success", Napi::Boolean::New(env, blockSuccess));
    if (blockError) {
        resultObj.Set("error", Napi::String::New(env, [blockError UTF8String]));
    }
    return resultObj;
}

Napi::Value StopMicCapture(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    MicCapture *capture = [MicCapture sharedInstance];
    [capture stopCapture];
    capture.audioCallback = NULL;

    if (micTsfnInitialized) {
        micTsfn.Release();
        micTsfnInitialized = false;
    }

    return env.Undefined();
}

Napi::Value IsMicCapturing(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    MicCapture *capture = [MicCapture sharedInstance];
    return Napi::Boolean::New(env, [capture isCapturing]);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    // Media monitoring
    exports.Set("start", Napi::Function::New(env, Start));
    exports.Set("stop", Napi::Function::New(env, Stop));
    exports.Set("isMicrophoneInUse", Napi::Function::New(env, IsMicrophoneInUse));
    exports.Set("isCameraInUse", Napi::Function::New(env, IsCameraInUse));

    // Meeting app detection
    exports.Set("getRunningMeetingApps", Napi::Function::New(env, GetRunningMeetingApps));
    exports.Set("getLikelyMeetingAppUsingMic", Napi::Function::New(env, GetLikelyMeetingAppUsingMic));
    exports.Set("getCurrentMeetingApp", Napi::Function::New(env, GetCurrentMeetingApp));

    // System audio capture
    exports.Set("isSystemAudioCaptureAvailable", Napi::Function::New(env, IsSystemAudioCaptureAvailable));
    exports.Set("startSystemAudioCapture", Napi::Function::New(env, StartSystemAudioCapture));
    exports.Set("stopSystemAudioCapture", Napi::Function::New(env, StopSystemAudioCapture));
    exports.Set("isSystemAudioCapturing", Napi::Function::New(env, IsSystemAudioCapturing));

    // Native microphone capture
    exports.Set("isMicCaptureAvailable", Napi::Function::New(env, IsMicCaptureAvailable));
    exports.Set("startMicCapture", Napi::Function::New(env, StartMicCapture));
    exports.Set("stopMicCapture", Napi::Function::New(env, StopMicCapture));
    exports.Set("isMicCapturing", Napi::Function::New(env, IsMicCapturing));

    return exports;
}

NODE_API_MODULE(media_monitor, Init)

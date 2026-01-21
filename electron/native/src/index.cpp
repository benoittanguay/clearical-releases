// electron/native/src/index.cpp
#include <napi.h>
#include "media_monitor.h"

// Store reference to JS callback function
static Napi::ThreadSafeFunction tsfn;
static bool tsfnInitialized = false;

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

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("start", Napi::Function::New(env, Start));
    exports.Set("stop", Napi::Function::New(env, Stop));
    exports.Set("isMicrophoneInUse", Napi::Function::New(env, IsMicrophoneInUse));
    exports.Set("isCameraInUse", Napi::Function::New(env, IsCameraInUse));
    return exports;
}

NODE_API_MODULE(media_monitor, Init)

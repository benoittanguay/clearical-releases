// electron/native/src/media_monitor.mm
#import "media_monitor.h"
#import <CoreMediaIO/CMIOHardware.h>
#import <IOKit/IOKitLib.h>

@implementation MediaMonitor {
    AudioObjectPropertyAddress _micPropertyAddress;
    AudioDeviceID _currentInputDevice;
    BOOL _isMonitoring;
    dispatch_queue_t _monitoringQueue;
    NSTimer *_cameraPollingTimer;
}

+ (instancetype)sharedInstance {
    static MediaMonitor *instance = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        instance = [[MediaMonitor alloc] init];
    });
    return instance;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        _microphoneInUse = NO;
        _cameraInUse = NO;
        _isMonitoring = NO;
        _callback = NULL;
        _currentInputDevice = kAudioDeviceUnknown;
        _monitoringQueue = dispatch_queue_create("com.mediamonitor.queue", DISPATCH_QUEUE_SERIAL);
        _cameraPollingTimer = nil;

        // Set up property address for microphone "in use" detection
        _micPropertyAddress.mSelector = kAudioDevicePropertyDeviceIsRunningSomewhere;
        _micPropertyAddress.mScope = kAudioObjectPropertyScopeGlobal;
        _micPropertyAddress.mElement = kAudioObjectPropertyElementMain;
    }
    return self;
}

- (void)dealloc {
    [self stopMonitoring];
}

static OSStatus microphoneCallback(
    AudioObjectID inObjectID,
    UInt32 inNumberAddresses,
    const AudioObjectPropertyAddress *inAddresses,
    void *inClientData
) {
    MediaMonitor *monitor = (__bridge MediaMonitor *)inClientData;
    dispatch_async(monitor->_monitoringQueue, ^{
        [monitor checkMicrophoneStateInternal];
    });
    return noErr;
}

- (void)startMonitoring {
    dispatch_sync(_monitoringQueue, ^{
        if (_isMonitoring) return;
        _isMonitoring = YES;

        // Get default input device
        AudioObjectPropertyAddress defaultDeviceAddress = {
            kAudioHardwarePropertyDefaultInputDevice,
            kAudioObjectPropertyScopeGlobal,
            kAudioObjectPropertyElementMain
        };

        UInt32 size = sizeof(_currentInputDevice);
        OSStatus status = AudioObjectGetPropertyData(
            kAudioObjectSystemObject,
            &defaultDeviceAddress,
            0,
            NULL,
            &size,
            &_currentInputDevice
        );

        if (status == noErr && _currentInputDevice != kAudioDeviceUnknown) {
            // Add listener for microphone state changes
            AudioObjectAddPropertyListener(
                _currentInputDevice,
                &_micPropertyAddress,
                microphoneCallback,
                (__bridge void *)self
            );

            // Check initial state
            [self checkMicrophoneStateInternal];
        } else {
            NSLog(@"[MediaMonitor] Failed to get default input device: %d", (int)status);
        }

        // Start camera monitoring using polling
        [self startCameraMonitoringInternal];
    });
}

- (void)checkMicrophoneState {
    dispatch_async(_monitoringQueue, ^{
        [self checkMicrophoneStateInternal];
    });
}

- (void)checkMicrophoneStateInternal {
    // Must be called on _monitoringQueue
    if (_currentInputDevice == kAudioDeviceUnknown) {
        return;
    }

    UInt32 isRunning = 0;
    UInt32 size = sizeof(isRunning);
    OSStatus status = AudioObjectGetPropertyData(
        _currentInputDevice,
        &_micPropertyAddress,
        0,
        NULL,
        &size,
        &isRunning
    );

    if (status == noErr) {
        BOOL wasInUse = _microphoneInUse;
        _microphoneInUse = (isRunning != 0);

        if (wasInUse != _microphoneInUse && _callback) {
            _callback(_microphoneInUse, "microphone");
        }
    } else {
        NSLog(@"[MediaMonitor] Failed to check microphone state: %d", (int)status);
    }
}

- (void)startCameraMonitoringInternal {
    // Must be called on _monitoringQueue
    // Check initial state
    [self checkCameraStateInternal];

    // Start polling timer on main thread (timers need a run loop)
    dispatch_async(dispatch_get_main_queue(), ^{
        if (self->_cameraPollingTimer) {
            [self->_cameraPollingTimer invalidate];
        }
        // Poll every 1 second for camera state changes
        self->_cameraPollingTimer = [NSTimer scheduledTimerWithTimeInterval:1.0
                                                                     target:self
                                                                   selector:@selector(cameraPollTick)
                                                                   userInfo:nil
                                                                    repeats:YES];
    });
}

- (void)cameraPollTick {
    dispatch_async(_monitoringQueue, ^{
        [self checkCameraStateInternal];
    });
}

- (void)checkCameraState {
    dispatch_async(_monitoringQueue, ^{
        [self checkCameraStateInternal];
    });
}

- (BOOL)isCameraInUseViaCMIO {
    // Use CoreMediaIO to check if any video device is being used
    // This approach queries the DAL (Device Abstraction Layer) for device status

    CMIOObjectPropertyAddress propertyAddress = {
        kCMIOHardwarePropertyDevices,
        kCMIOObjectPropertyScopeGlobal,
        kCMIOObjectPropertyElementMain
    };

    UInt32 dataSize = 0;
    OSStatus status = CMIOObjectGetPropertyDataSize(
        kCMIOObjectSystemObject,
        &propertyAddress,
        0,
        NULL,
        &dataSize
    );

    if (status != noErr) {
        return NO;
    }

    UInt32 deviceCount = dataSize / sizeof(CMIODeviceID);
    if (deviceCount == 0) {
        return NO;
    }

    CMIODeviceID *devices = (CMIODeviceID *)malloc(dataSize);
    status = CMIOObjectGetPropertyData(
        kCMIOObjectSystemObject,
        &propertyAddress,
        0,
        NULL,
        dataSize,
        &dataSize,
        devices
    );

    if (status != noErr) {
        free(devices);
        return NO;
    }

    BOOL anyInUse = NO;

    for (UInt32 i = 0; i < deviceCount; i++) {
        CMIODeviceID deviceId = devices[i];

        // Check if this is a video device by checking if it has video streams
        CMIOObjectPropertyAddress streamAddress = {
            kCMIODevicePropertyStreams,
            kCMIOObjectPropertyScopeGlobal,
            kCMIOObjectPropertyElementMain
        };

        UInt32 streamDataSize = 0;
        status = CMIOObjectGetPropertyDataSize(
            deviceId,
            &streamAddress,
            0,
            NULL,
            &streamDataSize
        );

        if (status != noErr || streamDataSize == 0) {
            continue;
        }

        // Check if device is running (being used)
        CMIOObjectPropertyAddress runningAddress = {
            kCMIODevicePropertyDeviceIsRunningSomewhere,
            kCMIOObjectPropertyScopeGlobal,
            kCMIOObjectPropertyElementMain
        };

        UInt32 isRunning = 0;
        UInt32 runningSize = sizeof(isRunning);
        status = CMIOObjectGetPropertyData(
            deviceId,
            &runningAddress,
            0,
            NULL,
            runningSize,
            &runningSize,
            &isRunning
        );

        if (status == noErr && isRunning != 0) {
            anyInUse = YES;
            break;
        }
    }

    free(devices);
    return anyInUse;
}

- (void)checkCameraStateInternal {
    // Must be called on _monitoringQueue
    BOOL anyInUse = [self isCameraInUseViaCMIO];

    BOOL wasInUse = _cameraInUse;
    _cameraInUse = anyInUse;

    if (wasInUse != _cameraInUse && _callback) {
        _callback(_cameraInUse, "camera");
    }
}

- (void)stopMonitoring {
    dispatch_sync(_monitoringQueue, ^{
        if (!_isMonitoring) return;
        _isMonitoring = NO;

        // Remove microphone listener
        if (_currentInputDevice != kAudioDeviceUnknown) {
            AudioObjectRemovePropertyListener(
                _currentInputDevice,
                &_micPropertyAddress,
                microphoneCallback,
                (__bridge void *)self
            );
            _currentInputDevice = kAudioDeviceUnknown;
        }
    });

    // Stop camera polling timer on main thread
    dispatch_async(dispatch_get_main_queue(), ^{
        if (self->_cameraPollingTimer) {
            [self->_cameraPollingTimer invalidate];
            self->_cameraPollingTimer = nil;
        }
    });
}

- (BOOL)isMicrophoneInUse {
    __block BOOL result;
    dispatch_sync(_monitoringQueue, ^{
        result = _microphoneInUse;
    });
    return result;
}

- (BOOL)isCameraInUse {
    __block BOOL result;
    dispatch_sync(_monitoringQueue, ^{
        result = _cameraInUse;
    });
    return result;
}

@end

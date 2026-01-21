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
    NSTimer *_micPollingTimer;  // Fallback polling for mic
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

        // Start microphone polling as a fallback (some devices don't fire callbacks reliably)
        [self startMicPollingInternal];
    });
}

- (void)checkMicrophoneState {
    dispatch_async(_monitoringQueue, ^{
        [self checkMicrophoneStateInternal];
    });
}

- (void)checkMicrophoneStateInternal {
    // Must be called on _monitoringQueue
    // Check ALL input devices, not just the default one
    // This is more reliable as some apps use non-default devices

    AudioObjectPropertyAddress deviceListAddress = {
        kAudioHardwarePropertyDevices,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };

    UInt32 dataSize = 0;
    OSStatus status = AudioObjectGetPropertyDataSize(
        kAudioObjectSystemObject,
        &deviceListAddress,
        0,
        NULL,
        &dataSize
    );

    if (status != noErr || dataSize == 0) {
        NSLog(@"[MediaMonitor] Failed to get device list size: %d", (int)status);
        return;
    }

    UInt32 deviceCount = dataSize / sizeof(AudioDeviceID);
    AudioDeviceID *devices = (AudioDeviceID *)malloc(dataSize);

    status = AudioObjectGetPropertyData(
        kAudioObjectSystemObject,
        &deviceListAddress,
        0,
        NULL,
        &dataSize,
        devices
    );

    if (status != noErr) {
        NSLog(@"[MediaMonitor] Failed to get device list: %d", (int)status);
        free(devices);
        return;
    }

    BOOL anyInputRunning = NO;
    NSMutableArray *runningDeviceNames = [NSMutableArray array];

    for (UInt32 i = 0; i < deviceCount; i++) {
        AudioDeviceID device = devices[i];

        // Check if this device has input channels (is an input device)
        AudioObjectPropertyAddress inputChannelsAddress = {
            kAudioDevicePropertyStreamConfiguration,
            kAudioDevicePropertyScopeInput,
            kAudioObjectPropertyElementMain
        };

        UInt32 channelDataSize = 0;
        status = AudioObjectGetPropertyDataSize(device, &inputChannelsAddress, 0, NULL, &channelDataSize);

        if (status == noErr && channelDataSize > 0) {
            AudioBufferList *bufferList = (AudioBufferList *)malloc(channelDataSize);
            status = AudioObjectGetPropertyData(device, &inputChannelsAddress, 0, NULL, &channelDataSize, bufferList);

            UInt32 inputChannelCount = 0;
            if (status == noErr) {
                for (UInt32 j = 0; j < bufferList->mNumberBuffers; j++) {
                    inputChannelCount += bufferList->mBuffers[j].mNumberChannels;
                }
            }
            free(bufferList);

            // If this device has input channels, check if it's running
            if (inputChannelCount > 0) {
                UInt32 isRunning = 0;
                UInt32 runningSize = sizeof(isRunning);
                status = AudioObjectGetPropertyData(
                    device,
                    &_micPropertyAddress,
                    0,
                    NULL,
                    &runningSize,
                    &isRunning
                );

                if (status == noErr && isRunning != 0) {
                    anyInputRunning = YES;

                    // Get device name for logging
                    AudioObjectPropertyAddress nameAddress = {
                        kAudioDevicePropertyDeviceNameCFString,
                        kAudioObjectPropertyScopeGlobal,
                        kAudioObjectPropertyElementMain
                    };
                    CFStringRef deviceName = NULL;
                    UInt32 nameSize = sizeof(deviceName);
                    if (AudioObjectGetPropertyData(device, &nameAddress, 0, NULL, &nameSize, &deviceName) == noErr && deviceName) {
                        [runningDeviceNames addObject:(__bridge NSString *)deviceName];
                        CFRelease(deviceName);
                    }
                }
            }
        }
    }

    free(devices);

    BOOL wasInUse = _microphoneInUse;
    _microphoneInUse = anyInputRunning;

    if (anyInputRunning) {
        NSLog(@"[MediaMonitor] Microphone IN USE - running devices: %@", [runningDeviceNames componentsJoinedByString:@", "]);
    }

    // Only log state changes or periodically to reduce spam
    static int pollCount = 0;
    pollCount++;
    if (wasInUse != _microphoneInUse || pollCount % 30 == 0) {
        NSLog(@"[MediaMonitor] Mic state: wasInUse=%d, anyInputRunning=%d, stateChanged=%d",
              wasInUse, anyInputRunning, wasInUse != _microphoneInUse);
    }

    if (wasInUse != _microphoneInUse && _callback) {
        NSLog(@"[MediaMonitor] *** FIRING MICROPHONE CALLBACK: isActive=%d ***", _microphoneInUse);
        _callback(_microphoneInUse, "microphone");
    }
}

- (void)startMicPollingInternal {
    // Fallback polling for microphone - some devices don't fire callbacks reliably
    dispatch_async(dispatch_get_main_queue(), ^{
        if (self->_micPollingTimer) {
            [self->_micPollingTimer invalidate];
        }
        // Poll every 1 second for mic state changes as fallback
        self->_micPollingTimer = [NSTimer scheduledTimerWithTimeInterval:1.0
                                                                  target:self
                                                                selector:@selector(micPollTick)
                                                                userInfo:nil
                                                                 repeats:YES];
    });
}

- (void)micPollTick {
    dispatch_async(_monitoringQueue, ^{
        [self checkMicrophoneStateInternal];
    });
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

    // Stop polling timers on main thread
    dispatch_async(dispatch_get_main_queue(), ^{
        if (self->_cameraPollingTimer) {
            [self->_cameraPollingTimer invalidate];
            self->_cameraPollingTimer = nil;
        }
        if (self->_micPollingTimer) {
            [self->_micPollingTimer invalidate];
            self->_micPollingTimer = nil;
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

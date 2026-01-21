// electron/native/src/media_monitor.mm
#import "media_monitor.h"

static const void *kCameraInUseContext = &kCameraInUseContext;

@implementation MediaMonitor {
    AudioObjectPropertyAddress _micPropertyAddress;
    AudioDeviceID _currentInputDevice;
    BOOL _isMonitoring;
    dispatch_queue_t _monitoringQueue;
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
        [monitor checkMicrophoneState];
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

        // Start camera monitoring
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
    // Observe all video devices
    NSArray *devices = [AVCaptureDevice devicesWithMediaType:AVMediaTypeVideo];
    for (AVCaptureDevice *device in devices) {
        [device addObserver:self
                 forKeyPath:@"inUseByAnotherClient"
                    options:NSKeyValueObservingOptionNew
                    context:(void *)kCameraInUseContext];
    }

    // Also monitor device connections for new cameras
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(deviceConnected:)
                                                 name:AVCaptureDeviceWasConnectedNotification
                                               object:nil];

    // Check initial state
    [self checkCameraStateInternal];
}

- (void)observeValueForKeyPath:(NSString *)keyPath
                      ofObject:(id)object
                        change:(NSDictionary *)change
                       context:(void *)context {
    if (context == kCameraInUseContext) {
        dispatch_async(_monitoringQueue, ^{
            [self checkCameraStateInternal];
        });
    } else {
        [super observeValueForKeyPath:keyPath ofObject:object change:change context:context];
    }
}

- (void)deviceConnected:(NSNotification *)notification {
    AVCaptureDevice *device = notification.object;
    if ([device hasMediaType:AVMediaTypeVideo]) {
        dispatch_async(_monitoringQueue, ^{
            [device addObserver:self
                     forKeyPath:@"inUseByAnotherClient"
                        options:NSKeyValueObservingOptionNew
                        context:(void *)kCameraInUseContext];
        });
    }
}

- (void)checkCameraState {
    dispatch_async(_monitoringQueue, ^{
        [self checkCameraStateInternal];
    });
}

- (void)checkCameraStateInternal {
    // Must be called on _monitoringQueue
    BOOL anyInUse = NO;
    NSArray *devices = [AVCaptureDevice devicesWithMediaType:AVMediaTypeVideo];
    for (AVCaptureDevice *device in devices) {
        if (device.isInUseByAnotherClient) {
            anyInUse = YES;
            break;
        }
    }

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

        // Remove camera observers
        NSArray *devices = [AVCaptureDevice devicesWithMediaType:AVMediaTypeVideo];
        for (AVCaptureDevice *device in devices) {
            @try {
                [device removeObserver:self forKeyPath:@"inUseByAnotherClient" context:(void *)kCameraInUseContext];
            } @catch (NSException *exception) {
                // Observer wasn't registered
            }
        }

        [[NSNotificationCenter defaultCenter] removeObserver:self];
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

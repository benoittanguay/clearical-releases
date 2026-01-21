// electron/native/src/media_monitor.h
#ifndef MEDIA_MONITOR_H
#define MEDIA_MONITOR_H

#import <Foundation/Foundation.h>
#import <CoreAudio/CoreAudio.h>
#import <AVFoundation/AVFoundation.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef void (*MediaStateCallback)(bool isActive, const char* deviceType);

@interface MediaMonitor : NSObject

@property (nonatomic, assign) MediaStateCallback callback;
@property (nonatomic, assign) BOOL microphoneInUse;
@property (nonatomic, assign) BOOL cameraInUse;

+ (instancetype)sharedInstance;
- (void)startMonitoring;
- (void)stopMonitoring;
- (BOOL)isMicrophoneInUse;
- (BOOL)isCameraInUse;

@end

#ifdef __cplusplus
}
#endif

#endif // MEDIA_MONITOR_H

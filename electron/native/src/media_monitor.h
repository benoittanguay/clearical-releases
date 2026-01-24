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
@property (nonatomic, strong, readonly) NSDictionary *likelyMeetingApp;

+ (instancetype)sharedInstance;
- (void)startMonitoring;
- (void)stopMonitoring;
- (BOOL)isMicrophoneInUse;
- (BOOL)isCameraInUse;

/**
 * Get list of known meeting apps currently running
 * Returns array of dictionaries with keys: bundleId, appName, pid
 */
- (NSArray<NSDictionary *> *)getRunningMeetingApps;

/**
 * Get the meeting app most likely using the microphone
 * Called automatically when mic state changes to active
 * Returns dictionary with bundleId, appName, pid or nil if no meeting app found
 */
- (NSDictionary *)getLikelyMeetingAppUsingMic;

@end

#ifdef __cplusplus
}
#endif

#endif // MEDIA_MONITOR_H

#pragma once
#import <Foundation/Foundation.h>
#include <sys/types.h>

@interface ScreenshotCapture : NSObject
+ (NSData * _Nullable)captureWindowWithPID:(pid_t)pid windowTitle:(NSString * _Nullable)windowTitle;

/**
 * Get the frontmost (active) window info using NSWorkspace + CGWindowListCopyWindowInfo.
 * Returns dictionary with keys: appName, windowTitle, bundleId, pid.
 * Sandbox-safe — no osascript needed.
 */
+ (NSDictionary * _Nullable)getActiveWindow;
@end

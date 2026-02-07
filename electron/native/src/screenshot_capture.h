#pragma once
#import <Foundation/Foundation.h>
#include <sys/types.h>

@interface ScreenshotCapture : NSObject
+ (NSData * _Nullable)captureWindowWithPID:(pid_t)pid windowTitle:(NSString * _Nullable)windowTitle;
@end

#import "screenshot_capture.h"
#import <CoreGraphics/CoreGraphics.h>
#import <ImageIO/ImageIO.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#import <AppKit/AppKit.h>

@implementation ScreenshotCapture

+ (NSData * _Nullable)captureWindowWithPID:(pid_t)pid windowTitle:(NSString * _Nullable)windowTitle {
    // Enumerate all on-screen windows, excluding desktop elements
    CFArrayRef windowList = CGWindowListCopyWindowInfo(
        kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
        kCGNullWindowID
    );

    if (!windowList) {
        NSLog(@"[ScreenshotCapture] Failed to enumerate windows");
        return nil;
    }

    NSArray *windows = CFBridgingRelease(windowList);
    CGWindowID targetWindowID = kCGNullWindowID;
    CGWindowID firstPIDMatch = kCGNullWindowID;

    for (NSDictionary *window in windows) {
        // Get window owner PID
        pid_t ownerPID = [window[(__bridge NSString *)kCGWindowOwnerPID] intValue];
        if (ownerPID != pid) continue;

        // Only consider standard layer-0 windows (not menus, tooltips, etc.)
        int windowLayer = [window[(__bridge NSString *)kCGWindowLayer] intValue];
        if (windowLayer != 0) continue;

        CGWindowID windowID = [window[(__bridge NSString *)kCGWindowNumber] unsignedIntValue];

        // Track first PID match as fallback
        if (firstPIDMatch == kCGNullWindowID) {
            firstPIDMatch = windowID;
        }

        // If we have a window title, try to match it for disambiguation
        if (windowTitle && windowTitle.length > 0) {
            NSString *name = window[(__bridge NSString *)kCGWindowName];
            if (name && [name isEqualToString:windowTitle]) {
                targetWindowID = windowID;
                NSLog(@"[ScreenshotCapture] Exact title match: \"%@\" (windowID=%u, pid=%d)", name, windowID, pid);
                break;
            }
        }
    }

    // Fall back to first PID-matched window if title matching failed
    if (targetWindowID == kCGNullWindowID) {
        targetWindowID = firstPIDMatch;
        if (targetWindowID != kCGNullWindowID) {
            NSLog(@"[ScreenshotCapture] Using first layer-0 window for PID %d (windowID=%u)", pid, targetWindowID);
        }
    }

    if (targetWindowID == kCGNullWindowID) {
        NSLog(@"[ScreenshotCapture] No matching window found for PID %d. Available windows:", pid);
        for (NSDictionary *window in windows) {
            NSLog(@"[ScreenshotCapture]   PID=%d Layer=%d Name=%@ WindowID=%u",
                  [window[(__bridge NSString *)kCGWindowOwnerPID] intValue],
                  [window[(__bridge NSString *)kCGWindowLayer] intValue],
                  window[(__bridge NSString *)kCGWindowName] ?: @"<unnamed>",
                  [window[(__bridge NSString *)kCGWindowNumber] unsignedIntValue]);
        }
        return nil;
    }

    // Capture the specific window at 1x (logical) resolution, no shadow
    // kCGWindowImageNominalResolution prevents 2-4x larger images on Retina displays
    CGImageRef cgImage = CGWindowListCreateImage(
        CGRectNull,
        kCGWindowListOptionIncludingWindow,
        targetWindowID,
        kCGWindowImageBoundsIgnoreFraming | kCGWindowImageNominalResolution
    );

    if (!cgImage) {
        NSLog(@"[ScreenshotCapture] CGWindowListCreateImage failed for windowID=%u", targetWindowID);
        return nil;
    }

    // Convert CGImageRef to PNG data
    NSMutableData *pngData = [NSMutableData data];
    CGImageDestinationRef destination = CGImageDestinationCreateWithData(
        (__bridge CFMutableDataRef)pngData,
        (__bridge CFStringRef)UTTypePNG.identifier,
        1,
        NULL
    );

    if (!destination) {
        NSLog(@"[ScreenshotCapture] Failed to create image destination");
        CGImageRelease(cgImage);
        return nil;
    }

    CGImageDestinationAddImage(destination, cgImage, NULL);
    bool success = CGImageDestinationFinalize(destination);
    CFRelease(destination);
    CGImageRelease(cgImage);

    if (!success) {
        NSLog(@"[ScreenshotCapture] Failed to finalize PNG image");
        return nil;
    }

    NSLog(@"[ScreenshotCapture] Captured window (pid=%d, windowID=%u, %lu bytes PNG)",
          pid, targetWindowID, (unsigned long)pngData.length);
    return pngData;
}

+ (NSDictionary * _Nullable)getActiveWindow {
    // Get frontmost app via NSWorkspace (sandbox-safe)
    NSRunningApplication *frontApp = [[NSWorkspace sharedWorkspace] frontmostApplication];
    if (!frontApp) return nil;

    NSString *appName = frontApp.localizedName ?: @"Unknown";
    NSString *bundleId = frontApp.bundleIdentifier ?: @"";
    pid_t pid = frontApp.processIdentifier;

    // Get window title via CGWindowListCopyWindowInfo (sandbox-safe)
    NSString *windowTitle = @"";

    CFArrayRef windowList = CGWindowListCopyWindowInfo(
        kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
        kCGNullWindowID
    );

    if (windowList) {
        NSArray *windows = CFBridgingRelease(windowList);
        for (NSDictionary *window in windows) {
            pid_t ownerPID = [window[(__bridge NSString *)kCGWindowOwnerPID] intValue];
            if (ownerPID != pid) continue;

            // Only consider standard layer-0 windows
            int windowLayer = [window[(__bridge NSString *)kCGWindowLayer] intValue];
            if (windowLayer != 0) continue;

            NSString *name = window[(__bridge NSString *)kCGWindowName];
            if (name && name.length > 0) {
                windowTitle = name;
                break;
            }
        }
    }

    return @{
        @"appName": appName,
        @"windowTitle": windowTitle,
        @"bundleId": bundleId,
        @"pid": @(pid),
    };
}

@end

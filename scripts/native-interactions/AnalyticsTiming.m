// Loaded only into the CI simulator. Time the Apple SDK's main-thread call
// and the interval between the display callbacks immediately surrounding it.
#import <Foundation/Foundation.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/runtime.h>

extern void recordResponseStacks(void);
static void (*configureFirebase)(id, SEL, id);
static CFTimeInterval start, end, previousFrame, frameGap;
static BOOL configuredOnMain;

@interface AnalyticsDisplayClock : NSObject
@end
@implementation AnalyticsDisplayClock
- (void)frame:(CADisplayLink *)link {
  CFTimeInterval now = CACurrentMediaTime();
  if (previousFrame && end && previousFrame <= end && now >= start) frameGap = now - previousFrame;
  previousFrame = now;
}
@end

static void measureConfigure(id receiver, SEL selector, id options) {
  configuredOnMain = NSThread.isMainThread;
  recordResponseStacks();
  start = CACurrentMediaTime();
  configureFirebase(receiver, selector, options);
  end = CACurrentMediaTime();
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 1200 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
    NSDictionary *result = @{@"startMs": @(start * 1000), @"configureMs": @((end - start) * 1000),
      @"mainThread": @(configuredOnMain), @"displayGapMs": frameGap ? @(frameGap * 1000) : NSNull.null};
    NSString *cache = NSSearchPathForDirectoriesInDomains(NSCachesDirectory, NSUserDomainMask, YES).firstObject;
    NSData *json = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
    [json writeToFile:[cache stringByAppendingPathComponent:@"analytics-main.json"] atomically:YES];
  });
}

__attribute__((constructor)) static void installAnalyticsClock(void) {
  dispatch_async(dispatch_get_main_queue(), ^{
    Method method = class_getClassMethod(NSClassFromString(@"FIRApp"), NSSelectorFromString(@"configureWithOptions:"));
    if (!method) return;
    configureFirebase = (void (*)(id, SEL, id))method_setImplementation(method, (IMP)measureConfigure);
    CADisplayLink *link = [CADisplayLink displayLinkWithTarget:[AnalyticsDisplayClock new] selector:@selector(frame:)];
    link.preferredFramesPerSecond = 60;
    [link addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
  });
}

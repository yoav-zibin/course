#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>

void BPPerformCheckerDrags(CGPoint firstStart, CGPoint firstEnd, CGPoint secondStart, CGPoint secondEnd,
                           NSTimeInterval gap,
                           void (^ _Nonnull completion)(BOOL, NSError * _Nullable));

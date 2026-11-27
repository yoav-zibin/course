#import "RapidDrags.h"
#import <UIKit/UIKit.h>
#import <XCTest/XCTest.h>

// XCTest's individual public gesture calls wait for idle between drags. Its
// simulator event synthesizer can play two timed contacts in one record.
@interface NSObject (BPTestTouchTimeline)
- (instancetype)initForTouchAtPoint:(CGPoint)point offset:(NSTimeInterval)offset;
- (void)moveToPoint:(CGPoint)point atOffset:(NSTimeInterval)offset;
- (void)liftUpAtOffset:(NSTimeInterval)offset;
- (instancetype)initWithName:(NSString *)name interfaceOrientation:(UIInterfaceOrientation)orientation;
- (void)addPointerEventPath:(id)path;
- (id)eventSynthesizer;
- (void)synthesizeEvent:(id)record completion:(void (^)(BOOL, NSError *))completion;
@end

static id checkerPath(Class pathClass, CGPoint from, CGPoint to, NSTimeInterval start) {
  id path=[[pathClass alloc] initForTouchAtPoint:from offset:start];
  for (int i=1;i<=12;i++) {
    CGFloat fraction=(CGFloat)i/12;
    CGPoint point=CGPointMake(from.x+(to.x-from.x)*fraction,from.y+(to.y-from.y)*fraction);
    [path moveToPoint:point atOffset:start+.03+.47*fraction];
  }
  [path liftUpAtOffset:start+.53];
  return path;
}

static void performDrags(CGPoint firstStart, CGPoint firstEnd, BOOL pair, CGPoint secondStart, CGPoint secondEnd,
                         void (^completion)(BOOL, NSError *)) {
  Class pathClass=NSClassFromString(@"XCPointerEventPath"),recordClass=NSClassFromString(@"XCSynthesizedEventRecord");
  XCUIDevice *device=XCUIDevice.sharedDevice;
  id synth=[device respondsToSelector:@selector(eventSynthesizer)]?[device eventSynthesizer]:nil;
  if (![synth respondsToSelector:@selector(synthesizeEvent:completion:)] ||
      ![recordClass instancesRespondToSelector:@selector(initWithName:interfaceOrientation:)] ||
      ![recordClass instancesRespondToSelector:@selector(addPointerEventPath:)] ||
      ![pathClass instancesRespondToSelector:@selector(initForTouchAtPoint:offset:)] ||
      ![pathClass instancesRespondToSelector:@selector(moveToPoint:atOffset:)] ||
      ![pathClass instancesRespondToSelector:@selector(liftUpAtOffset:)]) {
    completion(NO,[NSError errorWithDomain:@"BuildPlayInteractionTests" code:1
      userInfo:@{NSLocalizedDescriptionKey:@"This XCTest runtime cannot schedule both timed checker drags."}]);
    return;
  }
  id record=[[recordClass alloc] initWithName:@"Checker drag" interfaceOrientation:UIInterfaceOrientationPortrait];
  [record addPointerEventPath:checkerPath(pathClass,firstStart,firstEnd,0)];
  if(pair)[record addPointerEventPath:checkerPath(pathClass,secondStart,secondEnd,.59)];
  [synth synthesizeEvent:record completion:completion];
}

void BPPerformCheckerDrags(CGPoint from, CGPoint to, CGPoint nextFrom, CGPoint nextTo, void (^completion)(BOOL, NSError *)) {
  performDrags(from,to,YES,nextFrom,nextTo,completion);
}

void BPPerformCheckerDrag(CGPoint from, CGPoint to, void (^completion)(BOOL, NSError *)) {
  performDrags(from,to,NO,CGPointZero,CGPointZero,completion);
}

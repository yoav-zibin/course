// Simulator-only recorder. The stripe ties the video PTS to UITouch.timestamp.
#import <UIKit/UIKit.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/runtime.h>
#import <fcntl.h>
#import <unistd.h>

@interface ResponseStripe : UIView
@property(nonatomic) uint32_t stamp;
@end
@implementation ResponseStripe
- (void)drawRect:(CGRect)rect {
  CGContextRef c = UIGraphicsGetCurrentContext();
  [[UIColor blackColor] setFill]; UIRectFill(self.bounds);
  [[UIColor magentaColor] setFill]; UIRectFill(CGRectMake(0,0,5,6));
  [[UIColor whiteColor] setFill];
  for (int i=0; i<24; i++) if (_stamp & (1u<<i)) CGContextFillRect(c,CGRectMake(5+i*4,0,4,6));
  [[UIColor cyanColor] setFill]; UIRectFill(CGRectMake(101,0,5,6));
}
@end
@interface ResponseWindow : UIWindow
@end
@implementation ResponseWindow
- (UIView*)hitTest:(CGPoint)point withEvent:(UIEvent*)event { return nil; }
@end
@interface ResponseRecorder : NSObject
@property(nonatomic,strong) ResponseWindow *window;
@property(nonatomic,strong) ResponseStripe *stripe;
@end
extern void recordResponseStacks(void);
static int logfd = -1;
@implementation ResponseRecorder
- (void)frame:(CADisplayLink*)link {
  if (!_window) {
    UIWindowScene *scene=nil;
    for(UIScene *s in UIApplication.sharedApplication.connectedScenes)
      if([s isKindOfClass:UIWindowScene.class] && s.activationState==UISceneActivationStateForegroundActive){scene=(UIWindowScene*)s;break;}
    if(!scene)return;
    _window=[[ResponseWindow alloc] initWithWindowScene:scene];
    _window.frame=CGRectMake(4,67,106,6);
    _window.windowLevel=UIWindowLevelAlert+1000;
    _window.userInteractionEnabled=NO;_window.accessibilityElementsHidden=YES;
    _window.rootViewController=[UIViewController new];
    _stripe=[[ResponseStripe alloc] initWithFrame:CGRectMake(0,0,106,6)];
    [_window.rootViewController.view addSubview:_stripe];_window.hidden=NO;
    NSString *file=[NSSearchPathForDirectoriesInDomains(NSCachesDirectory,NSUserDomainMask,YES).firstObject stringByAppendingPathComponent:@"response-input.jsonl"];
    logfd=open(file.fileSystemRepresentation,O_WRONLY|O_CREAT|O_APPEND,0600);
    CGRect bounds=scene.coordinateSpace.bounds;
    dprintf(logfd,"{\"width\":%.1f,\"height\":%.1f,\"pid\":%d}\n",bounds.size.width,bounds.size.height,getpid());
  }
  // Use the target of one hardware refresh. Limiting the display link itself
  // to 5 Hz can put its advertised presentation time a whole interval ahead.
  static CFTimeInterval nextStamp;
  if (link.targetTimestamp < nextStamp) return;
  nextStamp=link.targetTimestamp+0.19;
  _stripe.stamp=(uint32_t)llround(link.targetTimestamp*1000)&0xffffff;
  [_stripe setNeedsDisplay];
}
@end
@interface UIApplication (ResponseTiming)
- (void)response_sendEvent:(UIEvent*)event;
@end
@implementation UIApplication (ResponseTiming)
- (void)response_sendEvent:(UIEvent*)event {
  if(logfd>=0 && event.type==UIEventTypeTouches){
    for(UITouch *t in event.allTouches){
      if(t.phase==UITouchPhaseStationary) continue;
      if(t.phase==UITouchPhaseBegan)recordResponseStacks();
      CGPoint p=[t locationInView:nil];
      dprintf(logfd,"{\"phase\":%ld,\"t\":%.3f,\"x\":%.2f,\"y\":%.2f,\"wall\":%.3f,\"pid\":%d}\n",
        (long)t.phase,t.timestamp*1000,p.x,p.y,NSDate.date.timeIntervalSince1970*1000,getpid());
    }
  }
  [self response_sendEvent:event];
}
@end
__attribute__((constructor)) static void installRecorder(void) {
  dispatch_async(dispatch_get_main_queue(),^{
    method_exchangeImplementations(class_getInstanceMethod(UIApplication.class,@selector(sendEvent:)),
      class_getInstanceMethod(UIApplication.class,@selector(response_sendEvent:)));
    static ResponseRecorder *recorder;
    recorder=[ResponseRecorder new];
    CADisplayLink *link=[CADisplayLink displayLinkWithTarget:recorder selector:@selector(frame:)];
    link.preferredFramesPerSecond=60;
    [link addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
  });
}

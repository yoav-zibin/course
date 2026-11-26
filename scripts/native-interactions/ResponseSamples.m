// Test dylib. Walk the simulator process's frame pointers during an input replay.
// Resolve symbols after resuming each thread so it cannot hold a loader lock.
#import <Foundation/Foundation.h>
#import <QuartzCore/QuartzCore.h>
#import <mach/mach.h>
#import <dlfcn.h>
#import <pthread.h>
#import <stdatomic.h>
#import <stdint.h>
#import <stdio.h>
#import <string.h>
#import <unistd.h>

static dispatch_semaphore_t wake;
static thread_t mainThread;
static _Atomic thread_t symbolThread;
static _Atomic uint64_t deadlineUS;
static uint64_t usec(void) {return (uint64_t)(CACurrentMediaTime()*1e6);}
static unsigned int stack(thread_t thread, uintptr_t *pcs, unsigned int limit) {
  uintptr_t fp=0,pc=0;
  if(thread_suspend(thread)!=KERN_SUCCESS)return 0;
#if defined(__arm64__)
  arm_thread_state64_t state;mach_msg_type_number_t count=ARM_THREAD_STATE64_COUNT;
  if(thread_get_state(thread,ARM_THREAD_STATE64,(thread_state_t)&state,&count)==KERN_SUCCESS){
    fp=arm_thread_state64_get_fp(state);pc=arm_thread_state64_get_pc(state);
  }
#else
  x86_thread_state64_t state;mach_msg_type_number_t count=x86_THREAD_STATE64_COUNT;
  if(thread_get_state(thread,x86_THREAD_STATE64,(thread_state_t)&state,&count)==KERN_SUCCESS){
    fp=state.__rbp;pc=state.__rip;
  }
#endif
  unsigned int n=0;if(pc)pcs[n++]=pc;
  while(fp && n<limit){
    uintptr_t frame[2];vm_size_t size=0;
    if(vm_read_overwrite(mach_task_self(),(vm_address_t)fp,sizeof(frame),(vm_address_t)frame,&size)!=KERN_SUCCESS||size!=sizeof(frame))break;
    if(!frame[1])break;
    pcs[n++]=frame[1]-1;
    if(frame[0]<=fp || frame[0]-fp>1048576 || frame[0]%sizeof(uintptr_t))break;
    fp=frame[0];
  }
  thread_resume(thread);return n;
}
typedef struct {
  double time;
  BOOL running;
  char name[128];
  unsigned int count;
  uintptr_t pcs[48];
} ResponseSample;

static void collect(NSMutableData *samples){
  thread_act_array_t threads;mach_msg_type_number_t count;
  if(task_threads(mach_task_self(),&threads,&count)!=KERN_SUCCESS)return;
  const thread_t self=pthread_mach_thread_np(pthread_self());
  const double t=CACurrentMediaTime()*1000;
  for(unsigned int i=0;i<count;i++){
    thread_t th=threads[i];thread_basic_info_data_t info;mach_msg_type_number_t size=THREAD_BASIC_INFO_COUNT;
    if(th!=self && th!=atomic_load(&symbolThread) && thread_info(th,THREAD_BASIC_INFO,(thread_info_t)&info,&size)==KERN_SUCCESS){
      ResponseSample sample={.time=t,.running=info.run_state==TH_STATE_RUNNING};
      pthread_t p=pthread_from_mach_thread_np(th);
      if(p)pthread_getname_np(p,sample.name,sizeof(sample.name));
      if(th==mainThread)strlcpy(sample.name,"main",sizeof(sample.name));
      if(th==mainThread || sample.running || strstr(sample.name,"JavaScript") || strstr(sample.name,"worklet")){
        sample.count=stack(th,sample.pcs,sizeof(sample.pcs)/sizeof(sample.pcs[0]));
        if(sample.count)[samples appendBytes:&sample length:sizeof(sample)];
      }
    }
    mach_port_deallocate(mach_task_self(),th);
  }
  vm_deallocate(mach_task_self(),(vm_address_t)threads,count*sizeof(thread_t));
}

static void writeSamples(NSData *data,FILE *out,NSMutableDictionary<NSNumber*,NSString*> *symbols){
  atomic_store(&symbolThread,pthread_mach_thread_np(pthread_self()));
  const ResponseSample *samples=data.bytes;
  for(NSUInteger i=0;i<data.length/sizeof(ResponseSample);i++){
    @autoreleasepool{
      const ResponseSample *sample=&samples[i];
      NSMutableArray *names=[NSMutableArray arrayWithCapacity:sample->count];
      for(unsigned int j=0;j<sample->count;j++){
        uintptr_t pc=sample->pcs[j];NSNumber *key=@(pc);NSString *symbol=symbols[key];
        if(!symbol){
          Dl_info image={0};dladdr((void*)pc,&image);
          NSString *library=image.dli_fname?[[NSString stringWithUTF8String:image.dli_fname] lastPathComponent]:@"unknown";
          symbol=image.dli_sname?[NSString stringWithFormat:@"%@ · %s",library,image.dli_sname]:
            [NSString stringWithFormat:@"%@ + 0x%lx",library,(unsigned long)(pc-(uintptr_t)image.dli_fbase)];
          if(symbol)symbols[key]=symbol;
        }
        [names addObject:symbol?:@"unknown"];
      }
      NSDictionary *row=@{@"t":@(sample->time),@"thread":sample->name[0]?[NSString stringWithUTF8String:sample->name]:@"worker",
                          @"running":@(sample->running),@"stack":names};
      NSData *bytes=[NSJSONSerialization dataWithJSONObject:row options:0 error:nil];
      fwrite(bytes.bytes,1,bytes.length,out);fputc('\n',out);
    }
  }
  fflush(out);
  atomic_store(&symbolThread,MACH_PORT_NULL);
}
void recordResponseStacks(void){
  if(!getenv("BUILDPLAY_RESPONSE_STACKS"))return;
  if(!wake){
    mainThread=pthread_mach_thread_np(pthread_self());
    wake=dispatch_semaphore_create(0);
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY,0),^{
      NSString *path=[NSSearchPathForDirectoriesInDomains(NSCachesDirectory,NSUserDomainMask,YES).firstObject stringByAppendingPathComponent:@"response-stacks.jsonl"];
      FILE *out=fopen(path.fileSystemRepresentation,"a");if(!out)return;
      NSMutableDictionary *symbols=[NSMutableDictionary dictionary];
      dispatch_queue_t writer=dispatch_queue_create("fun.buildplay.test.response-symbols",DISPATCH_QUEUE_SERIAL);
      for(;;){
        dispatch_semaphore_wait(wake,DISPATCH_TIME_FOREVER);
        @autoreleasepool{
          NSMutableData *samples=[NSMutableData data];
          while(usec()<atomic_load(&deadlineUS)){
            collect(samples);
            usleep(10000);
          }
          // Looking up previously unseen Hermes and UIKit symbols can take
          // hundreds of milliseconds. Keep that cost outside the gesture sampler.
          if(samples.length)dispatch_async(writer,^{writeSamples(samples,out,symbols);});
        }
      }
    });
  }
  atomic_store(&deadlineUS,usec()+850000);
  dispatch_semaphore_signal(wake);
}

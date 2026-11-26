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
#import <unistd.h>

static dispatch_semaphore_t wake;
static thread_t mainThread;
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
static void collect(FILE *out, NSMutableDictionary<NSNumber*,NSString*> *symbols){
  thread_act_array_t threads;mach_msg_type_number_t count;
  if(task_threads(mach_task_self(),&threads,&count)!=KERN_SUCCESS)return;
  const thread_t self=pthread_mach_thread_np(pthread_self());
  const double t=CACurrentMediaTime()*1000;
  for(unsigned int i=0;i<count;i++){
    thread_t th=threads[i];thread_basic_info_data_t info;mach_msg_type_number_t size=THREAD_BASIC_INFO_COUNT;
    if(th!=self && thread_info(th,THREAD_BASIC_INFO,(thread_info_t)&info,&size)==KERN_SUCCESS){
      pthread_t p=pthread_from_mach_thread_np(th);char name[128]={0};
      if(p)pthread_getname_np(p,name,sizeof(name));
      const BOOL main=th==mainThread;
      if(main || info.run_state==TH_STATE_RUNNING || strstr(name,"JavaScript") || strstr(name,"worklet")){
        uintptr_t pcs[48];unsigned int n=stack(th,pcs,48);
        if(n){
          NSMutableArray *names=[NSMutableArray arrayWithCapacity:n];
          for(unsigned int j=0;j<n;j++){
            uintptr_t pc=pcs[j];NSNumber *key=@(pc);NSString *symbol=symbols[key];
            if(!symbol){
              Dl_info image={0};dladdr((void*)pc,&image);
              NSString *library=image.dli_fname?[[NSString stringWithUTF8String:image.dli_fname] lastPathComponent]:@"unknown";
              symbol=image.dli_sname?[NSString stringWithFormat:@"%@ · %s",library,image.dli_sname]:
                [NSString stringWithFormat:@"%@ + 0x%lx",library,(unsigned long)(pc-(uintptr_t)image.dli_fbase)];
              if(symbol)symbols[key]=symbol;
            }
            [names addObject:symbol?:@"unknown"];
          }
          NSDictionary *row=@{@"t":@(t),@"thread":main?@"main":(name[0]?[NSString stringWithUTF8String:name]:@"worker"),
                              @"running":@(info.run_state==TH_STATE_RUNNING),@"stack":names};
          NSData *bytes=[NSJSONSerialization dataWithJSONObject:row options:0 error:nil];
          fwrite(bytes.bytes,1,bytes.length,out);fputc('\n',out);
        }
      }
    }
    mach_port_deallocate(mach_task_self(),th);
  }
  vm_deallocate(mach_task_self(),(vm_address_t)threads,count*sizeof(thread_t));
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
      for(;;){
        dispatch_semaphore_wait(wake,DISPATCH_TIME_FOREVER);
        while(usec()<atomic_load(&deadlineUS)){
          @autoreleasepool{collect(out,symbols);}
          usleep(10000);
        }
        fflush(out);
      }
    });
  }
  atomic_store(&deadlineUS,usec()+850000);
  dispatch_semaphore_signal(wake);
}

type Cancel=()=>void;
export type BugGestureProtectionResult={protected:boolean;attempts:number;reason:'protected'|'missing_view'|'not_ready'|'native_error'};
type Options={
  getTag:()=>number|null;
  protect:(tag:number)=>Promise<boolean>;
  onResult:(result:BugGestureProtectionResult)=>void;
  afterFrame:(callback:()=>void)=>Cancel;
  later:(callback:()=>void)=>Cancel;
};

/** Fabric can emit onLayout before its corresponding native mount completes. */
export function createBugGestureProtection({getTag,protect,onResult,afterFrame,later}:Options){
  let generation=0,disposed=false,cancel:Cancel=()=>{};
  const register=()=>{
    if(disposed)return;
    cancel();
    const current=++generation;
    const active=()=>!disposed&&current===generation;
    const attempt=async(count:number)=>{
      if(!active())return;
      const tag=getTag();
      let ready=false,reason:BugGestureProtectionResult['reason']='missing_view';
      if(tag!==null){
        try{ready=await protect(tag);reason=ready?'protected':'not_ready';}
        catch{reason='native_error';}
      }
      if(!active())return;
      // A Modal may replace its host while the native call is in flight.
      if(tag!==getTag()){ready=false;reason='missing_view';}
      if(ready||count===8){onResult({protected:ready,attempts:count,reason});return;}
      cancel=later(()=>{
        if(active())cancel=afterFrame(()=>{void attempt(count+1);});
      });
    };
    cancel=afterFrame(()=>{void attempt(1);});
  };
  return {register,dispose:()=>{disposed=true;++generation;cancel();}};
}

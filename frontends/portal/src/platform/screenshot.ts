import {Dimensions} from 'react-native';
import {createWorkletRuntime,runOnRuntimeAsync} from 'react-native-worklets';
import {captureRef,captureScreen} from 'react-native-view-shot';
import {nativeBugCaptureTarget} from '../ui/bugModal';

let worker: ReturnType<typeof createWorkletRuntime> | undefined;

function capturePlan(width:number,height:number) {
  'worklet';
  const scale=Math.min(1,1000/width,1400/height);
  return {
    size:{width:Math.round(width*scale),height:Math.round(height*scale)},
    qualities:[.65,.35,.15],
    maxLength:500000,
  };
}

let cached:{width:number;height:number;plan:Promise<ReturnType<typeof capturePlan>>}|undefined;
function planForWindow() {
  const {width,height}=Dimensions.get('window');
  if(cached?.width===width&&cached.height===height)return cached.plan;
  worker ??= createWorkletRuntime({name:'Bug screenshot',enableEventLoop:false});
  const plan=runOnRuntimeAsync(worker,capturePlan,width,height);
  cached={width,height,plan};
  void plan.catch(()=>{if(cached?.plan===plan)cached=undefined;});
  return plan;
}

// Prepare the worker and its capture settings before the first bug-button tap.
requestIdleCallback(()=>{void Promise.resolve().then(planForWindow).catch(()=>{});});

/** Capture the current native window before presenting the report modal. */
export async function captureBugScreenshot():Promise<string> {
  const {size,qualities,maxLength}=await planForWindow();
  for(const quality of qualities) {
    const options={format:'jpg' as const,quality,result:'data-uri' as const,...size};
    // Android RN Modal owns a separate Dialog window. Activity captureScreen
    // omits it, so capture the visible modal's native root when one is open.
    const target=nativeBugCaptureTarget();
    const image=await (target?captureRef(target as Parameters<typeof captureRef>[0],options):captureScreen(options));
    if(image.length<=maxLength)return image;
  }
  throw new Error('The screenshot is too large. You can still send the report.');
}

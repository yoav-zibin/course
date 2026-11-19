import {Dimensions} from 'react-native';
import {nativeBugCaptureTarget} from '../ui/bugModal';
import {captureRef,captureScreen} from 'react-native-view-shot';
/** Capture the current native window before presenting the report modal. */
export async function captureBugScreenshot():Promise<string> {
  const window=Dimensions.get('window'),scale=Math.min(1,1000/window.width,1400/window.height);
  const size={width:Math.round(window.width*scale),height:Math.round(window.height*scale)};
  for(const quality of [.65,.35,.15]) {
    const options={format:'jpg' as const,quality,result:'base64' as const,...size};
    // Android RN Modal owns a separate Dialog window. Activity captureScreen
    // omits it, so capture the visible modal's native root when one is open.
    const target=nativeBugCaptureTarget();
    const encoded=await (target?captureRef(target as Parameters<typeof captureRef>[0],options):captureScreen(options));
    const image=`data:image/jpeg;base64,${encoded}`;
    if(image.length<=500000)return image;
  }
  throw new Error('The screenshot is too large. You can still send the report.');
}

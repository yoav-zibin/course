import type {Point} from './types';

const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));

// Taper the grab/lift offset at both edges. This is continuous and monotonic,
// maps the whole physical canvas onto itself, and never makes an edge drop
// unreachable merely because the artwork normally floats above a finger.
function shifted(value:number,offset:number,extent:number):number {
  const inside=clamp(value,0,extent);
  const edge=Math.min(inside,extent-inside);
  return clamp(inside+offset*clamp(edge/Math.max(1,Math.abs(offset)*2),0,1),0,extent);
}

export function dragPosition(at:Point,grab:Point,size:{width:number;height:number},
                             canvas:{width:number;height:number},touch:boolean):Point {
  const lift=touch?Math.min(54,size.height*.6+22,canvas.height/3):0;
  return {x:shifted(at.x,grab.x,canvas.width),y:shifted(at.y,grab.y-lift,canvas.height)};
}

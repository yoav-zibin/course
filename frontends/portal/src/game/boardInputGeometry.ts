import {closestTarget, pieceContains, pieceGeometry, pieceHitOrder, targetGeometry} from './interactions';
import {dragPosition} from './dragPosition';
import type {GameSpec, Point, Scene} from './types';

export type BoardRect = Point & {width:number;height:number};
export type BoardCamera = {zoom:number;x:number;y:number};

export function boardInputGeometry(spec:GameSpec,scene:Scene,order:ReadonlyMap<string,number>,pressOutlines=false) {
  const targets=(scene.targets??[]).map(target=>{
    const geometry=targetGeometry(spec,target),{shape,box}=geometry;
    const path=shape?.kind==='line' ? `M ${shape.from.x} ${shape.from.y} L ${shape.to.x} ${shape.to.y}` :
      shape?.kind==='polygon' ? `M ${shape.points.map(p=>`${p.x} ${p.y}`).join(' L ')} Z` :
      `M ${box.x} ${box.y} h ${box.width} v ${box.height} h ${-box.width} Z`;
    return {...geometry,path,lineWidth:shape?.kind==='line'?shape.width:0};
  });
  const pieces=Object.fromEntries((scene.pieces??[]).filter(piece=>!piece.parent).map(piece=>{
    const geometry=pieceGeometry(spec,piece),{x,y}=geometry.center;
    const rx=geometry.size.width*geometry.scale/2,ry=geometry.size.height*geometry.scale/2;
    const corner=(dx:number,dy:number)=>`${x+dx*geometry.cos+dy*geometry.sin} ${y-dx*geometry.sin+dy*geometry.cos}`;
    const tapButton=!piece.move_targets?.length && piece.actions?.includes('tap');
    const outlined=tapButton || (pressOutlines && piece.move_targets?.length && geometry.shape==='image');
    const pressPath=!outlined?undefined:geometry.shape==='circle'||spec.piece_types[piece.type].action_outline==='ellipse'
      ?`M ${corner(-rx,0)} A ${rx} ${ry} ${piece.rotation??0} 1 0 ${corner(rx,0)} A ${rx} ${ry} ${piece.rotation??0} 1 0 ${corner(-rx,0)} Z`
      :`M ${corner(-rx,-ry)} L ${corner(rx,-ry)} L ${corner(rx,ry)} L ${corner(-rx,ry)} Z`;
    return [piece.id,{...geometry,pressPath,targets:targets.filter(target=>piece.move_targets?.includes(target.id))}];
  }));
  return {pieces,targets,hits:pieceHitOrder(scene,order).map(piece=>pieceGeometry(spec,piece))};
}

type Geometry=ReturnType<typeof boardInputGeometry>;
export type InputPiece=Geometry['pieces'][string];
export type InputTarget=Geometry['targets'][number];
export type Projection={width:number;height:number;scale:number;scaleX:number;scaleY:number;x:number;y:number;fill:boolean};

export function projectCanvas(width:number,height:number,view:BoardRect,fill=false):Projection {
  'worklet';
  const scale=Math.min(width/view.width,height/view.height);
  const scaleX=fill?width/view.width:scale,scaleY=fill?height/view.height:scale;
  return {width,height,scale,scaleX,scaleY,fill,
    x:fill?view.x:view.x-(width-view.width*scale)/(2*scale),
    y:fill?view.y:view.y-(height-view.height*scale)/(2*scale)};
}

export function scenePoint(canvas:Projection,point:Point):Point {
  'worklet';
  return {x:canvas.x+point.x/canvas.scaleX,y:canvas.y+point.y/canvas.scaleY};
}

export function boardHit(geometry:Geometry,point:Point,selected:string|null,selectionRequired:boolean) {
  'worklet';
  const hit=geometry.hits.find(piece=>pieceContains(piece,point));
  const piece=hit?geometry.pieces[hit.root]:undefined;
  const source=selected===null?undefined:geometry.pieces[selected];
  const target=closestTarget(source?.targets??(selectionRequired?[]:geometry.targets),point);
  return {piece,target};
}

export function projectPiece(canvas:Projection,at:Point,grab:Point,piece:InputPiece,touch:boolean) {
  'worklet';
  const {scale,scaleX,scaleY}=canvas;
  const lifted=dragPosition(at,grab,{width:piece.size.width*scaleX,height:piece.size.height*scaleY},canvas,touch);
  const point=scenePoint(canvas,lifted);
  const target=closestTarget(piece.targets,point,16/scale);
  const center=target?.center??point;
  return {target,x:center.x-piece.center.x,y:center.y-piece.center.y};
}

export function tapChoice(first:ReturnType<typeof boardHit>,last:ReturnType<typeof boardHit>,source:string|null) {
  'worklet';
  const target=last.target&&last.target.id===first.target?.id?last.target:undefined;
  if(target&&(!first.piece||source!==null))return {kind:'target' as const,id:target.id};
  if(first.piece&&first.piece.id===last.piece?.id)return {kind:'piece' as const,id:first.piece.id};
  if(target)return {kind:'target' as const,id:target.id};
}

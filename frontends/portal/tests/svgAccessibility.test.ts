import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {applyAccessibilityPatch,patch} from '../scripts/apply-svg-accessibility-patch.mjs';

type PatchFile={path:string;before_sha256:string;after_sha256:string;replacements:{before:string;after:string}[]};
const files=patch.files as PatchFile[],digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const installed=resolve(import.meta.dirname,'../node_modules/react-native-svg');
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'buildplay-svg-patch-'));
  writeFileSync(join(root,'package.json'),JSON.stringify({name:patch.package,version:patch.version}));
  for(const file of files){
    let source=readFileSync(join(installed,file.path),'utf8');
    if(digest(source)===file.after_sha256)for(const replacement of [...file.replacements].reverse())source=source.replace(replacement.after,replacement.before);
    assert.equal(digest(source),file.before_sha256,'fixture must reconstruct the published pinned source');
    mkdirSync(dirname(join(root,file.path)),{recursive:true});writeFileSync(join(root,file.path),source);
  }
  return root;
}

test('fresh pinned SVG installation applies all accessibility fixes and repeating it is harmless',()=>{
  const root=fixture();try{
    assert.equal(applyAccessibilityPatch(root),4);
    for(const file of files)assert.equal(digest(readFileSync(join(root,file.path),'utf8')),file.after_sha256);
    assert.equal(applyAccessibilityPatch(root),0);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('version drift and a modified later source fail before any earlier file is written',()=>{
  const root=fixture();try{
    writeFileSync(join(root,'package.json'),JSON.stringify({name:patch.package,version:'15.17.0'}));
    assert.throws(()=>applyAccessibilityPatch(root),/Review.*version/);
    writeFileSync(join(root,'package.json'),JSON.stringify({name:patch.package,version:patch.version}));
    const last=files.at(-1)!;writeFileSync(join(root,last.path),readFileSync(join(root,last.path),'utf8')+'\n// unknown upstream change\n');
    assert.throws(()=>applyAccessibilityPatch(root),/Unrecognized.*source/);
    for(const file of files.slice(0,-1))assert.equal(digest(readFileSync(join(root,file.path),'utf8')),file.before_sha256);
  }finally{rmSync(root,{recursive:true,force:true});}
});

type Matrix=[number,number,number,number,number,number];
const multiply=(a:Matrix,b:Matrix):Matrix=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
function rectangle(matrix:Matrix,box:number[]){
  const points=[[box[0],box[1]],[box[2],box[1]],[box[0],box[3]],[box[2],box[3]]].map(([x,y])=>[matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]]);
  return [Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
}
const near=(actual:number[],expected:number[])=>actual.forEach((value,index)=>assert.ok(Math.abs(value-expected[index])<.01,`${actual} differs from ${expected}`));

test('recorded Android cell bounds distinguish legacy local*parent from actual Canvas parent*local',()=>{
  // Actual 1080px device: density2.625, 600x560 viewport, board at24,100.
  // The screenshot places Cell1 at43,735; UIAutomator previously said118,872.
  const density=2.625,fit=1.8/density;
  const parent:Matrix=[fit,0,0,fit,0,555],local:Matrix=[1,0,0,1,(24+400/6)*density,(100+400/6)*density];
  const box=[-400/6*density,-400/6*density,400/6*density,400/6*density];
  near(rectangle(multiply(parent,local),box),[43.2,735,283.2,975]);
  const oldParent:Matrix=[fit,0,0,fit,0,0];
  const legacy=rectangle(multiply(local,oldParent),box);legacy[1]+=555;legacy[3]+=555;
  near(legacy,[118,872.5,358,1112.5]);
});

test('Canvas projection retains nested rotation and translated zoom rather than only correcting cell offsets',()=>{
  const viewport:Matrix=[2,0,0,2,10,20],group:Matrix=[1,0,0,1,30,40],rotation:Matrix=[0,1,-1,0,0,0];
  near(rectangle(multiply(multiply(viewport,group),rotation),[-5,-10,5,10]),[50,90,90,110]);
});

const W2=96,RB=7;
function rng(s){return function(){s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function blob(cx,cy,rx,ry,n,R,j){let p=[];for(let i=0;i<n;i++){let a=i/n*Math.PI*2;let k=1+(R()*2-1)*j;let k2=1+(R()*2-1)*j*0.5;p.push([cx+Math.cos(a)*rx*k,cy+Math.sin(a)*ry*k2]);}return p;}
function bar(cx,cy,len,th,ang){let dx=Math.cos(ang),dy=Math.sin(ang),nx=-dy,ny=dx,h=len/2,t=th/2;return [[cx-dx*h-nx*t,cy-dy*h-ny*t],[cx+dx*h-nx*t,cy+dy*h-ny*t],[cx+dx*h+nx*t,cy+dy*h+ny*t],[cx-dx*h+nx*t,cy-dy*h+ny*t]];}
function pip(p,poly){let ins=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){let xi=poly[i][0],yi=poly[i][1],xj=poly[j][0],yj=poly[j][1];if(((yi>p[1])!==(yj>p[1]))&&(p[0]<(xj-xi)*(p[1]-yi)/(yj-yi)+xi))ins=!ins;}return ins;}
function distPt(a,b){return Math.hypot(a[0]-b[0],a[1]-b[1]);}
function smooth(pts){let o=pts.slice();for(let k=0;k<1;k++){let n=[o[0],o[0]];for(let i=0;i<o.length-1;i++){let a=o[i],b=o[i+1];n.push([(a[0]*3+b[0])/4,(a[1]*3+b[1])/4],[(a[0]+b[0])/2,(a[1]+b[1])/2],[(a[0]+b[0]*3)/4,(a[1]+b[1]*3)/4]);}n.push(o[o.length-1],o[o.length-1]);o=n;}return o;}
function smLine(line){let o=line;for(let k=0;k<2;k++){let n=[o[0]];for(let i=1;i<o.length-1;i++){n.push([(o[i-1][0]+o[i][0]*2+o[i+1][0])/4,(o[i-1][1]+o[i][1]*2+o[i+1][1])/4]);}n.push(o[o.length-1]);o=n;}return o;}
function corridor(pts,w){let dirs=[];for(let i=0;i<pts.length;i++){let a=pts[Math.max(0,i-2)],b=pts[Math.min(pts.length-1,i+2)];let dx=b[0]-a[0],dy=b[1]-a[1];let l=Math.hypot(dx,dy)||1;dirs.push([dx/l,dy/l]);}
let sd=[];for(let i=0;i<dirs.length;i++){let x=0,y=0,c=0;for(let k=-2;k<=2;k++){let j=i+k;if(j<0||j>=dirs.length)continue;x+=dirs[j][0];y+=dirs[j][1];c++;}let l=Math.hypot(x,y)||1;sd.push([x/l,y/l]);}
let L=[],Rr=[];for(let i=0;i<pts.length;i++){let nx=-sd[i][1],ny=sd[i][0];L.push([pts[i][0]+nx*w/2,pts[i][1]+ny*w/2]);Rr.push([pts[i][0]-nx*w/2,pts[i][1]-ny*w/2]);}
L=smLine(L);Rr=smLine(Rr);return L.concat(Rr.reverse());}
function pathLength(pts){let L=0;for(let i=1;i<pts.length;i++)L+=distPt(pts[i-1],pts[i]);return L;}
function ptOnPath(pts,f){let T=pathLength(pts)*f,d=0;for(let i=1;i<pts.length;i++){let s=distPt(pts[i-1],pts[i]);if(d+s>=T){let k=(T-d)/(s||1);return [pts[i-1][0]+(pts[i][0]-pts[i-1][0])*k,pts[i-1][1]+(pts[i][1]-pts[i-1][1])*k];}d+=s;}return pts[pts.length-1].slice();}
function tanOnPath(pts,f){let a=ptOnPath(pts,Math.max(0,f-0.03)),b=ptOnPath(pts,Math.min(1,f+0.03));return Math.atan2(b[1]-a[1],b[0]-a[0]);}
function holePath(i,R){
 if(i===0)return [[80,200],[260,190],[430,210],[560,200]];
 if(i===1)return [[80,300],[300,300],[320,150],[560,150]];
 if(i===2){let m=110+R()*60;return [[80,120],[300,120],[300,260],[480,260],[480,140],[565,140]];}
 if(i===3){let y1=90+R()*40,y2=300+R()*30;return [[80,200],[170,y1],[360,y1],[360,y2],[520,y2],[565,y2]];}
 let y=100+R()*60;return [[80,320],[200,320],[200,y],[340,y],[340,300],[470,300],[470,150],[565,150]];
}
function holeDef(i){
 let R=rng(1000+i*777);
 let raw=holePath(i,R);
 let pts=smooth(raw);
 let w=W2-(i>=3?6:0);
 let fair=corridor(pts,w);
 let cup=ptOnPath(pts,0.97);
 let startA=ptOnPath(pts,0.02),startB=ptOnPath(pts,0.06);
 let walls=[];
 let nw=i===0?0:i===1?1:i===2?1:2;
 for(let k=0;k<nw;k++){let f=0.35+k*0.22+R()*0.08;let c=ptOnPath(pts,f);let tang=tanOnPath(pts,f);
  let side=R()<0.5?-1:1;let off=w*0.24;let cx=c[0]+Math.cos(tang+Math.PI/2)*off*side,cy=c[1]+Math.sin(tang+Math.PI/2)*off*side;
  let ang=tang+(R()-0.5)*0.5;let len=w*0.45+R()*w*0.2;
  walls.push(bar(cx,cy,len,18,ang));}
 let sands=[],ices=[];
 let ns=i===0?0:i>=3?2:1;
 for(let k=0;k<ns;k++){let c=ptOnPath(pts,0.3+R()*0.45);sands.push(blob(c[0],c[1],32+R()*14,24+R()*12,8,R,0.4));}
 let ni=i===0?0:(i===1?1:2);
 for(let k=0;k<ni;k++){let c=ptOnPath(pts,0.25+R()*0.5);ices.push(blob(c[0]+18,c[1]+8,28+R()*12,20+R()*10,8,R,0.35));}
 let port=null;
 if(i>=1&&(i===1||R()<0.8)){let pa=ptOnPath(pts,0.3+R()*0.15),pb=ptOnPath(pts,0.7+R()*0.15);port={a:{x:pa[0],y:pa[1],r:12},b:{x:pb[0],y:pb[1],r:12}};}
 return{par:i===0?2:(i===1?3:4),start:[startA,startB],cup,fair,pts,w,center:pts,walls,sands,ices,port};
}

function golfClosest(p,poly){let best=null,bd=Infinity;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],dx=b[0]-a[0],dy=b[1]-a[1],l=dx*dx+dy*dy;const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(l||1)));const q=[a[0]+dx*t,a[1]+dy*t],d=(p[0]-q[0])**2+(p[1]-q[1])**2;if(d<bd){bd=d;best=q;}}return {point:best,d:Math.sqrt(bd)};}
function golfReflect(v,nx,ny){const d=v[0]*nx+v[1]*ny;if(d<0){v[0]-=1.65*d*nx;v[1]-=1.65*d*ny;}}
function golfConstrain(p,v,d){
 if(!pip(p,d.fair)){const q=golfClosest(p,d.fair),dx=p[0]-q.point[0],dy=p[1]-q.point[1],len=Math.hypot(dx,dy)||1;p[0]=q.point[0]-dx/len*RB;p[1]=q.point[1]-dy/len*RB;golfReflect(v,-dx/len,-dy/len);}
 for(const w of d.walls){if(!w._bounds)w._bounds=[Math.min(...w.map(q=>q[0])),Math.min(...w.map(q=>q[1])),Math.max(...w.map(q=>q[0])),Math.max(...w.map(q=>q[1]))];const b=w._bounds;if(p[0]<b[0]-RB||p[0]>b[2]+RB||p[1]<b[1]-RB||p[1]>b[3]+RB)continue;const inside=pip(p,w),q=golfClosest(p,w);if(!inside&&q.d>=RB)continue;let dx=inside?q.point[0]-p[0]:p[0]-q.point[0],dy=inside?q.point[1]-p[1]:p[1]-q.point[1];let len=Math.hypot(dx,dy);if(len<1e-8){const cx=w.reduce((a,x)=>a+x[0],0)/w.length,cy=w.reduce((a,x)=>a+x[1],0)/w.length;dx=q.point[0]-cx;dy=q.point[1]-cy;len=Math.hypot(dx,dy)||1;}p[0]=q.point[0]+dx/len*(RB+0.001);p[1]=q.point[1]+dy/len*(RB+0.001);golfReflect(v,dx/len,dy/len);}
}
function golfPhysics(start,velocity,d){const p=start.slice(),v=velocity.slice(),frames=[start.slice()];let cooldown=0,sunk=false;
 for(let i=0;i<1800;i++){const sp=Math.hypot(v[0],v[1]);if(Math.hypot(p[0]-d.cup[0],p[1]-d.cup[1])<10&&sp<5.2){p[0]=d.cup[0];p[1]=d.cup[1];sunk=true;break;}if(sp<0.08)break;
  const n=Math.max(1,Math.ceil(sp/3));for(let k=0;k<n;k++){p[0]+=v[0]/n;p[1]+=v[1]/n;golfConstrain(p,v,d);}
  if(cooldown>0)cooldown--;if(d.port&&cooldown===0){for(const pair of [[d.port.a,d.port.b],[d.port.b,d.port.a]]){const a=pair[0],b=pair[1];if(Math.hypot(p[0]-a.x,p[1]-a.y)<a.r){const mag=Math.hypot(v[0],v[1])||1;p[0]=b.x+v[0]/mag*(b.r+RB+1);p[1]=b.y+v[1]/mag*(b.r+RB+1);cooldown=30;break;}}}
  let f=0.986;if(d.sands.some(q=>pip(p,q)))f=0.95;else if(d.ices.some(q=>pip(p,q)))f=0.9975;const drag=Math.pow(f,n);v[0]*=drag;v[1]*=drag;
  if(i%6===0)frames.push(p.slice());
 }
 // The client uses these authoritative positions; it performs no physics.
 const pos=p.map(x=>Math.round(x*1e6)/1e6);frames.push(pos.slice());const trace=frames.length<=80?frames:Array.from({length:80},(_,i)=>frames[Math.round(i*(frames.length-1)/79)]);return {pos,sunk,frames:trace};
}
const golfCourses={};
function golfCourse(h){if(!golfCourses[h])golfCourses[h]=holeDef(h);return golfCourses[h];}
const game={
HOLES:5,MAXS:8,
_holeInfo:function(h){return golfCourse(h);},
_holeStart:function(h,tot,hist){let info=this._holeInfo(h);return {hole:h,pos:[info.start[0].slice(),info.start[1].slice()],sunk:[false,false],cur:[0,0],tot:[tot[0],tot[1]],hist:[hist[0].slice(),hist[1].slice()],par:info.par};},
_seat:function(state,playerId,ctx){for(let i=0;i<ctx.players.length;i++)if(ctx.players[i].id===playerId)return i;return -1;},
_sim:function(start,vel,hole){return golfPhysics(start,vel,golfCourse(hole));},
_payouts:function(state,ctx){
 let pot=ctx.pot||0;let humans=[];for(let p of ctx.players)if(p.kind==='human')humans.push(p.id);
 let out={};for(let id of humans)out[id]=0;
 if(humans.length===0)return out;
 if(pot<=0)return out;
 let w=state.winner;
 let hIdx={};humans.forEach((id,i)=>hIdx[id]=i);
 if(w===-1||w===undefined||w===null){let share=Math.floor(pot/humans.length);let rem=pot-share*humans.length;humans.forEach((id,i)=>out[id]=share+(i<rem?1:0));return out;}
 let wpid=ctx.players[w]?ctx.players[w].id:null;
 if(wpid&&out.hasOwnProperty(wpid)){out[wpid]=pot;return out;}
 let share=Math.floor(pot/humans.length);let rem=pot-share*humans.length;humans.forEach((id,i)=>out[id]=share+(i<rem?1:0));return out;
},
newMatch:function(ctx){
 let st=this._holeStart(0,[0,0],[[],[]]);
 let first=ctx.players[0].id;
 return {state:st,turn:[first]};
},
applyMove:function(state,playerId,move,ctx){
 let seat=this._seat(state,playerId,ctx);
 if(seat<0)throw new InvalidMove('unknown player');
 if(state.winner!==undefined)throw new InvalidMove('match over');
 if(state.sunk[seat])throw new InvalidMove('already sunk');
 let turnIds=ctx._turnIds||null;
 if(turnIds&&turnIds.indexOf(playerId)<0)throw new InvalidMove('not your turn');
 if(!move||typeof move.vx!=='number'||typeof move.vy!=='number')throw new InvalidMove('bad move');
 let vx=move.vx,vy=move.vy;
 if(!isFinite(vx)||!isFinite(vy))throw new InvalidMove('bad velocity');
 let sp=Math.hypot(vx,vy);
 if(sp<0.4)throw new InvalidMove('too soft');
 if(sp>14){vx*=14/sp;vy*=14/sp;}
 let r=this._sim(state.pos[seat],[vx,vy],state.hole);
 let ns={hole:state.hole,pos:[[0,0],[0,0]],sunk:[state.sunk[0],state.sunk[1]],cur:[state.cur[0],state.cur[1]],tot:[state.tot[0],state.tot[1]],hist:[state.hist[0].slice(),state.hist[1].slice()],par:state.par};
 ns.pos[0]=state.pos[0].slice();ns.pos[1]=state.pos[1].slice();
 ns.pos[seat]=r.pos;ns.cur[seat]++;ns.lastShot={seat,hole:state.hole,frames:r.frames};
 let info=this._holeInfo(ns.hole);
 if(ns.cur[seat]>=this.MAXS&&!r.sunk){r.sunk=true;ns.pos[seat]=info.cup.slice();ns.lastShot.frames.push(ns.pos[seat].slice());}
 if(r.sunk)ns.sunk[seat]=true;
 if(ns.sunk[0]&&ns.sunk[1]){
  let tot=[ns.tot[0]+ns.cur[0],ns.tot[1]+ns.cur[1]];
  let hist=[ns.hist[0].concat(ns.cur[0]),ns.hist[1].concat(ns.cur[1])];
  if(ns.hole>=this.HOLES-1){
   ns.tot=tot;ns.hist=hist;ns.winner=tot[0]===tot[1]?-1:(tot[0]<tot[1]?0:1);
   return {state:ns,turn:null,payouts:this._payouts(ns,ctx)};
  } else {
   let nx=this._holeStart(ns.hole+1,tot,hist);
   let starter=(ns.hole+1)%2;
   if(starter>ctx.players.length-1)starter=0;
   return {state:nx,turn:[ctx.players[starter].id]};
  }
 }
 let o=1-seat;let next=ns.sunk[o]?seat:o;
 if(next>ctx.players.length-1)next=0;
 return {state:ns,turn:[ctx.players[next].id]};
},
computerMove:function(state,playerId,ctx){
 let seat=this._seat(state,playerId,ctx);if(seat<0)seat=0;
 let info=this._holeInfo(state.hole);
 let p=state.pos[seat];let dx=info.cup[0]-p[0],dy=info.cup[1]-p[1];
 let dist=Math.hypot(dx,dy)||1;let ang=Math.atan2(dy,dx)+(ctx.random()-0.5)*0.25;
 let pw=dist*0.055+1.5+ctx.random()*1.5;if(pw<2.5)pw=2.5+ctx.random();if(pw>12)pw=12;
 return {vx:Math.cos(ang)*pw,vy:Math.sin(ang)*pw};
},
randomMove:function(state,playerId,ctx){
 let a=ctx.random()*Math.PI*2;let pw=2+ctx.random()*10;
 return {vx:Math.cos(a)*pw,vy:Math.sin(a)*pw};
},
viewFor:function(state,playerId,ctx){
 return {hole:state.hole,pos:[[state.pos[0][0],state.pos[0][1]],[state.pos[1][0],state.pos[1][1]]],sunk:[state.sunk[0],state.sunk[1]],cur:[state.cur[0],state.cur[1]],tot:[state.tot[0],state.tot[1]],hist:[state.hist[0].slice(),state.hist[1].slice()],par:state.par,course:golfCourse(state.hole),lastShot:state.lastShot||null,winner:state.winner===undefined?null:state.winner};
}
};
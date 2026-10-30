'use strict';
const $=id=>document.getElementById(id);
const steps=['understanding','identity','logic','ui','images','tests'];
const titles=['Understand the game','Name & description','Game rules','Look & interaction','Images','Test examples'];
let draft=null, selected=0, working=false, poll=null, renderedRevision=null;
const me=()=>Auth.current();
const request=(method,path,body)=>apiRequest(method,path,{user:me(),...(body?{body}:{})});
function error(e){showPageError(e.message||String(e));}
async function loadDrafts(){
 if(!me()){$('draft-list').replaceChildren();return;}
 const drafts=await request('GET','/game-drafts');
 $('draft-list').replaceChildren(...drafts.map(d=>el('button',{textContent:d.name||'Untitled game',onclick:()=>select(d.id)})));
}
async function select(id){
 clearTimeout(poll);draft=await request('GET','/game-drafts/'+encodeURIComponent(id));
 if(!draft.builder_workflow)draft=await request('POST',`/game-drafts/${id}/workflow/initialize`,{expected_revision:draft.revision,language:$('language').value});
 location.hash=id;selected=Math.max(0,steps.findIndex(s=>draft.builder_workflow.artifacts[s]?.status!=='approved'));
 renderedRevision=null;render();schedule();
}
function schedule(){clearTimeout(poll);if(['queued','running'].includes(draft?.builder_workflow?.job?.status))poll=setTimeout(async()=>{try{draft=await request('GET','/game-drafts/'+draft.id);render();schedule();}catch(e){error(e);}},2000);}
async function act(action){
 if(!draft||working)return;
 working=true;render();showPageError('');$('busy').textContent=action==='propose'?'Preparing a proposal…':action==='final-approve'?'Translating approved specifications…':'Saving…';
 try{
  draft=await request('POST',`/game-drafts/${draft.id}/workflow/${action}`,{expected_revision:draft.revision,step:steps[selected],text:$('correction').value});
  if(action==='approve')selected=Math.min(5,selected+1);
  if(action==='propose')$('correction').value='';
  await loadDrafts();
 }catch(e){error(e);}finally{working=false;$('busy').textContent='';render();schedule();}
}
function preview(image){return el('figure',{},el('img',{src:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(image.svg),alt:image.caption}),el('figcaption',{textContent:image.caption}));}
function render(){
 $('intro').hidden=!!draft;$('workspace').hidden=!draft;if(!draft)return;
 const f=draft.builder_workflow, active=['queued','running'].includes(f.job?.status);
 document.documentElement.dir=f.language==='ar'?'rtl':'ltr';
 $('steps').replaceChildren(...steps.map((s,i)=>el('button',{'aria-current':i===selected?'step':null,textContent:`${i+1}. ${titles[i]} · ${f.artifacts[s]?.status||'Not started'}`,onclick:()=>{selected=i;render();}})));
 const step=steps[selected],artifact=f.artifacts[step];
 $('artifact-title').textContent=titles[selected];$('artifact-status').textContent=artifact?.status||'Not started';
 const content=$('artifact-content');content.replaceChildren();
 if(!artifact)content.append(el('p',{textContent:'Tell the assistant what you want, then review its proposal here.'}));
 else{
  const v=artifact.value;
  if(v.text)content.append(el('p',{textContent:v.text}));
  if(v.questions?.length)content.append(el('p',{textContent:'Please answer: '+v.questions.join('\n')}));
  if(v.display_name)content.append(el('h3',{textContent:v.display_name}),el('p',{textContent:v.short_description}));
  if(v.images)content.append(el('div',{class:'preview-grid'},v.images.map(preview)));
  if(v.cases)for(const test of v.cases)content.append(el('article',{class:'test-card'},el('h3',{textContent:test.name}),el('p',{textContent:test.description}),el('div',{class:'preview-grid'},test.images.map(preview))));
 }
 const allowed=steps.slice(0,selected).every(s=>f.artifacts[s]?.status==='approved');
 $('approve').disabled=working||active||!allowed||!artifact||artifact.status!=='draft'||!!artifact.value.questions?.length;
 $('reopen').disabled=working||active||!artifact||artifact.status!=='approved';
 $('propose').disabled=working||active||!allowed;
 if(renderedRevision!==draft.revision){
  $('conversation').replaceChildren(...f.conversation.map(m=>el('div',{class:'chat-message '+m.role},el('small',{textContent:m.role==='user'?'You':'Game assistant'}),m.text)));
  renderedRevision=draft.revision;
 }
 const all=steps.every(s=>f.artifacts[s]?.status==='approved');
 $('build-panel').hidden=!all&&!f.job;
 $('build').disabled=working||active||!all;$('cancel').disabled=working||!active;
 $('final-approve').disabled=working||f.job?.status!=='ready_for_review';$('publish').disabled=working||f.job?.status!=='ready';
 $('emulator').href='/builder#'+draft.id;
 $('build-status').textContent=f.job?`${f.job.stage}${f.job.error?' — '+f.job.error:''}`:'All specifications approved. Ready to build.';
 $('build-log').textContent=(f.job?.log||[]).join('\n');
 const shots=f.job?.screenshots||[];
 $('screenshots').replaceChildren(...shots.map(shot=>el('button',{textContent:`${shot.test} · ${shot.width}×${shot.height} · ${shot.direction} · ${shot.view}`,onclick:async()=>{
  try{const user=me();const response=await fetch(`/game-drafts/${draft.id}/workflow/images/${shot.file}`,{headers:{'X-User-Id':user.id,'X-User-Password':user.password}});if(!response.ok)throw Error('Image unavailable');const url=URL.createObjectURL(await response.blob());const modal=el('dialog',{},el('button',{textContent:'Close',onclick:()=>modal.close()}),el('img',{src:url,alt:shot.test,style:'max-width:90vw;max-height:80vh'}));modal.addEventListener('close',()=>{URL.revokeObjectURL(url);modal.remove();});document.body.append(modal);modal.showModal();}catch(e){error(e);}
 }})));
}
$('new-draft').onclick=async()=>{if(!me()){Auth.openDialog('login');return;}try{const d=await request('POST','/game-drafts',{name:'',description:'',allowed_player_counts:[2],code:''});await select(d.id);await loadDrafts();}catch(e){error(e);}};
$('chat-form').onsubmit=e=>{e.preventDefault();act('propose');};
for(const action of ['approve','reopen','build','cancel','final-approve'])$(action).onclick=()=>act(action);
$('publish').onclick=async()=>{try{const game=await request('POST',`/game-drafts/${draft.id}/publish`,{expected_revision:draft.revision});toast('Published '+game.name);await select(draft.id);}catch(e){error(e);}};
document.addEventListener('auth-changed',()=>{clearTimeout(poll);draft=null;render();Auth.renderMenu($('account-menu'));loadDrafts().catch(error);});
Auth.renderMenu($('account-menu'));loadDrafts().then(()=>{if(me()&&location.hash.length>1)return select(decodeURIComponent(location.hash.slice(1)));}).catch(error);

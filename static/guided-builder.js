'use strict';
const $=id=>document.getElementById(id);
const steps=['understanding','identity','logic','ui','tutorial','images','tests'];
const titles=['Understand the game','Name & description','Game rules','Look & interaction','Tutorial','Images','Test examples'];
let draft=null, selected=0, working=false, poll=null, renderedRevision=null;
const me=()=>Auth.current();
const request=(method,path,body)=>apiRequest(method,path,{user:me(),...(body?{body}:{})});
function error(e){showPageError(e.message||String(e));}
async function loadDrafts(){
 if(!me()){$('draft-list').replaceChildren();$('published-games').replaceChildren();return;}
 const user=me();
 const lists=(method,path)=>apiRequest(method,path,{user});
 const drafts=await StoragePages.list(lists,'/game-drafts',{user});
 if(me()?.id!==user.id)return;
 $('draft-list').replaceChildren(...drafts.map(d=>el('button',{textContent:d.name||'Untitled game',onclick:()=>select(d.id)})));
 StoragePages.controls('/game-drafts',user,$('draft-list'),loadDrafts);
 const games=await StoragePages.list(lists,'/builder/games',{user});
 if(me()?.id!==user.id)return;
 $('published-games').replaceChildren(...games.filter(game=>game.published).map(game=>el('button',{textContent:game.name,onclick:async()=>{
   try{const copy=await request('POST','/builder/games/'+encodeURIComponent(game.id)+'/open');await select(copy.id);await loadDrafts();}catch(e){error(e);}
 }})));
 StoragePages.controls('/builder/games',user,$('published-games'),loadDrafts);
}
async function select(id){
 clearTimeout(poll);draft=await request('GET','/game-drafts/'+encodeURIComponent(id));
 if(!draft.builder_workflow)draft=await request('POST',`/game-drafts/${id}/workflow/initialize`,{expected_revision:draft.revision,language:$('language').value});
 await recover();location.hash=id;selected=Math.max(0,steps.findIndex(s=>draft.builder_workflow.artifacts[s]?.status!=='approved'));
 const pending=draft.builder_workflow.pending_generation?.progress;
 $('correction').value=pending?.request_mode==='feedback'?'':pending?.request_text || '';
 $('emulator-feedback').value=pending?.request_mode==='feedback'?pending.request_text:'';
 renderedRevision=null;render();schedule();
}
async function recover(){
 const job=draft?.builder_workflow?.job;
 if(job && ['queued','running'].includes(job.status) && Date.now()/1000>job.deadline){
   draft=await request('POST','/game-drafts/'+draft.id+'/workflow/recover',{expected_revision:draft.revision});
 }
}
function schedule(){clearTimeout(poll);if(['queued','running'].includes(draft?.builder_workflow?.job?.status))poll=setTimeout(async()=>{try{draft=await request('GET','/game-drafts/'+draft.id);await recover();render();schedule();}catch(e){error(e);}},2000);}
async function act(action){
 if(!draft||working)return;
 working=true;render();showPageError('');$('busy').textContent=action==='propose'?'Preparing a proposal…':action==='final-approve'?'Translating approved specifications…':'Saving…';
 try{
  draft=await request('POST',`/game-drafts/${draft.id}/workflow/${action}`,{expected_revision:draft.revision,step:steps[selected],text:action==='feedback'?$('emulator-feedback').value:$('correction').value,channels:action==='build'?['sms','email'].filter(c=>$('notify-'+c).checked):[]});
  if(action==='refresh')selected=Math.max(0,steps.findIndex(s=>draft.builder_workflow.artifacts[s]?.status!=='approved'));
  if(action==='approve')selected=Math.min(steps.length-1,selected+1);
  if(action==='propose'||action==='feedback'){selected=steps.indexOf(draft.builder_workflow.review_step || steps[selected]);$('correction').value='';if(action==='feedback')$('emulator-feedback').value='';}
  await loadDrafts();
 }catch(e){error(e);try{draft=await request('GET','/game-drafts/'+draft.id);}catch{} }finally{working=false;$('busy').textContent='';render();schedule();}
}
function preview(image){return el('figure',{},el('img',{src:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(image.svg),alt:image.caption}),el('figcaption',{textContent:image.caption}));}
function artifactCard(value){
 const card=el('div',{class:'artifact-summary'});
 if(value.display_name)card.append(el('h4',{textContent:value.display_name}),el('p',{textContent:value.short_description}));
 if(value.text)card.append(el('p',{textContent:value.text,style:'white-space:pre-wrap'}));
 if(value.images)card.append(el('div',{class:'preview-grid'},value.images.map(preview)));
 if(value.cases)for(const test of value.cases)card.append(el('article',{},el('h4',{textContent:test.name}),el('p',{textContent:test.description}),el('div',{class:'preview-grid'},(test.images||[]).map(preview))));
 return card;
}
function changeReview(f,step,artifact){
 const host=$('artifact-changes');host.replaceChildren();
 const previous=[...f.history].reverse().find(h=>h.step===step && h.revision!==artifact?.revision && h.approved_digest);
 if(!previous || !artifact || JSON.stringify(previous.value)===JSON.stringify(artifact.value))return;
 host.append(el('details',{open:artifact.status==='draft'},el('summary',{textContent:'Changes since your last approval'}),
   el('section',{},el('h3',{textContent:'Before — approved'}),artifactCard(previous.value)),
   el('section',{},el('h3',{textContent:'After — proposed'}),artifactCard(artifact.value))));
}
function render(){
 $('intro').hidden=!!draft;$('workspace').hidden=!draft;if(!draft)return;
 const f=draft.builder_workflow, active=['queued','running'].includes(f.job?.status);
 $('budget').textContent='AI budget used or reserved: $'+((f.charged_microdollars || 0)/1000000).toFixed(2)+' of $10';
 document.documentElement.dir=f.language==='ar'?'rtl':'ltr';
 $('steps').replaceChildren(...steps.map((s,i)=>el('button',{'aria-current':i===selected?'step':null,textContent:`${[1,2,3,4,"4.5",5,6][i]}. ${titles[i]} · ${f.artifacts[s]?.status||'Not started'}`,onclick:()=>{selected=i;render();}})));
 const step=steps[selected],artifact=f.artifacts[step];
 $('artifact-title').textContent=titles[selected];$('artifact-status').textContent=artifact?.status||'Not started';
 const content=$('artifact-content');content.replaceChildren();
 if(!artifact)content.append(el('p',{textContent:'Tell the assistant what you want, then review its proposal here.'}));
 else{
  const v=artifact.value;
  if(v.text)content.append(el('p',{textContent:v.text}));
  if(v.questions?.length)content.append(el('p',{textContent:'Please answer: '+v.questions.join('\n')}));
  if(v.display_name)content.append(el('h3',{textContent:v.display_name}),el('p',{textContent:v.short_description}));
  if(v.html){
   const frame=el('iframe',{title:'Game tutorial',sandbox:'allow-scripts',referrerpolicy:'no-referrer',style:'width:100%;height:560px;border:1px solid #526075;border-radius:12px'});
   frame.srcdoc=`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">`+v.html;
   content.append(el('p',{textContent:'Preview at the selected width; scroll inside the preview for wider screens.'}),el('div',{class:'actions'},[360,820,1180].map(width=>el('button',{textContent:width+' px',onclick:()=>{frame.style.width=width+'px';frame.style.maxWidth='none';}}))),el('div',{style:'max-width:100%;overflow:auto'},frame));
  }
  if(v.images)content.append(el('div',{class:'preview-grid'},v.images.map(preview)));
  if(v.cases)for(const test of v.cases)content.append(el('article',{class:'test-card'},el('h3',{textContent:test.name}),el('p',{textContent:test.description}),el('div',{class:'preview-grid'},test.images.map(preview))));
 }
 changeReview(f,step,artifact);
 const allowed=steps.slice(0,selected).every(s=>f.artifacts[s]?.status==='approved');
 $('refresh').hidden=artifact?.status!=='stale'||!allowed; $('refresh').disabled=working||active;
 $('approve').disabled=working||active||!allowed||!artifact||artifact.status!=='draft'||!!artifact.value.questions?.length;
 $('reopen').disabled=working||active||!artifact||artifact.status!=='approved';
 $('propose').disabled=working||active||!allowed;
 if(renderedRevision!==draft.revision){
  $('conversation').replaceChildren(...f.conversation.map(m=>{
   const message=el('div',{class:'chat-message '+m.role},el('small',{textContent:m.role==='user'?'You':'Game assistant'}),m.text);
   if(m.artifact_revision){
    const current=f.artifacts[m.step];
    const approved=current?.revision===m.artifact_revision?current:f.history.find(h=>h.step===m.step && h.revision===m.artifact_revision);
    if(approved)message.append(el('details',{},el('summary',{textContent:titles[steps.indexOf(m.step)]+' · approved version '+m.artifact_revision}),artifactCard(approved.value)));
   }
   return message;
  }));
  renderedRevision=draft.revision;
 }
 const all=steps.every(s=>f.artifacts[s]?.status==='approved');
 $('build-panel').hidden=!all&&!f.job;
 $('feedback').disabled=working||active||!all||!f.job;
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
for(const action of ['approve','reopen','refresh','build','cancel','final-approve','feedback'])$(action).onclick=()=>act(action);
$('publish').onclick=async()=>{try{const game=await request('POST',`/game-drafts/${draft.id}/publish`,{expected_revision:draft.revision});toast('Published '+game.name);await select(draft.id);}catch(e){error(e);}};
document.addEventListener('auth-changed',()=>{clearTimeout(poll);draft=null;render();Auth.renderMenu($('account-menu'));loadDrafts().catch(error);});
Auth.renderMenu($('account-menu'));loadDrafts().then(()=>{if(me()&&location.hash.length>1)return select(decodeURIComponent(location.hash.slice(1)));}).catch(error);

request('GET','/i18n/locales').then(data=>{const picker=$('language');picker.replaceChildren(...data.locales.map(l=>el('option',{value:l.code,textContent:l.name})));picker.value=data.default;}).catch(()=>{});

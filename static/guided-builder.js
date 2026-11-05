'use strict';
const $=id=>document.getElementById(id);
const steps=['understanding','identity','logic','ui','tutorial','images','tests'];
const titles=['Understand the game','Name & description','Game rules','Look & interaction','Tutorial','Images','Test examples'];
const guidance={
 understanding:['What game do you want to make?','Describe the goal, who plays and what a player does on a turn.','For example: Two players take turns adding 1 or 2. The first to reach exactly 6 wins.','Draft game idea',''],
 identity:['Name your game and describe it in one sentence.','Use a suggested name or enter your own below.','For example: Race to 6 — take turns adding numbers to reach exactly six.','Suggest a name and description','Suggest a name and short description based on the approved game idea.'],
 logic:['Which rules should the game follow?','For a familiar game, use the usual rules. Add any house rules you want to change.','For example: Use normal rules, except the youngest player goes first.','Draft rules','Use the normal rules for this game, following the approved game idea and any agreed changes.'],
 ui:['How should the game look and feel?','Describe what players see and tap, or generate a layout from your rules.','For example: Show the total above two large move buttons.','Suggest a layout','Suggest a responsive layout and controls based on the approved rules.'],
 tutorial:['What should a new player practice?','Generate a short playable lesson from your rules, or describe a turn you want it to teach.','For example: Start one move before a win and let the learner try both choices.','Generate tutorial','Teach the goal and turn order with a short interactive exercise that demonstrates a legal move and how to win.'],
 images:['Which moments should the pictures show?','Generate a cover and game previews, or describe a scene to include.','For example: Show the first turn, a tricky move and the winning screen.','Generate images','Create a cover and start, middle and ending previews using the approved rules and layout.'],
 tests:['Which moves should we check?','Generate examples from the rules, or describe a move and the result you expect.','For example: At 5, only +1 is legal. Playing it ends the match.','Generate test examples','Create reproducible initial, intermediate and terminal examples using the approved rules.']
};
const draftName=d=>d.builder_workflow?.artifacts?.identity?.value?.display_name || d.name || 'Untitled game';
let editName=false;
if(window.matchMedia('(max-width:850px)').matches)$('library').open=false;
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
 $('draft-list').replaceChildren(...drafts.map(d=>el('button',{textContent:draftName(d),onclick:()=>select(d.id)})));
 StoragePages.controls('/game-drafts',user,$('draft-list'),loadDrafts);
 const games=await StoragePages.list(lists,'/builder/games',{user});
 if(me()?.id!==user.id)return;
 $('published-games').replaceChildren(...games.filter(game=>game.published).map(game=>el('button',{textContent:game.name,onclick:async()=>{
   try{const copy=await request('POST','/builder/games/'+encodeURIComponent(game.id)+'/open');await select(copy.id);await loadDrafts();}catch(e){error(e);}
 }})));
 StoragePages.controls('/builder/games',user,$('published-games'),loadDrafts);
}
async function select(id){
 editName=false;clearTimeout(poll);draft=await request('GET','/game-drafts/'+encodeURIComponent(id));
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
 const step=steps[selected], typed=$('correction').value.trim();
 const suggested=action==='propose' && !draft.builder_workflow.artifacts[step];
 const input=action==='feedback'?$('emulator-feedback').value:typed || (suggested?guidance[step][4]:'');
 const identityEdit=action==='edit-identity'?{display_name:$('game-name').value,short_description:$('game-description').value}:{};
 working=true;render();showPageError('');$('busy').textContent=action==='propose'?'Preparing a proposal…':action==='final-approve'?'Translating approved specifications…':'Saving…';
 try{
  draft=await request('POST',`/game-drafts/${draft.id}/workflow/${action}`,{expected_revision:draft.revision,step:steps[selected],text:input,...identityEdit,channels:action==='build'?['sms','email'].filter(c=>$('notify-'+c).checked):[]});
  if(action==='edit-identity'){editName=false;$('correction').value='';}
  if(action==='approve'){$('correction').value='';editName=false;}
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
 const step=steps[selected],artifact=f.artifacts[step], guide=guidance[step], questions=artifact?.value?.questions||[];
 const allowed=steps.slice(0,selected).every(s=>f.artifacts[s]?.status==='approved');
 const count=steps.filter(s=>f.artifacts[s]?.status==='approved').length;
 $('draft-title').textContent=draftName(draft);
 $('edit-title').disabled=working||active||f.artifacts.understanding?.status!=='approved';
 $('step-position').textContent='Step '+(selected+1)+' of '+steps.length;
 $('step-count').textContent=count+' of '+steps.length+' approved';
 $('progress').value=count;
 $('steps').replaceChildren(...steps.map((s,i)=>el('button',{'aria-current':i===selected?'step':null,disabled:working,
   title:titles[i]+' · '+(f.artifacts[s]?.status||'Not started'),textContent:(f.artifacts[s]?.status==='approved'?'✓ ':'')+['Idea','Name','Rules','Layout','Tutorial','Images','Tests'][i],
   onclick:()=>{if(i!==selected){$('correction').value='';editName=false;}selected=i;render();}})));
 $('step-guide').textContent=artifact?'':guide[1];
 $('prompt-label').textContent=questions.length?'Answer the questions below':artifact?'What would you like to change?':guide[0];
 $('questions').replaceChildren(...questions.map(q=>el('li',{textContent:q})));
 $('questions').hidden=!questions.length;
 $('correction').placeholder=questions.length?'Type your answers here…':artifact?'Describe your change…':guide[2];
 $('correction').required=!!questions.length||!!artifact||!guide[4];
 $('propose').textContent=questions.length?'Submit answers':artifact?'Request changes':guide[3];
 $('next-action').textContent=!allowed?'Approve '+titles[steps.findIndex(s=>f.artifacts[s]?.status!=='approved')]+' first.':questions.length?'Submit your answers to unlock approval.':artifact?.status==='stale'?'Refresh this step to check it against your changes.':artifact?.status==='draft'?'Review the proposal, then approve it or request changes.':'';
 $('manual-name').hidden=step!=='identity'||editName; $('manual-name').disabled=working||active||!allowed;
 $('name-form').hidden=!(step==='identity'&&allowed&&editName);
 $('name-form').querySelector('button').disabled=working||active;
 $('chat-form').hidden=editName&&step==='identity';
 $('artifact-title').textContent=titles[selected];$('artifact-status').textContent=artifact?.status||'Not started';
 const content=$('artifact-content');content.replaceChildren();
 if(artifact){
  const v=artifact.value;
  if(v.text)content.append(el('p',{textContent:v.text}));

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
 $('refresh').hidden=artifact?.status!=='stale'||!allowed; $('refresh').disabled=working||active;
 $('approve').disabled=editName||working||active||!allowed||!artifact||artifact.status!=='draft'||!!artifact.value.questions?.length;
 $('reopen').hidden=artifact?.status!=='approved';
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
$('edit-title').onclick=()=>{
 selected=steps.indexOf('identity');editName=true;
 const value=draft.builder_workflow.artifacts.identity?.value;
 $('game-name').value=value?.display_name||draft.name||'';
 $('game-description').value=value?.short_description||draft.description||'';
 render();$('game-name').focus();
};
$('manual-name').onclick=$('edit-title').onclick;
$('cancel-name').onclick=()=>{editName=false;render();};
$('name-form').onsubmit=e=>{e.preventDefault();act('edit-identity');};
$('chat-form').onsubmit=e=>{e.preventDefault();act('propose');};
for(const action of ['approve','reopen','refresh','build','cancel','final-approve','feedback'])$(action).onclick=()=>act(action);
$('publish').onclick=async()=>{try{const game=await request('POST',`/game-drafts/${draft.id}/publish`,{expected_revision:draft.revision});toast('Published '+game.name);await select(draft.id);}catch(e){error(e);}};
document.addEventListener('auth-changed',()=>{clearTimeout(poll);draft=null;render();Auth.renderMenu($('account-menu'));loadDrafts().catch(error);});
Auth.renderMenu($('account-menu'));loadDrafts().then(()=>{if(me()&&location.hash.length>1)return select(decodeURIComponent(location.hash.slice(1)));}).catch(error);

request('GET','/i18n/locales').then(data=>{const picker=$('language');picker.replaceChildren(...data.locales.map(l=>el('option',{value:l.code,textContent:l.name})));picker.value=data.default;}).catch(()=>{});

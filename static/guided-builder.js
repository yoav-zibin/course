'use strict';
const $=id=>document.getElementById(id);
const steps=['understanding','identity','logic','ui','tutorial','images','tests'];
const titles=()=>[I18n.t("ui.guided.title.understanding",{},"Understand the game"),I18n.t("ui.guided.title.identity",{},"Name & description"),I18n.t("ui.guided.title.logic",{},"Game rules"),I18n.t("ui.guided.title.ui",{},"Look & interaction"),I18n.t("ui.guided.title.tutorial",{},"Tutorial"),I18n.t("ui.guided.title.images",{},"Images"),I18n.t("ui.guided.title.tests",{},"Test examples")];
// The prompts sent to the AI when the person leaves the box empty stay in English (they are instructions, not page text).
const suggestions={understanding:"",identity:"Suggest a name and short description based on the approved game idea.",logic:"Use the normal rules for this game, following the approved game idea and any agreed changes.",ui:"Suggest a responsive layout and controls based on the approved rules.",tutorial:"Teach the goal and turn order with a short interactive exercise that demonstrates a legal move and how to win.",images:"Create a cover and start, middle and ending previews using the approved rules and layout.",tests:"Create reproducible initial, intermediate and terminal examples using the approved rules."};
const guidance=()=>({
 understanding:[I18n.t("ui.guided.prompt.understanding",{},"What game do you want to make? Describe the goal, who plays, and what a player does on a turn."),'',I18n.t("ui.guided.example.understanding",{},"For example: Two players take turns adding 1 or 2. The first to reach exactly 6 wins."),I18n.t("ui.guided.action.understanding",{},"Draft game idea")],
 identity:[I18n.t("ui.guided.prompt.identity",{},"Name your game and describe it in one sentence. You can use a suggestion or enter your own below."),'',I18n.t("ui.guided.example.identity",{},"For example: Race to 6 — take turns adding numbers to reach exactly six."),I18n.t("ui.guided.action.identity",{},"Suggest a name and description")],
 logic:[I18n.t("ui.guided.prompt.logic",{},"Which rules should the game follow? For a familiar game, say “normal rules” and add any house rules you want changed."),'',I18n.t("ui.guided.example.logic",{},"For example: Use normal rules, except the youngest player goes first."),I18n.t("ui.guided.action.logic",{},"Draft rules")],
 ui:[I18n.t("ui.guided.prompt.ui",{},"How should the game look and feel? Describe what players see and tap, or generate a layout from your rules."),'',I18n.t("ui.guided.example.ui",{},"For example: Show the total above two large move buttons."),I18n.t("ui.guided.action.ui",{},"Suggest a layout")],
 tutorial:[I18n.t("ui.guided.prompt.tutorial",{},"What should a new player practice? Generate a short playable lesson from your rules, or describe a turn you want it to teach."),'',I18n.t("ui.guided.example.tutorial",{},"For example: Start one move before a win and let the learner try both choices."),I18n.t("ui.guided.action.tutorial",{},"Generate tutorial")],
 images:[I18n.t("ui.guided.prompt.images",{},"Which moments should the pictures show? Describe a scene to include, or generate the set from your rules and layout."),I18n.t("ui.guided.hint.images",{},"You need 1 cover plus 3–5 preview images."),I18n.t("ui.guided.example.images",{},"For example: Show the first turn, a tricky move and the winning screen."),I18n.t("ui.guided.action.images",{},"Generate images")],
 tests:[I18n.t("ui.guided.prompt.tests",{},"Which moves should we check? Describe a move and the result you expect, or generate examples from the rules."),I18n.t("ui.guided.hint.tests",{},"You need 3–10 examples, covering starting, mid-game and ending positions."),I18n.t("ui.guided.example.tests",{},"For example: At 5, only +1 is legal. Playing it ends the match."),I18n.t("ui.guided.action.tests",{},"Generate test examples")],
});
const draftName=d=>d.builder_workflow?.artifacts?.identity?.value?.display_name || d.name || I18n.t("ui.builder.untitled",{},"Untitled game");
let editName=false;
if(window.matchMedia('(max-width:850px)').matches)$('library').open=false;
let draft=null, selected=0, working=false, poll=null, renderedRevision=null;
const matrixLink=el('a',{id:'game-test-matrix',href:'/game-test',target:'_blank',rel:'noopener',textContent:I18n.t("ui.guided.test_matrix",{},"Open game test matrix"),hidden:true});
$('emulator').after(matrixLink);
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
function nextStep(){
 const pending=steps.findIndex(s=>draft.builder_workflow.artifacts[s]?.status!=='approved');
 return pending===-1?steps.length:pending;
}
async function select(id){
 $('build-error').textContent='';editName=false;clearTimeout(poll);draft=await request('GET','/game-drafts/'+encodeURIComponent(id));
 if(!draft.builder_workflow)draft=await request('POST',`/game-drafts/${id}/workflow/initialize`,{expected_revision:draft.revision,language:$('language').value});
 await recover();location.hash=id;selected=nextStep();
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
 const input=action==='feedback'?$('emulator-feedback').value:typed || (suggested?suggestions[step]:'');
 const identityEdit=action==='edit-identity'?{display_name:$('game-name').value,short_description:$('game-description').value}:{};
 working=true;render();showPageError('');$('busy').textContent=action==='propose'?I18n.t("ui.guided.busy_proposal",{},"Preparing a proposal…"):action==='final-approve'?I18n.t("ui.guided.busy_translating",{},"Translating approved specifications…"):I18n.t("ui.builder.saving",{},"Saving…");
 if(action==='build'){
  $('build-error').textContent='';
  $('build-status').textContent=I18n.t("ui.guided.busy_build",{},"Requesting build…");
 }
 try{
  draft=await request('POST',`/game-drafts/${draft.id}/workflow/${action}`,{expected_revision:draft.revision,step:steps[selected],text:input,...identityEdit,channels:action==='build'?['sms','email'].filter(c=>$('notify-'+c).checked):[]});
  if(action==='edit-identity'){editName=false;$('correction').value='';}
  if(action==='approve'){$('correction').value='';editName=false;}
  if(action==='refresh')selected=nextStep();
  if(action==='approve')selected=Math.min(steps.length,selected+1);
  if(action==='propose'||action==='feedback'){const review=steps.indexOf(draft.builder_workflow.review_step);if(review>=0)selected=review;$('correction').value='';if(action==='feedback')$('emulator-feedback').value='';}
  await loadDrafts();
 }catch(e){
  if(action==='build'){
   const hint=/delivery and link/i.test(e.message)?' '+I18n.t("ui.guided.uncheck_hint",{},"Uncheck the notification and press Build again to continue without it."):'';
   $('build-error').textContent=e.message+hint;
  }else error(e);
  try{draft=await request('GET','/game-drafts/'+draft.id);}catch{} }finally{working=false;$('busy').textContent='';render();schedule();}
}
function preview(image){
 let svg=image.svg||'';
 // An SVG shown through an <img> only renders when its root declares the SVG
 // namespace, and only scales to fit with a viewBox; older generated images
 // may omit either, so add what is missing before encoding (the viewBox is
 // derived from the root's width/height). Without a viewBox the browser
 // shows a fixed corner of the drawing — usually just its background.
 if(svg.includes('<svg')){
  const opening=svg.split('>',1)[0];
  if(!opening.includes('xmlns'))svg=svg.replace('<svg','<svg xmlns="http://www.w3.org/2000/svg"');
  if(!opening.includes('viewBox')){
   const w=/\bwidth="(\d+(?:\.\d+)?)"/.exec(opening),h=/\bheight="(\d+(?:\.\d+)?)"/.exec(opening);
   if(w&&h)svg=svg.replace('<svg',`<svg viewBox="0 0 ${w[1]} ${h[1]}"`);
  }
 }
 const img=el('img',{src:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg),alt:image.caption});
 const figure=el('figure',{},img,el('figcaption',{textContent:image.caption}));
 img.addEventListener('error',()=>{img.replaceWith(el('div',{class:'preview-missing',textContent:I18n.t("ui.guided.preview_failed",{},"Preview could not be displayed — reopen this step and regenerate to redraw it.")}));},{once:true});
 return figure;
}
const kindLabels=()=>({initial:I18n.t("ui.guided.kind_initial",{},"Starting position"),intermediate:I18n.t("ui.guided.kind_intermediate",{},"Mid-game"),terminal:I18n.t("ui.guided.kind_terminal",{},"Ending")});
function testCard(test){
 const rejected=!!test.expected_error;
 const badge=rejected?I18n.t("ui.guided.must_be_rejected",{},"Must be rejected"):(kindLabels()[test.kind]||test.kind||I18n.t("ui.guided.kind_example",{},"Example"));
 const head=el('div',{class:'test-head'},el('h3',{textContent:test.name}),el('span',{class:'test-kind',textContent:badge}));
 const players=(test.ctx?.players||[]).map(p=>p.display_name||p.id).join(' '+I18n.t("ui.guided.vs",{},"vs")+' ');
 const meta=el('dl',{class:'test-meta'});
 const row=(label,value)=>{if(value!==undefined&&value!==null&&value!=='')meta.append(el('dt',{textContent:label}),el('dd',{textContent:String(value)}));};
 row(I18n.t("ui.guided.meta_players",{},"Players"),players);
 row(I18n.t("ui.guided.meta_move_number",{},"Move number"),test.ctx?.move_count);
 if(test.ctx?.pot)row(I18n.t("ui.guided.meta_pot",{},"Pot"),I18n.t("ui.stakes.tokens",{count:test.ctx.pot},"{count} tokens"));
 row(I18n.t("ui.guided.meta_move",{},"Move"),test.move?JSON.stringify(test.move):'');
 row(I18n.t("ui.guided.meta_expected",{},"Expected result"),rejected?I18n.t("ui.guided.rejected_as",{error:test.expected_error},"Rejected as {error}"):(test.expected_turn?I18n.t("ui.guided.play_continues",{players:test.expected_turn.join(', ')},"Play continues; next to move: {players}"):I18n.t("ui.guided.game_ends",{},"The game ends")));
 if(test.expected_payouts&&Object.keys(test.expected_payouts).length)row(I18n.t("ui.guided.meta_payouts",{},"Expected payouts"),Object.entries(test.expected_payouts).map(([id,n])=>id+': '+n).join(', '));
 const full=el('details',{class:'test-full'},el('summary',{textContent:I18n.t("ui.guided.full_data",{},"Full example data (JSON)")}),el('pre',{textContent:JSON.stringify(test,null,1)}));
 return el('article',{class:'test-card'},head,el('p',{class:'test-desc'},el('strong',{textContent:I18n.t("ui.guided.what_checks",{},"What this checks:")+' '}),test.description||''),meta,el('div',{class:'preview-grid'},(test.images||[]).map(preview)),full);
}
function artifactCard(value){
 const card=el('div',{class:'artifact-summary'});
 if(value.display_name)card.append(el('h4',{textContent:value.display_name}),el('p',{textContent:value.short_description}));
 if(value.text)card.append(el('p',{textContent:value.text,style:'white-space:pre-wrap'}));
 if(value.images)card.append(el('div',{class:'preview-grid'},value.images.map(preview)));
 if(value.cases)for(const test of value.cases)card.append(testCard(test));
 return card;
}
function changeReview(f,step,artifact){
 const host=$('artifact-changes');host.replaceChildren();
 const previous=[...f.history].reverse().find(h=>h.step===step && h.revision!==artifact?.revision && h.approved_digest);
 if(!previous || !artifact || JSON.stringify(previous.value)===JSON.stringify(artifact.value))return;
 host.append(el('details',{open:artifact.status==='draft'},el('summary',{textContent:I18n.t("ui.guided.changes_since",{},"Changes since your last approval")}),
   el('section',{},el('h3',{textContent:I18n.t("ui.guided.before_approved",{},"Before — approved")}),artifactCard(previous.value)),
   el('section',{},el('h3',{textContent:I18n.t("ui.guided.after_proposed",{},"After — proposed")}),artifactCard(artifact.value))));
}
const coverage=()=>({understanding:[I18n.t("ui.guided.cov.goal",{},"Game goal"),I18n.t("ui.guided.cov.who",{},"Who plays"),I18n.t("ui.guided.cov.turn",{},"What a player does on a turn")],identity:[I18n.t("ui.builder.game_name",{},"Game name"),I18n.t("ui.guided.cov.description",{},"One-sentence description")],logic:[I18n.t("ui.guided.cov.seats",{},"Seats & players"),I18n.t("ui.guided.cov.legal",{},"Legal moves"),I18n.t("ui.guided.cov.ends",{},"How it ends"),I18n.t("ui.guided.cov.computer",{},"Computer play")],ui:[I18n.t("ui.guided.cov.sees",{},"What players see"),I18n.t("ui.guided.cov.controls",{},"Controls"),I18n.t("ui.guided.cov.phone",{},"Phone layout")],tutorial:[I18n.t("ui.guided.cov.tut_goal",{},"The goal"),I18n.t("ui.guided.cov.tut_move",{},"A practiced move"),I18n.t("ui.guided.cov.tut_win",{},"How to win")],images:[I18n.t("ui.guided.cov.cover",{},"1 cover"),I18n.t("ui.guided.cov.previews",{},"3–5 previews")],tests:[I18n.t("ui.guided.cov.tests_count",{},"3–10 examples"),I18n.t("ui.guided.cov.tests_kinds",{},"Start, mid-game and end"),I18n.t("ui.guided.cov.tests_rejects",{},"Rejections as expected errors")]});
function renderArtifact(f,active){
 const step=steps[selected],artifact=f.artifacts[step], guide=guidance()[step], questions=artifact?.value?.questions||[];
 const allowed=steps.slice(0,selected).every(s=>f.artifacts[s]?.status==='approved');
 $('spec-panel').dataset.step=step;
 $('coverage-chips').replaceChildren(...(coverage()[step]||[]).map(t=>el('span',{class:'cov',textContent:t})));
 $('step-guide').textContent=artifact?'':guide[1];
 $('prompt-label').textContent=questions.length?I18n.t("ui.guided.answer_questions",{},"Answer the questions below"):artifact?I18n.t("ui.guided.what_change",{},"What would you like to change?"):guide[0];
 $('questions').replaceChildren(...questions.map(q=>el('li',{textContent:q})));
 $('questions').hidden=!questions.length;
 $('correction').placeholder=questions.length?I18n.t("ui.guided.type_answers",{},"Type your answers here…"):artifact?I18n.t("ui.guided.describe_change",{},"Describe your change…"):guide[2];
 $('correction').required=!!questions.length||!!artifact||!suggestions[step];
 $('propose').textContent=questions.length?I18n.t("ui.guided.submit_answers",{},"Submit answers"):artifact?I18n.t("ui.guided.request_changes",{},"Request changes"):guide[3];
 $('next-action').textContent=!allowed?I18n.t("ui.guided.approve_first",{title:titles()[steps.findIndex(s=>f.artifacts[s]?.status!=='approved')]},"Approve {title} first."):questions.length?I18n.t("ui.guided.hint_answers",{},"Submit your answers to unlock approval."):artifact?.status==='stale'?I18n.t("ui.guided.hint_stale",{},"Refresh this step to check it against your changes."):artifact?.status==='draft'?I18n.t("ui.guided.hint_draft",{},"Review the proposal: use “Approve and continue” if it looks right, or describe a change in the chat and press “Request changes”."):artifact?.status==='approved'?I18n.t("ui.guided.hint_approved",{},"This step is approved. “Reopen this step” is only for changing it — later steps will need a fresh review afterwards."):'';
 $('manual-name').hidden=step!=='identity'||editName; $('manual-name').disabled=working||active||!allowed;
 $('name-form').hidden=!(step==='identity'&&allowed&&editName);
 $('name-form').querySelector('button').disabled=working||active;
 $('chat-form').hidden=editName&&step==='identity';
 $('artifact-title').textContent=titles()[selected];$('artifact-status').textContent=artifact?({draft:I18n.t("ui.guided.status_draft",{},"draft"),approved:I18n.t("ui.guided.status_approved",{},"approved"),stale:I18n.t("ui.guided.status_stale",{},"needs refresh")}[artifact.status]||artifact.status):I18n.t("ui.guided.not_started",{},"Not started");
 const content=$('artifact-content');content.replaceChildren();
 if(artifact){
  const v=artifact.value;
  if(v.text)content.append(el('p',{textContent:v.text}));

  if(v.display_name)content.append(el('h3',{textContent:v.display_name}),el('p',{textContent:v.short_description}));
  if(v.html){
   const frame=el('iframe',{title:I18n.t("ui.portal.tutorial_title",{},"Game tutorial"),sandbox:'allow-scripts',referrerpolicy:'no-referrer',style:'width:100%;height:560px;border:1px solid #526075;border-radius:12px'});
   frame.srcdoc=`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">`+v.html;
   content.append(el('p',{textContent:I18n.t("ui.guided.preview_note",{},"Preview at the selected width; scroll inside the preview for wider screens.")}),el('div',{class:'actions'},[360,820,1180].map(width=>el('button',{textContent:I18n.t("ui.guided.px",{width},"{width} px"),onclick:()=>{frame.style.width=width+'px';frame.style.maxWidth='none';}}))),el('div',{style:'max-width:100%;overflow:auto'},frame));
  }
  if(v.images)content.append(el('div',{class:'preview-grid'},v.images.map(preview)));
  if(v.cases)for(const test of v.cases)content.append(testCard(test));
 }
 changeReview(f,step,artifact);
 $('refresh').hidden=artifact?.status!=='stale'||!allowed; $('refresh').disabled=working||active;
 $('approve').disabled=editName||working||active||!allowed||!artifact||artifact.status!=='draft'||!!artifact.value.questions?.length;
 $('reopen').hidden=artifact?.status!=='approved';
 $('reopen').disabled=working||active||!artifact||artifact.status!=='approved';
 $('propose').disabled=working||active||!allowed;
}
function render(){
 $('intro').hidden=!!draft;$('workspace').hidden=!draft;if(!draft)return;
 const f=draft.builder_workflow, active=['queued','running'].includes(f.job?.status);
 const money=value=>I18n.number(value,{style:'currency',currency:'USD'});
 $('budget').textContent=I18n.t("ui.guided.budget",{used:money((f.charged_microdollars || 0)/1000000),limit:money(10)},"AI budget used or reserved: {used} of {limit}");
 $('conversation').dir=$('artifact-content').dir=f.language==='ar'?'rtl':'ltr'; // the page itself follows the interface language
 const count=steps.filter(s=>f.artifacts[s]?.status==='approved').length;
 $('draft-title').textContent=draftName(draft);
 $('delete-draft').disabled=working||active;
 $('edit-title').disabled=working||active||f.artifacts.understanding?.status!=='approved';
 const labels=[I18n.t("ui.guided.label.understanding",{},"Idea"),I18n.t("ui.guided.label.identity",{},"Name"),I18n.t("ui.guided.label.logic",{},"Rules"),I18n.t("ui.guided.label.ui",{},"Layout"),I18n.t("ui.guided.label.tutorial",{},"Tutorial"),I18n.t("ui.guided.label.images",{},"Images"),I18n.t("ui.guided.label.tests",{},"Tests"),I18n.t("ui.guided.label.build",{},"Build & verify")];
 const buildView=selected===steps.length;
 const all=count===steps.length;
 $('step-position').textContent=I18n.t("ui.guided.step_position",{step:selected+1,total:labels.length},"Step {step} of {total}");
 $('steps').replaceChildren(...labels.map((label,i)=>{
  const build=i===steps.length;
  const done=build?f.job?.status==='ready':f.artifacts[steps[i]]?.status==='approved';
  return el('button',{'aria-current':i===selected?'step':null,class:done?'step-done':null,disabled:working||(build&&!all&&!f.job),
   title:build&&!all?I18n.t("ui.guided.locked_title",{},"Approve the specifications to unlock Build & verify"):label,
   textContent:label,onclick:()=>{if(i!==selected){$('correction').value='';editName=false;}selected=i;render();}});
 }));
 $('spec-panel').hidden=buildView;
 $('build-panel').hidden=!buildView;
 if(!buildView)renderArtifact(f,active);
 if(renderedRevision!==draft.revision){
  $('conversation').replaceChildren(...f.conversation.map(m=>{
   const message=el('div',{class:'chat-message '+m.role},el('small',{textContent:m.role==='user'?I18n.t("ui.guided.you",{},"You"):I18n.t("ui.guided.assistant",{},"Game assistant")}),m.text);
   if(m.artifact_revision){
    const current=f.artifacts[m.step];
    const approved=current?.revision===m.artifact_revision?current:f.history.find(h=>h.step===m.step && h.revision===m.artifact_revision);
    if(approved)message.append(el('details',{},el('summary',{textContent:I18n.t("ui.guided.approved_version",{title:titles()[steps.indexOf(m.step)],revision:m.artifact_revision},"{title} · approved version {revision}")}),artifactCard(approved.value)));
   }
   return message;
  }));
  renderedRevision=draft.revision;
 }

 $('feedback').disabled=working||active||!all||!f.job;
 $('build').disabled=working||active||!all;$('cancel').disabled=working||!active;
 $('final-approve').disabled=working||f.job?.status!=='ready_for_review';$('publish').disabled=working||f.job?.status!=='ready';
 const playable=['ready_for_review','ready'].includes(f.job?.status);
 $('emulator').hidden=!playable;
 if(playable)$('emulator').href='/static/builder.html'+location.search+'#'+encodeURIComponent(draft.id);
 else $('emulator').removeAttribute('href');
 matrixLink.hidden=!playable;
 if(playable)matrixLink.href='/game-test?draft='+encodeURIComponent(draft.id);
 $('build-status').textContent=f.job?`${f.job.stage}${f.job.error?' — '+f.job.error:''}`:$('build-error').textContent?'':I18n.t("ui.guided.ready_to_build",{},"All specifications approved. Ready to build.");
 $('build-log').textContent=(f.job?.log||[]).join('\n');
 const shots=f.job?.screenshots||[];
 $('screenshots').replaceChildren(...shots.map(shot=>el('button',{textContent:`${shot.test} · ${shot.width}×${shot.height} · ${shot.direction} · ${shot.view}`,onclick:async()=>{
  try{const user=me();const response=await fetch(`/game-drafts/${draft.id}/workflow/images/${shot.file}`,{headers:{'X-User-Id':user.id,'X-User-Password':user.password}});if(!response.ok)throw Error(I18n.t("ui.guided.image_unavailable",{},"Image unavailable"));const url=URL.createObjectURL(await response.blob());const modal=el('dialog',{},el('button',{textContent:I18n.t("ui.action.close",{},"Close"),onclick:()=>modal.close()}),el('img',{src:url,alt:shot.test,style:'max-width:90vw;max-height:80vh'}));modal.addEventListener('close',()=>{URL.revokeObjectURL(url);modal.remove();});document.body.append(modal);modal.showModal();}catch(e){error(e);}
 }})));
}
$('new-draft').onclick=async()=>{if(!me()){Auth.openDialog('login');return;}try{const d=await request('POST','/game-drafts',{name:'',description:'',allowed_player_counts:[2],code:''});await select(d.id);await loadDrafts();}catch(e){error(e);}};
$('delete-draft').onclick=async()=>{
 const target=draft;
 if(!target || working || !window.confirm(I18n.t("ui.guided.confirm_delete",{name:draftName(target)},"Delete the draft “{name}”? This cannot be undone.")))return;
 working=true;render();
 try{
  await request('DELETE','/game-drafts/'+encodeURIComponent(target.id));
  if(draft?.id===target.id){
   clearTimeout(poll);draft=null;
   history.replaceState(history.state,'',location.pathname+location.search);
   showPageError('');render();$('new-draft').focus();
  }
  await loadDrafts();
 }catch(e){error(e);}finally{working=false;render();}
};
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
$('publish').onclick=async()=>{try{const game=await request('POST',`/game-drafts/${draft.id}/publish`,{expected_revision:draft.revision});toast(I18n.t("ui.guided.published_toast",{name:game.name},"Published {name}"));await select(draft.id);}catch(e){error(e);}};
document.addEventListener('auth-changed',()=>{clearTimeout(poll);draft=null;render();Auth.renderMenu($('account-menu'));loadDrafts().catch(error);});
Auth.renderMenu($('account-menu'));loadDrafts().then(()=>{if(me()&&location.hash.length>1)return select(decodeURIComponent(location.hash.slice(1)));}).catch(error);

request('GET','/i18n/locales').then(data=>{const picker=$('language');picker.replaceChildren(...data.locales.map(l=>el('option',{value:l.code,textContent:l.name})));picker.value=typeof I18n.locale==='function'&&data.locales.some(l=>l.code===I18n.locale())?I18n.locale():data.default;}).catch(()=>{});
document.addEventListener('i18n-changed',()=>{matrixLink.textContent=I18n.t("ui.guided.test_matrix",{},"Open game test matrix");renderedRevision=null;render();loadDrafts().catch(error);});

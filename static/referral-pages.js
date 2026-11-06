"use strict";
// Query-mode referral snapshots: page through branches rather than downloading
// every account and recursively building the entire tree in the browser.
window.ReferralPages=(()=>{
  let supported, timer;
  const $=id=>document.getElementById(id);
  async function get(path){const response=await fetch(path);if(!response.ok)throw new Error(`${path}: ${response.status}`);return response.json();}
  async function enabled(){if(supported===undefined)supported=(await get('/storage/capabilities')).pagination===true;return supported;}
  const table=items=>el('table',{},el('thead',{},el('tr',{},[I18n.t("ui.invites.col_user", {}, "User"),I18n.t("ui.invites.col_total_invited", {}, "Total invited"),I18n.t("ui.invites.col_direct", {}, "Direct")].map(textContent=>el('th',{textContent})))),
    el('tbody',{},items.map(user=>el('tr',{},el('td',{},el('button',{type:'button',textContent:user.display_name,onclick:()=>detail(user).catch(fail)})),el('td',{textContent:user.total_invites}),el('td',{textContent:user.direct_invites})))));
  const summaryLabel=label=>({users:I18n.t("ui.invites.summary_users", {}, "users"),invited_users:I18n.t("ui.invites.summary_invited_users", {}, "invited users"),inviters:I18n.t("ui.invites.summary_inviters", {}, "inviters"),biggest_tree:I18n.t("ui.invites.summary_biggest_tree", {}, "biggest tree"),longest_chain:I18n.t("ui.invites.summary_longest_chain", {}, "longest chain"),cycles_broken:I18n.t("ui.invites.summary_cycles_broken", {}, "cycles broken")}[label]||label.replaceAll('_',' '));
  function fail(error){$('error').textContent=error.message;}
  async function listing(container, params){
    const history=[];let cursor=null;
    async function load(){
      const query=new URLSearchParams({...params,limit:'50'});if(cursor)query.set('cursor',cursor);
      const result=await get('/v2/admin/referrals/users?'+query);
      const back=el('button',{type:'button',textContent:I18n.t("ui.storage.previous_page", {}, "Previous page"),disabled:!history.length,onclick:()=>{cursor=history.pop();load().catch(fail);}});
      const next=el('button',{type:'button',textContent:I18n.t("ui.storage.next_page", {}, "Next page"),disabled:!result.next_cursor,onclick:()=>{history.push(cursor);cursor=result.next_cursor;load().catch(fail);}});
      container.replaceChildren(table(result.items),el('nav',{'aria-label':I18n.t("ui.invites.referral_pages_aria", {}, "Referral pages")},back,next));
    }
    await load();
  }
  async function detail(user){
    const children=el('div',{});
    $('detail').replaceChildren(el('h3',{textContent:user.display_name}),el('p',{textContent:I18n.t("ui.invites.totals_line", {total:user.total_invites,direct:user.direct_invites}, "{total} total invited; {direct} directly invited.")}),el('h4',{textContent:I18n.t("ui.invites.direct_invitees", {}, "Direct invitees")}),children);
    if(user.invited_by_user_id) $('detail').prepend(el('button',{type:'button',textContent:I18n.t("ui.invites.invited_by_name", {name:user.invited_by_name || user.invited_by_user_id}, "Invited by {name}"),onclick:async()=>{try{const result=await get('/v2/admin/referrals/users?'+new URLSearchParams({q:user.invited_by_user_id}));if(result.items[0])await detail(result.items[0]);}catch(error){fail(error);}}}));
    await listing(children,{parent_id:user.id});
  }
  async function refresh(){
    const result=await get('/v2/admin/referrals/summary');
    $('error').textContent='';
    $('freshness').textContent=I18n.t("ui.invites.report_built", {time:formatTime(result.generated_at)}, "Report built {time}");
    $('summary').replaceChildren(el('div',{class:'cards'},Object.entries(result.summary).map(([label,value])=>el('div',{class:'card'},el('div',{class:'value',textContent:value}),el('div',{textContent:summaryLabel(label)})))));
    $('search').placeholder=I18n.t("ui.invites.referral_search", {}, "Name prefix, full user ID, or referral code");
    $('search').setAttribute('aria-label',I18n.t("ui.invites.referral_search", {}, "Name prefix, full user ID, or referral code"));
    $('detail').replaceChildren();$('results').replaceChildren();
    await Promise.all([listing($('leaderboard'),{}),listing($('tree'),{parent_id:''})]);
  }
  function search(){clearTimeout(timer);timer=setTimeout(()=>{const q=$('search').value.trim();if(!q){$('results').replaceChildren();return;}listing($('results'),{q}).catch(fail);},250);}
  return {enabled,active:()=>supported===true,refresh,search};
})();

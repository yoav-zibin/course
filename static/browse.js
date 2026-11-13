// Browse page: users, games and matches, one bounded page at a time from the
// master-gated /v2/admin collections. (The old whole-dataset dump is gone:
// no response may hold the entire database.)

"use strict";

const AUTO_REFRESH_KEY = "game-platform.browse.auto-refresh";
const AUTO_REFRESH_MS = 2000;

const state = {
  pages: null,
  loadedAt: null,
};

const $ = (id) => document.getElementById(id);

async function refresh() {
  try {
    if (!(await StoragePages.enabled())) {
      throw new Error("the data browser needs paginated storage, which this deployment does not provide");
    }
    await refreshPagedBrowse();
    state.loadedAt = new Date();
    $("error").textContent = "";
  } catch (error) {
    $("error").textContent = I18n.t("ui.admin.load_failed", { message: error.message }, "Couldn't load data: {message}");
  }
  renderFreshness();
}

function renderFreshness() {
  $("freshness").textContent = state.loadedAt ? I18n.t("ui.admin.loaded", { time: formatTime(state.loadedAt.toISOString()) }, "Loaded {time}") : I18n.t("ui.state.loading", {}, "Loading…");
}

let autoRefreshTimer = null;
function setAutoRefresh(enabled) {
  localStorage.setItem(AUTO_REFRESH_KEY, enabled ? "1" : "");
  clearInterval(autoRefreshTimer);
  autoRefreshTimer = enabled ? setInterval(refresh, AUTO_REFRESH_MS) : null;
}

function main() {
  let filterTimer;
  $("filter").addEventListener("input",()=>{clearTimeout(filterTimer);filterTimer=setTimeout(refresh,250);});
  $("refresh").addEventListener("click", refresh);
  const autoRefresh = $("auto-refresh");
  autoRefresh.checked = Boolean(localStorage.getItem(AUTO_REFRESH_KEY));
  autoRefresh.addEventListener("change", () => setAutoRefresh(autoRefresh.checked));
  setAutoRefresh(autoRefresh.checked);
  renderFreshness();
  refresh();
}

main();

async function refreshPagedBrowse() {
  const mappings=[["users","users"],["games","games"],["matches","matches"]];
  state.pages ??= {};
  for (const [kind,id] of mappings) {
    const page=state.pages[kind] ??= {cursor:null,previous:[]};
    const response=await fetch(`/v2/admin/${kind}?limit=50${page.cursor?"&cursor="+encodeURIComponent(page.cursor):""}`);
    if(!response.ok)throw new Error(`Loading ${kind}: ${response.status}`);
    const result=await response.json();
    const filter=$("filter").value.toLocaleLowerCase();
    const rows=result.items.filter(x=>JSON.stringify(x).toLocaleLowerCase().includes(filter));
    const back=el("button",{textContent:I18n.t("ui.storage.previous_page", {}, "Previous page"),disabled:!page.previous.length,onclick:()=>{page.cursor=page.previous.pop();refresh();}});
    const next=el("button",{textContent:I18n.t("ui.storage.next_page", {}, "Next page"),disabled:!result.next_cursor,onclick:()=>{page.previous.push(page.cursor);page.cursor=result.next_cursor;refresh();}});
    $(id+"-count").textContent=`${rows.length} on this page`;
    $(id).replaceChildren(...rows.map(row=>{
      const detail=el("details",{},el("summary",{textContent:row.display_name||row.name||row.id||row.game_id}),el("pre",{textContent:JSON.stringify(row,null,2)}));
      return detail;
    }),back,next);
  }
}

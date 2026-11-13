"use strict";
// One page per query is retained. Polling refreshes that page, never the catalog.
window.StoragePages = (() => {
  let capabilities;
  // The in-flight capabilities fetch, so concurrent first calls (the three
  // catalog lists in one refresh) share one request instead of each firing
  // their own. Cleared on failure so a later call retries.
  let capabilitiesPromise;
  const entries = new Map();
  const supported = new Set(["/games", "/matches", "/matches/open"]);
  async function enabled() {
    if (capabilities !== undefined) return capabilities;
    if (!capabilitiesPromise) {
      capabilitiesPromise = (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);
        try {
          const response = await fetch("/storage/capabilities", {cache:"no-store",signal:controller.signal});
          capabilities = response.ok && (await response.json()).pagination === true;
        } catch {
          capabilitiesPromise = null;
          return false;
        } finally { clearTimeout(timer); }
        return capabilities;
      })();
    }
    return capabilitiesPromise;
  }
  function entry(path, user) {
    const key = path + "\n" + (user?.id || "");
    if (!entries.has(key)) entries.set(key, {cursor:null, previous:[], next:null, query:""});
    return entries.get(key);
  }
  async function list(request, path, {user} = {}) {
    if (!supported.has(path) || !await enabled()) return request("GET", path, {user});
    const page = entry(path, user), params = new URLSearchParams({limit:"50"});
    if (page.cursor) params.set("cursor", page.cursor);
    if (page.query && path === "/games") params.set("q", page.query);
    try {
      const result = await request("GET", "/v2" + path + "?" + params, {user});
      page.next = result.next_cursor;
      page.pending = null;
      return result.items;
    } catch(error) {
      if(page.pending) Object.assign(page,page.pending,{pending:null});
      throw error;
    }
  }
  function controls(path, user, container, refresh) {
    if (!capabilities || !container) return;
    const page = entry(path,user);
    let bar = container.nextElementSibling;
    if (!bar?.classList.contains("storage-pagination")) {
      bar = document.createElement("nav");
      bar.className = "storage-pagination";
      bar.setAttribute("aria-label", I18n.t("ui.storage.result_pages", {}, "Result pages"));
      bar.tabIndex = -1;
      container.after(bar);
    }
    if (!bar._pageControls) {
      bar._pageControls = [document.createElement("button"),document.createElement("button"),document.createElement("span")];
      const [back,next,label]=bar._pageControls;
      bar.replaceChildren(back,label,next);
    }
    const [back,next,label]=bar._pageControls;
    // A single page needs no pager at all: keep the bar out of the way until
    // there is somewhere to go (an earlier page or a next cursor).
    bar.hidden = !page.previous.length && !page.next;
    back.type = next.type = "button";
    back.textContent = I18n.t("ui.storage.previous_page", {}, "Previous page"); next.textContent = I18n.t("ui.storage.next_page", {}, "Next page");
    back.disabled = !page.previous.length; next.disabled = !page.next;
    label.textContent = " " + I18n.t("ui.storage.page_info", {page: page.previous.length + 1}, "Page " + (page.previous.length + 1) + " · up to 50 results") + " ";
    async function change(direction) {
      // Keep focus inside dropdowns while their buttons are disabled/refreshed.
      bar.focus({preventScroll:true});
      back.disabled = next.disabled = true;
      const before = {cursor:page.cursor,previous:[...page.previous]};
      page.pending = before;
      if (direction > 0) { page.previous.push(page.cursor); page.cursor = page.next; }
      else page.cursor = page.previous.pop();
      try { await refresh(); }
      catch (error) { Object.assign(page,before,{pending:null}); throw error; }
      finally { controls(path,user,container,refresh); }
    }
    back.onclick = () => change(-1).catch(console.error);
    next.onclick = () => change(1).catch(console.error);
  }
  function search(path,user,text) {
    const page = entry(path,user);
    const query = (text.toLocaleLowerCase().match(/[\p{L}\p{N}_]+/u)?.[0] || "").slice(0,24);
    const value = query.length >= 2 ? query : "";
    if (page.query === value) return false;
    page.query=value; page.cursor=null; page.previous=[]; page.next=null;
    return true;
  }
  return {enabled,list,controls,search};
})();

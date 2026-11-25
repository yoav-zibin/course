// Small, dependency-free recorder loaded before page scripts. Screenshots are
// loaded and captured only after a person opens the manual report form.
(function () {
  "use strict";
  if (window.SiteBugReporter?.active) return;
  const adminPage = document.currentScript?.dataset.admin === "true";
  const nativeFetch = window.fetch?.bind(window);
  const stamp = () => new Date().toISOString();
  const logs = [], apiCalls = [], events = [], pages = [];
  const secrets = new Set(), automaticSent = new Set(), telemetrySent = new Set(), drafts = new Map();
  let scope = null, sessionId = "", claimed = false, capture = null, capturePromise = null;
  let overlay = null, control = null, dialog = null, captureBusy = false, opened = 0;
  let position = {x: 1, y: 1};
  const topLevel = window.parent === window;
  const append = (list, value, limit) => {list.push(value); if (list.length > limit) list.splice(0, list.length - limit);};
  const t = (key, fallback, params = {}) => window.I18n?.t
    ? window.I18n.t(key, params, fallback)
    : fallback.replace(/\{(\w+)\}/g, (part, name) => name in params ? String(params[name]) : part);

  function identity() {
    try {for (const input of document.querySelectorAll('input[type="password"]')) if (input.value) secrets.add(input.value);} catch { /* Storage restrictions must not stop input redaction. */ }
    try {
      const stored = window.Auth?.accounts?.() || JSON.parse(localStorage.getItem("game-platform.accounts.v1") || "[]");
      const remembered = Array.isArray(stored) ? stored : [];
      for (const account of remembered) if (account?.password) secrets.add(account.password);
      if (adminPage) return null;
      return window.Auth?.current?.() || remembered.find(account => account.id === localStorage.getItem("game-platform.current-account.v1")) || null;
    } catch {return null;}
  }
  function syncScope() {
    const user = identity(), next = adminPage ? "admin-session" : user?.id || "visitor";
    if (scope !== next) {
      scope = next; sessionId = `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      for (const list of [logs, apiCalls, events, pages]) list.length = 0;
      if (dialog) closeDialog();
      append(pages, {at: stamp(), path: path(location.href)}, 30);
    }
    return user;
  }
  function path(value) {
    try {return new URL(String(value), location.href).pathname.replace(/(\/(?:invites|app-sessions)\/)\S+/g, "$1[redacted]");}
    catch {return "[URL]";}
  }
  function redact(value, maximum = 1400) {
    let text;
    try {text = value instanceof Error ? `${value.name}: ${value.message}\n${value.stack || ""}` : typeof value === "string" ? value : JSON.stringify(value, (key, child) => /password|passwd|secret|token|authorization|cookie|credential|api[_-]?key/i.test(key) ? "[redacted]" : child) ?? String(value);}
    catch {text = "[unserializable]";}
    for (const secret of secrets) if (secret) text = text.split(secret).join("[redacted]");
    return text.replace(/\b(?:authorization|proxy-authorization)["']?\s*[:=]\s*["']?(?:Bearer|Basic)\s+[^\s,;"'<>]+/gi, "[redacted]")
      .replace(/\b(?:password|passwd|passcode|secret|(?:access[_-]|refresh[_-]|id[_-])?token|authorization|cookie|code|api[_-]?key)\b["']?\s*[:=]\s*(["'])(.*?)\1/gi, "[redacted]")
      .replace(/\b(?:password|passwd|passcode|secret|(?:access[_-]|refresh[_-]|id[_-])?token|authorization|cookie|credential|code|api[_-]?key)\b["']?\s*[:=]\s*["']?[^\s,;&"'<>]+/gi, "[redacted]")
      .replace(/\b(?:bearer|basic)\s+[^\s,;&"'<>]+/gi, "[redacted]")
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted]")
      .replace(/https?:\/\/[^\s"'<>]+/g, raw => {try {return new URL(raw).origin + path(raw);} catch {return "[URL]";}})
      .slice(0, maximum);
  }
  function clean(value, depth = 0, budget = {left: 16000}) {
    if (budget.left <= 0) return "[truncated]";
    if (depth > 5) return "[nested]";
    if (typeof value === "string" || value instanceof Error) {
      const result = redact(value).slice(0, budget.left); budget.left -= result.length; return result;
    }
    if (Array.isArray(value)) return value.slice(0, 35).map(item => clean(item, depth + 1, budget));
    if (value && typeof value === "object") {
      const result = {};
      for (const [key, child] of Object.entries(value).slice(0, 35)) {
        if (budget.left <= 0) break;
        budget.left -= key.length;
        result[key] = /password|passwd|secret|token|authorization|cookie|credential|api[_-]?key/i.test(key) ? "[redacted]" : clean(child, depth + 1, budget);
      }
      return result;
    }
    return value;
  }
  function recordLog(level, ...values) {
    try {syncScope(); append(logs, {at: stamp(), level, message: values.map(value => redact(value)).join(" ").slice(0, 1800)}, 100);} catch { /* Recording cannot interrupt a page. */ }
  }
  function recordEvent(name, details) {
    try {syncScope(); append(events, {at: stamp(), name, ...(details ? {details: clean(details)} : {})}, 70);} catch { /* Best effort. */ }
  }
  function snapshot(context = {}) {
    const user = syncScope();
    const result = {version: 1, sessionId, capturedAt: stamp(), context: clean({platform: "web", path: path(location.href),
      user: user ? {id: user.id, displayName: user.display_name} : null, adminPage,
      viewport: {width: innerWidth, height: innerHeight}, online: navigator.onLine, userAgent: navigator.userAgent,
      webAssets: Array.from(document.scripts).filter(script => script.src).map(script => path(script.src)).slice(0, 25), ...context}),
      logs: logs.map(row => clean(row)), apiCalls: apiCalls.map(row => clean(row)), events: events.map(row => clean(row)), pages: pages.map(row => clean(row))};
    while (JSON.stringify(result).length * 3 > 160000) {
      const lists = [result.logs, result.apiCalls, result.events, result.pages].filter(list => list.length).sort((a, b) => b.length - a.length);
      if (!lists.length) {result.context = "[truncated]"; break;}
      lists[0].shift();
    }
    return result;
  }
  function headers() {
    const user = syncScope();
    return {"Content-Type": "application/json", ...(!adminPage && user?.id && user?.password ? {"X-User-Id": user.id, "X-User-Password": user.password} : {})};
  }
  function ownEndpoint(url) {return ["/bug-reports", "/client-errors"].includes(path(url));}
  function telemetry(kind, message, source) {
    if (!nativeFetch) return;
    const key = `${kind}:${message}`;
    if (telemetrySent.has(key) || telemetrySent.size >= 5) return;
    telemetrySent.add(key);
    try {void nativeFetch("/client-errors", {method: "POST", credentials: "same-origin", headers: {"Content-Type": "application/json"}, keepalive: true,
      body: JSON.stringify({kind, message: message.slice(0, 500), page: path(source || location.href), user_agent: navigator.userAgent})}).catch(() => {});} catch { /* Reporting failures stay silent. */ }
  }
  function reportIssue(kind, error, context = {}) {
    try {
      if (claimed || !/^[a-z][a-z0-9_]{0,31}$/.test(kind)) return;
      syncScope();
      const detail = {kind, message: redact(error?.message || error || kind),
        stack: redact(error?.stack || "", 4000), url: path(error?.url || context.url || location.href)};
      const key = `${scope}:${kind}:${detail.message}:${detail.url}`;
      if (automaticSent.has(key) || automaticSent.size >= 5) return;
      automaticSent.add(key); recordLog("error", detail.message, detail.stack);
      const diagnostics = snapshot(context); diagnostics.automatic_error = detail;
      if (!topLevel) {
        window.parent.postMessage({type: "buildplay-site-client-error-v1", error: detail, diagnostics}, location.origin);
        return;
      }
      telemetry(kind, detail.message, detail.url);
      if (!nativeFetch) return;
      const text = `Automatic client error (${kind}): ${detail.message}`;
      void nativeFetch("/bug-reports", {method: "POST", credentials: "same-origin", headers: headers(),
        body: JSON.stringify({text, automatic: true, screenshot: null, diagnostics})}).catch(() => {});
    } catch { /* Never display reporting UI for an unexpected exception. */ }
  }

  // Expose the handshake before other scripts execute. Portal's React reporter
  // takes over its own control and automatic reports after it mounts.
  window.SiteBugReporter = {active: true, recordLog, recordEvent, snapshot, reportIssue,
    rememberSecrets(values) {try {for (const value of values) if (typeof value === "string" && value) secrets.add(value);} catch { /* Redaction remains best effort. */ }},
    claimPortal() {claimed = true; if (overlay) overlay.remove(); if (dialog) closeDialog();},
    registerCapture(next) {capture = next;}, open: openReport};

  for (const level of ["debug", "log", "info", "warn", "error"]) {
    const previous = console[level];
    if (typeof previous !== "function") continue;
    console[level] = function (...args) {recordLog(level, ...args); return previous.apply(console, args);};
  }
  if (nativeFetch) window.fetch = function (input, options) {
    const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    if (ownEndpoint(url)) return nativeFetch(input, options);
    syncScope();
    const entry = {at: stamp(), method: String(options?.method || input?.method || "GET").toUpperCase(), path: path(url), state: "pending"};
    append(apiCalls, entry, 70); const start = Date.now();
    return nativeFetch(input, options).then(response => {
      Object.assign(entry, {status: response.status, durationMs: Date.now() - start, state: "complete"}); return response;
    }, error => {Object.assign(entry, {status: null, durationMs: Date.now() - start, state: "failed"}); recordLog("error", error); throw error;});
  };
  if (window.XMLHttpRequest) {
    const originalOpen = XMLHttpRequest.prototype.open, originalSend = XMLHttpRequest.prototype.send, pending = new WeakMap();
    XMLHttpRequest.prototype.open = function (method, url, ...args) {
      pending.set(this, ownEndpoint(url) ? null : {method: String(method).toUpperCase(), path: path(url)});
      return originalOpen.call(this, method, url, ...args);
    };
    XMLHttpRequest.prototype.send = function (...args) {
      const entry = pending.get(this);
      if (entry) {
        syncScope(); entry.at = stamp(); entry.state = "pending"; const start = Date.now(); append(apiCalls, entry, 70);
        this.addEventListener("loadend", () => Object.assign(entry, {status: this.status || null, durationMs: Date.now() - start, state: this.status ? "complete" : "failed"}), {once: true});
      }
      return originalSend.apply(this, args);
    };
  }
  window.addEventListener("error", event => {
    if (event instanceof ErrorEvent) reportIssue("script_error", {message: event.message, stack: event.error?.stack,
      url: event.filename}, {line: event.lineno, column: event.colno});
    else if (["SCRIPT", "LINK"].includes(event.target?.tagName)) reportIssue("resource_error", {message: path(event.target.src || event.target.href), url: event.target.src || event.target.href});
  }, true);
  window.addEventListener("unhandledrejection", event => reportIssue("unhandled_rejection", event.reason));
  window.addEventListener("message", event => {
    if (claimed || event.origin !== location.origin || !Array.from(window.frames).includes(event.source)) return;
    const data = event.data;
    if (data?.type !== "buildplay-site-client-error-v1" || typeof data.error?.message !== "string") return;
    reportIssue(data.error.kind, data.error, {frame: clean(data.diagnostics)});
  });
  document.addEventListener("auth-changed", syncScope);
  window.addEventListener("storage", syncScope);
  window.addEventListener("hashchange", () => {syncScope(); append(pages, {at: stamp(), path: path(location.href)}, 30);});
  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target.closest("button,a,[role=button]") : null;
    if (target) recordEvent("click", {tag: target.tagName, role: target.getAttribute("role"), label: target.getAttribute("aria-label") || target.getAttribute("data-testid")});
  }, true);

  function element(tag, attributes = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
      if (key === "class") node.className = value;
      else if (key.startsWith("aria-") || key.startsWith("data-")) node.setAttribute(key, value);
      else node[key] = value;
    }
    for (const child of children.flat()) if (child != null) node.append(child instanceof Node ? child : String(child));
    return node;
  }
  function place() {
    if (!overlay || claimed) return;
    const modals = Array.from(document.querySelectorAll("dialog[open]")).filter(node => {try {return node.matches(":modal");} catch {return true;}});
    const parent = modals[modals.length - 1] || document.fullscreenElement || document.body;
    if (overlay.parentElement !== parent) parent.appendChild(overlay);
    try {if (typeof overlay.showPopover === "function" && !overlay.matches(":popover-open")) overlay.showPopover();} catch { /* Transient DOM update. */ }
    const screen = window.visualViewport, width = screen?.width || innerWidth, height = screen?.height || innerHeight;
    control.style.left = `${(screen?.offsetLeft || 0) + 5 + position.x * Math.max(0, width - 46)}px`;
    control.style.top = `${(screen?.offsetTop || 0) + 2 + position.y * Math.max(0, height - 36)}px`;
  }
  function mount() {
    if (!topLevel || claimed || overlay) return;
    overlay = element("div", {id: "site-bug-overlay", popover: "manual", "data-bug-overlay": "true"});
    control = element("button", {type: "button", id: "site-bug-button", "data-testid": "bug-report-button",
      "aria-label": t("ui.site_bug.button", "Report a bug or request a feature"), title: t("ui.site_bug.button", "Report a bug or request a feature")});
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const [key, value] of Object.entries({width: "19", height: "19", viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true"})) svg.setAttribute(key, value);
    for (const [tag, attrs] of [["rect", {x: "7", y: "7", width: "10", height: "13", rx: "5"}], ["path", {d: "M9 7V5a3 3 0 0 1 6 0v2M12 8v11M3 9h4m10 0h4M2 14h5m10 0h5M4 20l4-3m8 0 4 3M8 3 6 1m10 2 2-2", "stroke-linecap": "round"}]]) {
      const shape = document.createElementNS(svg.namespaceURI, tag);
      for (const [key, value] of Object.entries({...attrs, stroke: "#c6f432", "stroke-width": "1.8"})) shape.setAttribute(key, value);
      svg.appendChild(shape);
    }
    control.append(svg); overlay.append(control);
    let drag = null, suppressClick = false;
    control.addEventListener("pointerdown", event => {
      if (!event.isPrimary || event.button !== 0) return;
      const box = control.getBoundingClientRect(); drag = {id: event.pointerId, x: event.clientX, y: event.clientY, left: box.left, top: box.top, moved: false};
      suppressClick = false; control.setPointerCapture(event.pointerId);
    });
    const move = event => {
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && dx * dx + dy * dy <= 25) return;
      drag.moved = true; suppressClick = true; event.preventDefault();
      const screen = window.visualViewport, width = screen?.width || innerWidth, height = screen?.height || innerHeight;
      position = {x: Math.max(0, Math.min(1, (drag.left + dx - (screen?.offsetLeft || 0) - 5) / Math.max(1, width - 46))),
        y: Math.max(0, Math.min(1, (drag.top + dy - (screen?.offsetTop || 0) - 2) / Math.max(1, height - 36)))}; place();
    };
    control.addEventListener("pointermove", move);
    control.addEventListener("pointerup", event => {
      if (!drag || drag.id !== event.pointerId) return;
      move(event); const moved = drag.moved; drag = null; suppressClick = true; event.preventDefault();
      if (control.hasPointerCapture(event.pointerId)) control.releasePointerCapture(event.pointerId);
      if (moved) recordEvent("bug_control_moved");
      else {const box = control.getBoundingClientRect(); if (event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom) void openReport();}
    });
    control.addEventListener("pointercancel", () => {drag = null; suppressClick = true;});
    control.addEventListener("pointercancel", () => {drag = null; suppressClick = true;});
    control.addEventListener("click", event => {if (suppressClick && event.detail !== 0) {suppressClick = false; return;} void openReport();});
    place();
    const observer = new MutationObserver(place); observer.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ["open"]});
    document.addEventListener("toggle", event => {if (event.target !== overlay) place();}, true);
    document.addEventListener("fullscreenchange", place); window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place); window.visualViewport?.addEventListener("scroll", place);
  }
  function loadCapture() {
    if (capture) return Promise.resolve(capture);
    if (capturePromise) return capturePromise;
    capturePromise = new Promise((resolve, reject) => {
      const script = element("script", {src: "/static/app/site-bug-capture.js?v=1"});
      script.onload = () => capture ? resolve(capture) : reject(new Error(t("ui.site_bug.capture_unavailable", "Screenshot unavailable. You can still send the report.")));
      script.onerror = () => reject(new Error(t("ui.site_bug.capture_unavailable", "Screenshot unavailable. You can still send the report.")));
      document.head.appendChild(script);
    }).catch(error => {capturePromise = null; throw error;});
    return capturePromise;
  }
  function closeDialog() {
    opened++;
    if (dialog) {try {dialog.close();} catch { /* Already closed. */ } dialog.remove(); dialog = null;}
    place(); control?.focus();
  }
  async function openReport() {
    if (claimed || !topLevel || captureBusy || dialog?.open) return;
    syncScope(); const capturedScope = scope; captureBusy = true; control?.setAttribute("aria-busy", "true");
    let screenshot = null, captureFailed = false, timer;
    try {screenshot = await Promise.race([loadCapture().then(fn => fn()), new Promise((_, reject) => {timer = setTimeout(() => reject(new Error(t("ui.site_bug.capture_unavailable", "Screenshot unavailable. You can still send the report."))), 8000);})]);}
    catch (error) {captureFailed = true; recordLog("warn", "screenshot_capture", error);}
    finally {clearTimeout(timer); captureBusy = false; control?.removeAttribute("aria-busy");}
    syncScope(); if (scope !== capturedScope || claimed) return;
    const current = ++opened, capturedAt = stamp();
    dialog = element("dialog", {class: "site-bug-dialog", "data-bug-overlay": "true", "aria-label": t("ui.site_bug.title", "Report a bug or feature request")});
    const title = element("h2", {textContent: t("ui.site_bug.title", "Report a bug or feature request")});
    const close = element("button", {type: "button", class: "site-bug-close", textContent: "×", "aria-label": t("ui.site_bug.close_dialog", "Close dialog")});
    close.addEventListener("click", closeDialog);
    const content = element("div", {class: "site-bug-content"});
    const text = element("textarea", {id: "site-bug-text", maxLength: 10000, rows: 5, value: drafts.get(scope) || ""});
    const send = element("button", {type: "button", class: "site-bug-send", textContent: t("ui.site_bug.send", "Send report")});
    const failure = element("p", {role: "alert", class: "site-bug-error", hidden: true});
    const ready = () => {send.disabled = text.value.trim().length < 5;};
    text.addEventListener("input", () => {drafts.set(capturedScope, text.value); ready();}); ready();
    content.append(element("p", {textContent: t("ui.site_bug.help", "Describe what happened, what you expected, or the feature you would like.")}));
    if (screenshot) content.append(element("img", {class: "site-bug-screenshot", src: screenshot, alt: t("ui.site_bug.screenshot_alt", "Screenshot captured before opening this report")}));
    if (captureFailed) content.append(element("p", {class: "site-bug-capture-note", textContent: t("ui.site_bug.capture_unavailable", "Screenshot unavailable. You can still send the report.")}));
    content.append(element("label", {htmlFor: text.id, textContent: t("ui.site_bug.field", "Bug or feature request")}), text, failure, send);
    send.addEventListener("click", async () => {
      if (send.disabled || !nativeFetch) return;
      syncScope(); if (scope !== capturedScope) return;
      const submittedText = text.value.trim(); send.disabled = true; send.textContent = t("ui.site_bug.sending", "Sending…"); failure.hidden = true;
      try {
        const response = await nativeFetch("/bug-reports", {method: "POST", credentials: "same-origin", headers: headers(),
          body: JSON.stringify({text: submittedText, screenshot, automatic: false, diagnostics: snapshot({screenshotCapturedAt: capturedAt})})});
        if (!response.ok) throw new Error(`report upload failed (${response.status})`);
        const report = await response.json();
        if ((drafts.get(capturedScope) || "").trim() === submittedText) drafts.delete(capturedScope);
        if (current !== opened || scope !== capturedScope || !dialog) return;
        const done = element("button", {type: "button", textContent: t("ui.action.close", "Close")}); done.addEventListener("click", closeDialog);
        content.replaceChildren(element("p", {role: "status", textContent: t("ui.site_bug.sent", "Thanks! Your report was sent.")}),
          element("p", {class: "site-bug-muted", textContent: t("ui.site_bug.report_id", "Report {id}", {id: report.id})}), done);
      } catch (error) {
        recordLog("warn", "bug_report_upload", error);
        if (current !== opened || scope !== capturedScope) return;
        failure.textContent = t("ui.site_bug.send_failed", "The report could not be sent. Your text is saved here; try again."); failure.hidden = false;
        send.textContent = t("ui.site_bug.send", "Send report"); ready();
      }
    });
    dialog.append(element("div", {class: "site-bug-heading"}, title, close), content);
    dialog.addEventListener("cancel", event => {event.preventDefault(); closeDialog();});
    (document.fullscreenElement || document.body).append(dialog); dialog.showModal(); text.focus(); place();
  }
  document.addEventListener("i18n-changed", () => {
    if (control) {control.setAttribute("aria-label", t("ui.site_bug.button", "Report a bug or request a feature")); control.title = t("ui.site_bug.button", "Report a bug or request a feature");}
  });
  syncScope();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, {once: true}); else mount();
})();

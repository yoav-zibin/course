'use strict';
// A small fake browser page for testing game clients without a browser: it parses the game's
// HTML, runs its scripts in a vm context, delivers `state_changed` messages and returns a
// snapshot of everything the player would read (text, aria-label, title, placeholder, ...).
// Used by community-games.test.cjs to compare an original game with its translatable version.
const fs = require('node:fs');
const vm = require('node:vm');

const VOID = new Set(['meta', 'link', 'br', 'hr', 'img', 'input', 'col', 'area', 'base', 'source', 'wbr']);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', times: '×', bull: '•', middot: '·', mdash: '—', ndash: '–', hellip: '…', larr: '←', rarr: '→', uarr: '↑', darr: '↓', copy: '©', check: '✓', hearts: '♥', spades: '♠', clubs: '♣', diams: '♦' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return e in ENTITIES ? ENTITIES[e] : m;
});
const escapeText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const kebab = (key) => (key === 'cssText' || key === 'setProperty' || key === 'removeProperty' ? key : key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()));

class TextNode {
  constructor(text) { this.nodeType = 3; this.data = text; this.parentNode = null; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
  get nodeValue() { return this.data; }
}

const REFLECT_BOOL = ['disabled', 'checked', 'hidden', 'selected', 'readOnly', 'required', 'open'];
const REFLECT_STR = ['title', 'placeholder', 'alt', 'src', 'href', 'type', 'name', 'lang', 'dir', 'role', 'htmlFor', 'draggable'];

class Element {
  constructor(tag, doc) {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.localName = tag.toLowerCase();
    this.ownerDocument = doc;
    this.attrs = {};
    this.childNodes = [];
    this.parentNode = null;
    this.listeners = {};
    this._style = {};
    this._value = undefined;
    const self = this;
    this.style = new Proxy(this._style, {
      get(target, key) {
        if (typeof key === 'string') key = kebab(key);
        if (key === 'setProperty') return (k, v) => { target[k] = String(v); };
        if (key === 'removeProperty') return (k) => { delete target[k]; };
        if (key === 'cssText') return Object.entries(target).map(([k, v]) => `${k}:${v}`).join(';');
        return target[key] ?? '';
      },
      set(target, key, value) { if (typeof key === 'string') key = kebab(key); if (key === 'cssText') { for (const k of Object.keys(target)) delete target[k]; } else if (value === '' || value == null) delete target[key]; else target[key] = String(value); return true; },
    });
    this.classList = {
      add: (...names) => { const set = this._classes(); names.forEach((n) => set.add(n)); this._setClasses(set); },
      remove: (...names) => { const set = this._classes(); names.forEach((n) => set.delete(n)); this._setClasses(set); },
      toggle: (name, force) => { const set = this._classes(); const on = force === undefined ? !set.has(name) : !!force; on ? set.add(name) : set.delete(name); this._setClasses(set); return on; },
      contains: (name) => this._classes().has(name),
      replace: (a, b) => { const set = this._classes(); if (set.delete(a)) set.add(b); this._setClasses(set); },
    };
    this.dataset = new Proxy({}, {
      get: (_, key) => this.attrs['data-' + String(key).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())],
      set: (_, key, value) => { this.attrs['data-' + String(key).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())] = String(value); return true; },
      has: (_, key) => ('data-' + String(key).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())) in this.attrs,
    });
    for (const name of REFLECT_BOOL) {
      Object.defineProperty(this, name, { get: () => name.toLowerCase() in this.attrs, set: (v) => { v ? (this.attrs[name.toLowerCase()] = '') : delete this.attrs[name.toLowerCase()]; }, enumerable: true });
    }
    for (const name of REFLECT_STR) {
      Object.defineProperty(this, name, { get: () => this.attrs[name === 'htmlFor' ? 'for' : name] ?? '', set: (v) => { this.attrs[name === 'htmlFor' ? 'for' : name] = String(v); }, enumerable: true });
    }
    this.focus = () => { doc.activeElement = this; };
    this.blur = () => {};
  }
  _classes() { return new Set((this.attrs.class || '').split(/\s+/).filter(Boolean)); }
  _setClasses(set) { if (set.size) this.attrs.class = [...set].join(' '); else delete this.attrs.class; }
  get className() { return this.attrs.class || ''; }
  set className(v) { if (v === '') delete this.attrs.class; else this.attrs.class = String(v); }
  get id() { return this.attrs.id || ''; }
  set id(v) { this.attrs.id = String(v); }
  get value() { if (this._value !== undefined) return this._value; if (this.localName === 'select') { const sel = this.querySelectorAll('option').find((o) => 'selected' in o.attrs) || this.querySelector('option'); return sel ? sel.value : ''; } return this.attrs.value ?? ''; }
  set value(v) { this._value = String(v); }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get firstElementChild() { return this.children[0] || null; }
  get parentElement() { return this.parentNode; }
  get nextSibling() { const i = this.parentNode ? this.parentNode.childNodes.indexOf(this) : -1; return i >= 0 ? this.parentNode.childNodes[i + 1] || null : null; }
  get isConnected() { return true; }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }
  set textContent(v) { this.childNodes.forEach((n) => { n.parentNode = null; }); const s = String(v ?? ''); this.childNodes = []; if (s !== '') this.appendChild(new TextNode(s)); }
  get innerText() { return this.textContent; }
  set innerText(v) { this.textContent = v; }
  get innerHTML() { return this.childNodes.map((n) => serialize(n)).join(''); }
  set innerHTML(html) { this.childNodes.forEach((n) => { n.parentNode = null; }); this.childNodes = []; parseInto(String(html), this, this.ownerDocument); }
  get outerHTML() { return serialize(this); }
  setAttribute(k, v) { if (k === 'style') { for (const key of Object.keys(this._style)) delete this._style[key]; for (const decl of String(v).split(';')) { const i = decl.indexOf(':'); if (i > 0) this._style[decl.slice(0, i).trim()] = decl.slice(i + 1).trim(); } return; } this.attrs[k] = String(v); }
  getAttribute(k) { if (k === 'style') return this.style.cssText || null; return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  toggleAttribute(k, force) { const on = force === undefined ? !(k in this.attrs) : !!force; on ? (this.attrs[k] = '') : delete this.attrs[k]; return on; }
  appendChild(node) { if (node.parentNode) node.parentNode.removeChild(node); node.parentNode = this; this.childNodes.push(node); return node; }
  append(...nodes) { nodes.forEach((n) => this.appendChild(typeof n === 'string' ? new TextNode(n) : n)); }
  prepend(...nodes) { nodes.reverse().forEach((n) => { const node = typeof n === 'string' ? new TextNode(n) : n; if (node.parentNode) node.parentNode.removeChild(node); node.parentNode = this; this.childNodes.unshift(node); }); }
  insertBefore(node, ref) { if (node.parentNode) node.parentNode.removeChild(node); node.parentNode = this; const i = ref ? this.childNodes.indexOf(ref) : -1; if (i < 0) this.childNodes.push(node); else this.childNodes.splice(i, 0, node); return node; }
  removeChild(node) { const i = this.childNodes.indexOf(node); if (i >= 0) this.childNodes.splice(i, 1); node.parentNode = null; return node; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceChildren(...nodes) { this.childNodes.forEach((n) => { n.parentNode = null; }); this.childNodes = []; this.append(...nodes); }
  replaceWith(...nodes) { const p = this.parentNode; if (!p) return; const i = p.childNodes.indexOf(this); p.childNodes.splice(i, 1, ...nodes.map((n) => { n.parentNode = p; return n; })); this.parentNode = null; }
  contains(node) { for (let n = node; n; n = n.parentNode) if (n === this) return true; return false; }
  cloneNode(deep) { const c = new Element(this.localName, this.ownerDocument); c.attrs = { ...this.attrs }; if (deep) this.childNodes.forEach((n) => c.appendChild(n.nodeType === 3 ? new TextNode(n.data) : n.cloneNode(true))); return c; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
  dispatchEvent(event) { event.target = event.target || this; event.currentTarget = this; const handler = this['on' + event.type]; if (typeof handler === 'function') handler.call(this, event); (this.listeners[event.type] || []).slice().forEach((f) => f.call(this, event)); return true; }
  click() { if (this.disabled) return; this.dispatchEvent({ type: 'click', target: this, preventDefault() {}, stopPropagation() {} }); }
  getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0 }; }
  scrollIntoView() {}
  scrollTo() {}
  getContext() { return this.ownerDocument._context(this); }
  showModal() { this.attrs.open = ''; }
  close() { delete this.attrs.open; }
  matches(sel) { return matchesSelector(this, sel); }
  closest(sel) { for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (matchesSelector(n, sel)) return n; return null; }
  querySelectorAll(sel) { const out = []; walk(this, (n) => { if (n !== this && matchesSelector(n, sel)) out.push(n); }); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  getElementsByTagName(tag) { return this.querySelectorAll(tag); }
  getElementsByClassName(cls) { return this.querySelectorAll('.' + cls); }
  get clientWidth() { return 400; }
  get clientHeight() { return 400; }
  get offsetWidth() { return 400; }
  get offsetHeight() { return 400; }
  get scrollHeight() { return 400; }
}
Object.defineProperty(Element.prototype, 'scrollTop', { get() { return this._scrollTop || 0; }, set(v) { this._scrollTop = v; } });

function walk(node, fn) { if (node.nodeType !== 1) return; fn(node); node.childNodes.forEach((c) => walk(c, fn)); }

function matchesSelector(el, selector) {
  return selector.split(',').some((part) => {
    const parts = part.trim().split(/\s+/);
    if (parts.length > 1) {
      if (!matchesSimple(el, parts[parts.length - 1])) return false;
      let anc = el.parentNode; let i = parts.length - 2;
      while (anc && anc.nodeType === 1 && i >= 0) { if (matchesSimple(anc, parts[i])) i -= 1; anc = anc.parentNode; }
      return i < 0;
    }
    return matchesSimple(el, parts[0]);
  });
}
function matchesSimple(el, simple) {
  const re = /(^[a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:([~^$*]?=)["']?([^"'\]]*)["']?)?\]|:(not)\(([^)]*)\)/g;
  let m; let any = false;
  while ((m = re.exec(simple))) {
    any = true;
    if (m[1] && el.localName !== m[1].toLowerCase()) return false;
    if (m[2] && el.attrs.id !== m[2]) return false;
    if (m[3] && !el._classes().has(m[3])) return false;
    if (m[4]) { const v = el.attrs[m[4]]; if (v === undefined) return false; if (m[5] === '=' && v !== m[6]) return false; }
    if (m[7] && matchesSimple(el, m[8])) return false;
  }
  return any || simple === '*';
}

function serialize(node) {
  if (node.nodeType === 3) return escapeText(node.data);
  const attrs = Object.entries(node.attrs).map(([k, v]) => ` ${k}="${String(v).replace(/"/g, '&quot;')}"`).join('');
  return `<${node.localName}${attrs}>${VOID.has(node.localName) ? '' : node.childNodes.map(serialize).join('') + `</${node.localName}>`}`;
}

function parseInto(html, parent, doc) {
  const stack = [parent];
  const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+|<)/gi;
  let m;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[1]) { const tag = m[1].toLowerCase(); for (let i = stack.length - 1; i > 0; i -= 1) if (stack[i].localName === tag) { stack.length = i; break; } continue; }
    if (m[2]) {
      const tag = m[2].toLowerCase();
      const el = doc.createElement(tag);
      let target = top;
      // Like a browser, put table rows made by innerHTML into a <tbody>.
      if (tag === 'tr' && top.localName === 'table') { target = top.children.find((c) => c.localName === 'tbody') || top.appendChild(doc.createElement('tbody')); }
      for (const a of m[3].matchAll(/([^\s=>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) el.setAttribute(a[1].toLowerCase(), decode(a[2] ?? a[3] ?? a[4] ?? ''));
      target.appendChild(el);
      if (tag === 'script' || tag === 'style') {
        const end = html.toLowerCase().indexOf('</' + tag, re.lastIndex);
        const raw = html.slice(re.lastIndex, end < 0 ? html.length : end);
        if (raw) el.appendChild(new TextNode(raw));
        re.lastIndex = end < 0 ? html.length : html.indexOf('>', end) + 1;
      } else if (!VOID.has(tag) && !m[4]) { if (target !== top) stack.push(target); stack.push(el); }
      continue;
    }
    if (m[5]) { if (/^\s+$/.test(m[5]) && top === parent && parent.localName === 'html') continue; top.appendChild(new TextNode(decode(m[5]))); }
  }
}

class Document {
  constructor() {
    this.documentElement = new Element('html', this);
    this.head = new Element('head', this);
    this.body = new Element('body', this);
    this.documentElement.append(this.head, this.body);
    this.activeElement = null;
    this.listeners = {};
    this.calls = [];
    this.canvasContexts = new Map();
  }
  createElement(tag) { return new Element(tag, this); }
  createElementNS(ns, tag) { return new Element(tag, this); }
  createTextNode(text) { return new TextNode(String(text)); }
  createDocumentFragment() { return new Element('#fragment', this); }
  getElementById(id) { let found = null; walk(this.documentElement, (n) => { if (!found && n.attrs.id === id) found = n; }); return found; }
  querySelector(sel) { return this.documentElement.querySelector(sel); }
  querySelectorAll(sel) { return this.documentElement.querySelectorAll(sel); }
  getElementsByTagName(tag) { return this.documentElement.querySelectorAll(tag); }
  getElementsByClassName(c) { return this.documentElement.querySelectorAll('.' + c); }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
  get title() { const t = this.head.querySelector('title'); return t ? t.textContent : ''; }
  set title(v) { let t = this.head.querySelector('title'); if (!t) { t = this.createElement('title'); this.head.appendChild(t); } t.textContent = v; }
  _context(canvas) {
    if (!this.canvasContexts.has(canvas)) {
      const calls = this.calls; const ctx = {};
      const fill = (name) => (...args) => { if (name === 'fillText' || name === 'strokeText') calls.push([name, ...args]); };
      this.canvasContexts.set(canvas, new Proxy(ctx, { get(t, k) { if (k in t) return t[k]; if (k === 'measureText') return (s) => ({ width: String(s).length * 6 }); if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} }); return fill(String(k)); }, set(t, k, v) { t[k] = v; return true; } }));
    }
    return this.canvasContexts.get(canvas);
  }
}

// Loads a game's HTML into a fake page. Returns helpers for the test.
function loadPage(htmlOrPath, options = {}) {
  const html = fs.existsSync(htmlOrPath) ? fs.readFileSync(htmlOrPath, 'utf8') : htmlOrPath;
  const doc = new Document();
  parseInto(html, doc.documentElement, doc);
  // The parser puts head and body children under <html>; move them to the head and body objects.
  const root = doc.documentElement;
  const realHtml = root.querySelector('html');
  if (realHtml) doc.documentElement = realHtml;
  const realHead = doc.documentElement.querySelector('head');
  const realBody = doc.documentElement.querySelector('body');
  if (realHead) doc.head = realHead;
  if (realBody) doc.body = realBody;
  const sent = [];
  const timers = new Map(); let timerId = 0;
  const listeners = {};
  const parent = { postMessage: (m) => sent.push(JSON.parse(JSON.stringify(m))) };
  const sandbox = {
    document: doc, parent, console, JSON, Math, Date, Object, Array, Set, Map, Promise, Number, String, Boolean, Error, RegExp, Symbol, parseInt, parseFloat, isNaN, isFinite, Infinity, NaN, undefined,
    Uint8Array, Float32Array, Int32Array, Uint32Array, ArrayBuffer,
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener: (type, fn) => { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
    setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; },
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, ms) => { timers.set(++timerId, { fn, ms, repeat: true }); return timerId; },
    clearInterval: (id) => timers.delete(id),
    requestAnimationFrame: (fn) => { timers.set(++timerId, { fn, ms: 16 }); return timerId; },
    cancelAnimationFrame: (id) => timers.delete(id),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    navigator: { language: 'en', vibrate() {}, clipboard: { writeText: () => Promise.resolve() } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    innerWidth: 800, innerHeight: 600, devicePixelRatio: 1,
    performance: { now: () => Date.now() },
    ResizeObserver: class { observe() {} disconnect() {} },
    Audio: class { play() { return Promise.resolve(); } },
    AudioContext: class { constructor() { this.destination = {}; } createOscillator() { return { connect() {}, start() {}, stop() {}, frequency: {}, type: '' }; } createGain() { return { connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, value: 0 } }; } },
    ...(options.globals || {}),
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.top = parent;
  sandbox.window.parent = parent;
  vm.createContext(sandbox);
  for (const script of doc.documentElement.querySelectorAll('script')) {
    const type = script.attrs.type;
    if (type && !/javascript|module/i.test(type)) continue;
    vm.runInContext(script.textContent, sandbox, { filename: 'game-script.js' });
  }
  const page = {
    doc, sent, sandbox, timers, parent,
    $: (id) => doc.getElementById(id),
    send(message) { const event = { source: parent, data: JSON.parse(JSON.stringify(message)) }; (listeners.message || []).slice().forEach((f) => f(event)); },
    fire(type, event = {}) { (listeners[type] || []).slice().forEach((f) => f({ preventDefault() {}, stopPropagation() {}, ...event })); },
    runTimers(limit = 50) { for (let i = 0; i < limit && timers.size; i += 1) { const [id, t] = [...timers][0]; if (!t.repeat) timers.delete(id); else timers.delete(id); t.fn(); } },
    // Everything a player would read: text nodes, and the text-bearing attributes. Layout-neutral.
    snapshot() { return snapshotOf(doc); },
    texts() { return textsOf(doc); },
  };
  return page;
}

const TEXT_ATTRS = ['aria-label', 'title', 'placeholder', 'alt', 'value', 'aria-valuetext', 'lang', 'dir'];
function snapshotOf(doc) {
  const lines = [`title: ${doc.title}`];
  const visit = (node, depth) => {
    if (node.nodeType === 3) { if (node.data.trim()) lines.push(`${'  '.repeat(depth)}"${node.data}"`); return; }
    if (['script', 'style'].includes(node.localName) && node.attrs.id !== undefined && false) return;
    if (['script', 'style', 'title'].includes(node.localName)) return;
    const attrs = Object.entries(node.attrs).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ');
    const style = Object.entries(node._style).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}:${v}`).join(';');
    lines.push(`${'  '.repeat(depth)}<${node.localName}${attrs ? ' ' + attrs : ''}${style ? ' style=' + JSON.stringify(style) : ''}${node._value !== undefined ? ' .value=' + JSON.stringify(node._value) : ''}>`);
    node.childNodes.forEach((c) => visit(c, depth + 1));
  };
  visit(doc.body, 0);
  for (const call of doc.calls) lines.push(`canvas ${JSON.stringify(call)}`);
  return lines.join('\n');
}
// The reader-visible strings only: text nodes (trimmed, non-empty) and the TEXT_ATTRS values.
function textsOf(doc) {
  const out = [doc.title].filter(Boolean);
  const visit = (node) => {
    if (node.nodeType === 3) { const s = node.data.trim(); if (s) out.push(s); return; }
    if (['script', 'style', 'title'].includes(node.localName)) return;
    for (const a of ['aria-label', 'title', 'placeholder', 'alt', 'aria-valuetext']) if (node.attrs[a]) out.push(node.attrs[a]);
    node.childNodes.forEach(visit);
  };
  visit(doc.body);
  for (const call of doc.calls) if (typeof call[1] === 'string') out.push(call[1]);
  return out;
}

module.exports = { loadPage, Document, Element, TextNode };

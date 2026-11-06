// Loads a built-in game page for the Node tests: the page's own script (not the
// `i18n-strings` JSON block) plus a `document` that can serve that block to the translation helper.
const fs = require('node:fs');
const STRINGS = /<script type="application\/json" id="i18n-strings">([\s\S]*?)<\/script>/;
const SCRIPT = /<script(?![^>]*application\/json)[^>]*>([\s\S]*?)<\/script>/;

// The page's strings block as an object ({} when the page has none).
function stringsOf(html) {
  const match = html.match(STRINGS);
  return match ? JSON.parse(match[1]) : {};
}

// The code of the page's script. `document` (a test's fake) gets the strings block added.
function pageScript(html, document) {
  const match = html.match(STRINGS);
  if (document && match) {
    const original = document.getElementById.bind(document);
    document.getElementById = (id) => (id === 'i18n-strings' ? { textContent: match[1] } : original(id));
    if (!document.documentElement) document.documentElement = {};
  }
  return html.match(SCRIPT)[1];
}

function pageScriptOf(file, document) {
  return pageScript(fs.readFileSync(file, 'utf8'), document);
}

// A permissive fake DOM for page tests: elements made on demand by id, a tree of children.
function fakeDom() {
  const ids = new Map();
  const make = (tag) => {
    const node = {
      tag, children: [], style: {}, dataset: {}, attributes: {}, className: '', textContent: '', innerHTML: '',
      disabled: false, value: '', title: '', hidden: false,
      classList: {
        add(...c) { node.className = [...new Set((node.className + ' ' + c.join(' ')).split(/\s+/).filter(Boolean))].join(' '); },
        remove(...c) { node.className = node.className.split(/\s+/).filter((x) => x && !c.includes(x)).join(' '); },
        toggle(c, on) { if (on === false || (on === undefined && node.className.split(/\s+/).includes(c))) this.remove(c); else this.add(c); },
        contains(c) { return node.className.split(/\s+/).includes(c); },
      },
      append(...items) { node.children.push(...items); },
      appendChild(item) { node.children.push(item); return item; },
      prepend(...items) { node.children.unshift(...items); },
      replaceChildren(...items) { node.children = items; node.textContent = ''; },
      setAttribute(k, v) { node.attributes[k] = String(v); },
      getAttribute(k) { return node.attributes[k] ?? null; },
      removeAttribute(k) { delete node.attributes[k]; },
      addEventListener(type, fn) { node['on' + type] = fn; },
      removeEventListener() {},
      querySelectorAll() { return []; }, querySelector() { return null; },
      getContext() { return new Proxy({}, { get: (_, key) => (key === 'measureText' ? () => ({ width: 10 }) : () => {}), set: () => true }); },
      getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; },
      focus() {}, blur() {}, click() { if (node.onclick) node.onclick({ preventDefault() {}, target: node }); },
      remove() {}, contains() { return false; },
    };
    return node;
  };
  const document = {
    getElementById(id) { if (!ids.has(id)) ids.set(id, make('#' + id)); return ids.get(id); },
    createElement: make, createElementNS: (_, tag) => make(tag), createTextNode: (text) => ({ textContent: text, children: [] }),
    documentElement: {}, body: make('body'), addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
  };
  return { document, ids };
}

// The text a node and everything below it shows (textContent, aria-label, title, placeholder).
function texts(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (node.textContent) out.push(node.textContent);
  if (node.innerHTML) out.push(node.innerHTML.replace(/<[^>]*>/g, ' '));
  for (const key of ['aria-label', 'placeholder', 'alt']) if (node.attributes && node.attributes[key]) out.push(node.attributes[key]);
  if (node.title) out.push(node.title);
  for (const child of node.children || []) texts(child, out);
  return out;
}

module.exports = { stringsOf, pageScript, pageScriptOf, fakeDom, texts };

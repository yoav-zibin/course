// Translation helper (docs/game-translation.md). Needs the i18n-strings block before it.
const SOURCE_STRINGS = JSON.parse(document.getElementById("i18n-strings").textContent);
let strings = SOURCE_STRINGS;

// The text for a key in the viewer's language, with {name}-style placeholders filled in.
function t(key, params) {
  const text = strings[key] ?? SOURCE_STRINGS[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (match, name) => (params && name in params ? params[name] : match));
}

// A text the game's SERVER wrote (a log line, a hand name in the match state): finds its template
// among the `server_` texts of the table (the most specific that fits, each {name} standing for
// any text) and shows it in the viewer's language with the same values; any other text is
// returned as written.
const SERVER_TEMPLATES = Object.keys(SOURCE_STRINGS)
  .filter((key) => key.startsWith("server_") && SOURCE_STRINGS[key])
  .map((key) => {
    const names = [];
    let literal = 0;
    const source = SOURCE_STRINGS[key]
      .split(/\{(\w+)\}/)
      .map((piece, index) => {
        if (index % 2) { names.push(piece); return "([\\s\\S]+?)"; }
        literal += piece.length;
        return piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("");
    return { key, names, literal, pattern: new RegExp("^" + source + "$") };
  })
  .sort((a, b) => b.literal - a.literal || a.names.length - b.names.length || (a.key > b.key ? 1 : a.key === b.key ? 0 : -1));

function tx(text) {
  if (typeof text !== "string") return text;
  for (const template of SERVER_TEMPLATES) {
    const found = template.pattern.exec(text);
    if (found) {
      const params = {};
      template.names.forEach((name, index) => { if (!(name in params)) params[name] = found[index + 1]; });
      return t(template.key, params);
    }
  }
  return text;
}

// Call this first in the state_changed handler, before drawing anything: the platform sends
// the viewer's translations (message.strings), language and writing direction with it.
function applyLocale(message) {
  if (message.strings || message.locale) strings = { ...SOURCE_STRINGS, ...(message.strings || {}) };
  if (message.locale) document.documentElement.lang = message.locale;
  if (message.direction) document.documentElement.dir = message.direction;
}

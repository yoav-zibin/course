// A stand-in for static/i18n.js in tests: English only, same helpers.
const fill = (text, params = {}) => String(text).replace(/\{(\w+)\}/g, (match, name) => (name in params ? params[name] : match));
module.exports = {
  t: (key, params, fallback) => fill(fallback ?? key, params),
  plural: (key, count, params, fallbacks = {}) => fill((count === 1 ? fallbacks.one : fallbacks.many) ?? key, { count, ...params }),
  number: (value) => String(value),
  date: (value) => new Date(value).toISOString(),
  locale: () => 'en',
  revision: () => 0,
  gameName: (id, fallback) => fallback,
  gameDescription: (id, fallback) => fallback,
  gameText: async () => ({ locale: 'en', direction: 'ltr' }),
};

// Only copied into the isolated release bundle for the startup-profile scenario.
const marks = {entry: performance.now()};
globalThis.__finishBenchmarkEntry = () => { marks.registration = performance.now(); };
const fetchFromApp = globalThis.fetch;
globalThis.fetch = (...args) => {
  const url = String(args[0]);
  if (url.startsWith('http://localhost:18764/') && marks.firstFetch === undefined) {
    marks.firstFetch = performance.now();
  }
  return fetchFromApp(...args);
};
setTimeout(() => {
  const timing = performance.rnStartupTiming || {};
  const value = {marks, wallOffset: Date.now() - performance.now()};
  for (const name of ['startTime', 'initializeRuntimeStart', 'executeJavaScriptBundleEntryPointStart', 'endTime']) {
    value[name] = timing[name] ?? null;
  }
  void fetchFromApp('http://localhost:18764/__startup', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(value),
  });
}, 1500);

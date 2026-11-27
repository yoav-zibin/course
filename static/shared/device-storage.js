/* Shared by the Portal bundle and classic site scripts. All application code
 * must use the asynchronous storage API. Direct access has delayed iOS input
 * for seconds. Native builds perform file operations on a storage Worklet.
 * Browsers keep the existing origin store so pages, tabs, and older saves agree. */
(function (root) {
  "use strict";
  if (!root.BuildPlayStorage) {
    const watched = new Map();
    function update(key, value) {
      const entry = watched.get(key);
      if (entry) entry.value = value;
    }
    async function getItem(key) {
      const value = root.localStorage?.getItem(key) ?? null;
      update(key, value);
      return value;
    }
    async function setItem(key, value) {
      // Watched controls retain their latest choice in memory if a browser
      // denies persistence. The returned promise still reports the disk error.
      update(key, value);
      const store = root.localStorage;
      if (!store) throw new Error("Device storage unavailable");
      store.setItem(key, value);
    }
    async function removeItem(key) {
      update(key, null);
      root.localStorage?.removeItem(key);
    }
    async function keys() {
      const store = root.localStorage;
      return store ? Object.keys(store) : [];
    }
    // Synchronous rendering and error redaction read a small in-memory view.
    // The web backend can hydrate it immediately from the window's origin store.
    function watchItem(key) {
      if (!watched.has(key)) {
        watched.set(key, {value: null});
        void getItem(key).catch(() => {});
      }
      const entry = watched.get(key);
      return () => entry.value;
    }
    (root.window ?? root).addEventListener?.("storage", event => {
      if (event.storageArea && event.storageArea !== root.localStorage) return;
      const changed = event.key == null ? watched.keys() : [event.key];
      for (const key of changed) {
        if (watched.has(key)) void getItem(key).catch(() => update(key, null));
      }
    });
    root.BuildPlayStorage = {getItem, setItem, removeItem, keys, watchItem};
  }
  if (typeof module !== "undefined" && module.exports) module.exports = root.BuildPlayStorage;
})(globalThis);

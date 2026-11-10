"use strict";

// Portal-only durable storage. Accounts use separate namespaces; credentials remain in Auth.
//
// Storage layout (per account, base key `game-platform.portal.v1.<id>`):
//   <base>              legacy single-JSON blob, kept untouched as a backup after migration
//   <base>.meta         manifest: {version:2, migrated:true, clock, responses:[paths],
//                        queues:[ids], conflicts:[ids], local:[ids]} — written last
//   <base>.recency      the single LRU order: {clock, entries:[{path, at}]} oldest first
//   <base>.r.<path>     one cached response per key
//   <base>.q.<id>       one queued-move list per match
//   <base>.c.<id>       one sync conflict per match
//   <base>.l.<id>       one local practice match per id
//   <base>.archives     conflict archives; <base>.archived  archived matches
//   <base>.selected     selected match id
// A corrupt or missing piece only loses that piece, never the whole account.
// Sizes are UTF-8 bytes, not characters; the recoverable-response budget is 1 MiB.
// Nothing here may throw for storage reasons: a denied or full device still
// plays online, and durable writes that cannot be saved report instead of
// pretending they were.

const PORTAL_PREFIX = "game-platform.portal.v1.";
const PORTAL_DELETED = "__portal_offline_deleted__";
const RESPONSE_BUDGET_BYTES = 1_000_000;
const RECENCY_CAP = 1000;

const portalTextEncoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
function utf8Bytes(text) {
  if (portalTextEncoder) return portalTextEncoder.encode(text).length;
  return unescape(encodeURIComponent(text)).length;
}
function byteLength(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text === undefined ? 0 : utf8Bytes(text);
}
function emptyState() {
  return { responses: {}, queues: {}, conflicts: {}, local: {}, archives: [], archivedMatches: [], selectedId: null, cacheAccess: {}, cacheClock: 0 };
}
function normalizeState(data) {
  const out = data && typeof data === "object" ? { ...data } : {};
  out.responses = out.responses && typeof out.responses === "object" ? out.responses : {};
  out.queues = out.queues && typeof out.queues === "object" ? out.queues : {};
  out.conflicts = out.conflicts && typeof out.conflicts === "object" ? out.conflicts : {};
  out.local = out.local && typeof out.local === "object" ? out.local : {};
  out.archives = Array.isArray(out.archives) ? out.archives : [];
  out.archivedMatches = Array.isArray(out.archivedMatches) ? out.archivedMatches : [];
  out.selectedId = out.selectedId ?? null;
  out.cacheAccess = out.cacheAccess && typeof out.cacheAccess === "object" ? out.cacheAccess : {};
  out.cacheClock = Number.isSafeInteger(out.cacheClock) ? out.cacheClock : 0;
  return out;
}

class PortalOffline {
  constructor(storage, request, user, online = () => navigator.onLine) {
    // A browser that denies storage entirely (Safari private mode, blocked
    // cookies) gets an in-memory store instead of a bricked portal.
    this.storage = PortalOffline.safeStorage(storage);
    this.request = request;
    this.user = user;
    this.online = online;
    this.network = true;
    this.notice = "";
    this.retryAfter = 0;
    this.storageDenied = false;
    if (this.storage.__portalMemoryFallback) {
      this.notice = I18n.t("ui.offline.storage_unavailable", {}, "Device storage unavailable; online play still works.");
      // The server can't see this otherwise: tell its log (common.js).
      globalThis.reportClientError?.("storage_unavailable", this.notice);
    }
  }
  /** [storage] when it answers a probe, otherwise an in-memory Map store
   * with the same getItem/setItem/removeItem interface. Never throws. */
  static safeStorage(storage) {
    try {
      if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function")
        throw new Error("no usable storage");
      const probe = "__portal_storage_probe__";
      storage.setItem(probe, "1");
      if (storage.getItem(probe) !== "1") throw new Error("storage probe mismatch");
      if (typeof storage.removeItem === "function") storage.removeItem(probe);
      return storage;
    } catch {
      return PortalOffline.memoryStorage();
    }
  }
  static memoryStorage() {
    const map = new Map();
    return {
      __portalMemoryFallback: true,
      getItem: (key) => (map.has(key) ? map.get(key) : null),
      setItem: (key, value) => map.set(key, String(value)),
      removeItem: (key) => map.delete(key),
      keys: () => [...map.keys()],
    };
  }
  key() {
    return `game-platform.portal.v1.${this.user()?.id || "visitor"}`;
  }
  metaKey() {
    return `${this.key()}.meta`;
  }
  recencyKey() {
    return `${this.key()}.recency`;
  }
  responseKey(path) {
    return `${this.key()}.r.${encodeURIComponent(path)}`;
  }
  queueKey(id) {
    return `${this.key()}.q.${encodeURIComponent(id)}`;
  }
  conflictKey(id) {
    return `${this.key()}.c.${encodeURIComponent(id)}`;
  }
  localKey(id) {
    return `${this.key()}.l.${encodeURIComponent(id)}`;
  }
  archivesKey() {
    return `${this.key()}.archives`;
  }
  archivedKey() {
    return `${this.key()}.archived`;
  }
  selectedKey() {
    return `${this.key()}.selected`;
  }
  /** A single read that never throws: denied storage reads as missing,
   * and records the denial so read() can say so. */
  rawGet(key) {
    try {
      const value = this.storage.getItem(key);
      this.storageDenied = false;
      return value;
    } catch {
      this.storageDenied = true;
      return null;
    }
  }
  /** Parses one stored piece; corrupt or deleted pieces read as missing. */
  readJson(key) {
    const raw = this.rawGet(key);
    if (raw === null || raw === undefined || raw === PORTAL_DELETED) return undefined;
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.warn("Could not parse saved portal data:", key, error);
      return undefined;
    }
  }
  /** Stored response-cache keys belonging to OTHER accounts on this
   * device, least recently used first (from each account's recency log;
   * unlogged entries count as oldest). Only `.r.` pieces are listed:
   * another account's queues, practice matches and archives are durable
   * data and are never reclaimed. */
  foreignResponseKeys() {
    const mine = `${this.key()}.`;
    const accounts = new Map();
    for (const stored of this.storedKeys()) {
      if (!stored.startsWith(PORTAL_PREFIX) || stored.startsWith(mine)) continue;
      const rest = stored.slice(PORTAL_PREFIX.length);
      const dot = rest.indexOf(".");
      if (dot < 0) continue;
      const account = rest.slice(0, dot);
      if (!accounts.has(account)) accounts.set(account, { recency: null, responses: [] });
      const entry = accounts.get(account);
      if (rest.slice(dot) === ".recency") {
        const log = this.readJson(stored);
        entry.recency = new Map(
          (Array.isArray(log?.entries) ? log.entries : []).map((item) => [item.path, item.at || 0]),
        );
      } else if (rest.slice(dot).startsWith(".r.")) {
        entry.responses.push(stored);
      }
    }
    const found = [];
    for (const [account, entry] of accounts) {
      const base = `${PORTAL_PREFIX}${account}`;
      for (const stored of entry.responses) {
        let path = stored.slice(base.length + 3);
        try {
          path = decodeURIComponent(path);
        } catch {
          // An undecodable suffix sorts as oldest; the key is still cache.
        }
        found.push({ key: stored, at: entry.recency?.get(path) || 0 });
      }
    }
    return found.sort((a, b) => a.at - b.at).map((item) => item.key);
  }
  storedKeys() {
    try {
      if (typeof this.storage.keys === "function") return this.storage.keys();
      if (typeof this.storage.length === "number" && typeof this.storage.key === "function") {
        const keys = [];
        for (let i = 0; i < this.storage.length; i++) {
          const found = this.storage.key(i);
          if (found !== null) keys.push(found);
        }
        return keys;
      }
      return Object.keys(this.storage).filter((entry) => typeof entry === "string");
    } catch {
      return [];
    }
  }
  read() {
    try {
      const data = this.readSplit();
      if (this.storageDenied)
        this.notice = I18n.t("ui.offline.storage_unavailable", {}, "Device storage unavailable; online play still works.");
      return data;
    } catch (error) {
      // Denied reads or a corrupt legacy blob: the portal still boots and
      // plays online; nothing on this device is trusted.
      console.warn("Could not read portal storage:", error);
      this.notice = I18n.t("ui.offline.storage_unavailable", {}, "Device storage unavailable; online play still works.");
      return emptyState();
    }
  }
  readSplit() {
    const meta = this.readJson(this.metaKey());
    if (meta && meta.migrated) return this.fanIn(meta);
    const legacyRaw = this.rawGet(this.key());
    if (legacyRaw !== null && legacyRaw !== undefined && legacyRaw !== PORTAL_DELETED) {
      // A corrupt legacy blob throws here and read() returns empty state.
      const data = normalizeState(JSON.parse(legacyRaw));
      const lru = this.readJson(`${this.key()}.lru`);
      if (lru && typeof lru === "object") {
        for (const [path, at] of Object.entries(lru)) {
          if (Object.hasOwn(data.responses, path))
            data.cacheAccess[path] = Math.max(data.cacheAccess[path] || 0, at);
        }
        data.cacheClock = Math.max(data.cacheClock || 0, ...Object.values(data.cacheAccess));
      }
      this.migrate(data);
      try {
        this.storage.removeItem?.(`${this.key()}.lru`);
      } catch {}
      return data;
    }
    // No manifest and no legacy blob: pieces may exist without an index
    // (a manifest write failed once). Rebuild the index by scanning.
    const scanned = this.scanIndex();
    if (scanned) return this.fanIn(scanned);
    return emptyState();
  }
  scanIndex() {
    const base = this.key();
    const index = { responses: [], queues: [], conflicts: [], local: [] };
    let found = false;
    for (const stored of this.storedKeys()) {
      if (
        stored === `${base}.archives` ||
        stored === `${base}.archived` ||
        stored === `${base}.selected` ||
        stored === `${base}.recency`
      ) {
        found = true;
        continue;
      }
      for (const [prefix, list] of [
        [`${base}.r.`, index.responses],
        [`${base}.q.`, index.queues],
        [`${base}.c.`, index.conflicts],
        [`${base}.l.`, index.local],
      ]) {
        if (stored.startsWith(prefix)) {
          try {
            list.push(decodeURIComponent(stored.slice(prefix.length)));
          } catch {
            // An undecodable key is not one of ours; leave it alone.
          }
          found = true;
        }
      }
    }
    return found ? index : null;
  }
  fanIn(index) {
    const data = emptyState();
    // The manifest can go stale when its own write fails; a scan finds
    // pieces it does not list (a saved queue above all), so no saved work
    // hides behind an outdated index.
    const scanned = this.scanIndex() || { responses: [], queues: [], conflicts: [], local: [] };
    const union = (listed, found) => [...new Set([...(listed || []), ...(found || [])])];
    for (const path of union(index.responses, scanned.responses)) {
      const value = this.readJson(this.responseKey(path));
      if (value !== undefined) data.responses[path] = value;
    }
    for (const id of union(index.queues, scanned.queues)) {
      const value = this.readJson(this.queueKey(id));
      if (value !== undefined) data.queues[id] = value;
    }
    for (const id of union(index.conflicts, scanned.conflicts)) {
      const value = this.readJson(this.conflictKey(id));
      if (value !== undefined) data.conflicts[id] = value;
    }
    for (const id of union(index.local, scanned.local)) {
      const value = this.readJson(this.localKey(id));
      if (value !== undefined) data.local[id] = value;
    }
    const archives = this.readJson(this.archivesKey());
    if (Array.isArray(archives)) data.archives = archives;
    const archived = this.readJson(this.archivedKey());
    if (Array.isArray(archived)) data.archivedMatches = archived;
    const selected = this.readJson(this.selectedKey());
    if (selected !== undefined) data.selectedId = selected;
    const recency = this.readJson(this.recencyKey());
    if (recency && Array.isArray(recency.entries)) {
      for (const entry of recency.entries) {
        if (entry && typeof entry.path === "string" && Object.hasOwn(data.responses, entry.path))
          data.cacheAccess[entry.path] = Math.max(data.cacheAccess[entry.path] || 0, entry.at || 0);
      }
      data.cacheClock = Math.max(data.cacheClock || 0, recency.clock || 0);
    }
    return data;
  }
  /** One-time fan-out of a legacy blob. The legacy key stays as a backup;
   * a failed fan-out leaves the manifest unset so the next read retries. */
  migrate(data) {
    try {
      const failed = this.fanOut(data);
      if (failed.length) console.warn("Could not migrate all portal storage:", failed);
    } catch (error) {
      console.warn("Could not migrate portal storage:", error);
    }
  }
  /** Merges the single recency record (other tabs, cache hits) into [data]
   * so a write never silently drops newer access order. */
  mergeRecency(data) {
    try {
      const recency = this.readJson(this.recencyKey());
      if (!recency) return;
      data.cacheAccess ||= {};
      if (Array.isArray(recency.entries)) {
        for (const entry of recency.entries) {
          if (entry && typeof entry.path === "string")
            data.cacheAccess[entry.path] = Math.max(data.cacheAccess[entry.path] || 0, entry.at || 0);
        }
      }
      data.cacheClock = Math.max(data.cacheClock || 0, recency.clock || 0);
    } catch (error) {
      console.warn("Could not read cache access order:", error);
    }
  }
  recencyValue(data) {
    const entries = Object.entries(data.cacheAccess || {})
      .filter(([path]) => Object.hasOwn(data.responses || {}, path))
      .sort((a, b) => a[1] - b[1])
      .slice(-RECENCY_CAP)
      .map(([path, at]) => ({ path, at }));
    return { clock: data.cacheClock || 0, entries };
  }
  metaValue(data) {
    const previous = this.readJson(this.metaKey());
    return {
      version: 2,
      migrated: true,
      migratedAt: previous?.migratedAt || new Date().toISOString(),
      clock: data.cacheClock || 0,
      responses: Object.keys(data.responses || {}),
      queues: Object.keys(data.queues || {}),
      conflicts: Object.keys(data.conflicts || {}),
      local: Object.keys(data.local || {}),
    };
  }
  responseBytes(path, value) {
    return utf8Bytes(path) + byteLength(value) + 2;
  }
  /** Writes [data] piece by piece; returns the keys that could not be
   * written. Unchanged pieces are skipped. Durable pieces (queues, practice,
   * conflicts) go first and their stale keys are dropped only once the new
   * pieces are safely written, so a failed write never deletes saved work
   * the manifest still lists. Dropping a stale recoverable response frees
   * quota and can never lose durable work, so it runs before the response
   * puts. The manifest goes last. */
  fanOut(data) {
    const failed = [];
    const put = (key, value) => {
      try {
        const raw = JSON.stringify(value);
        if (this.rawGet(key) === raw) return;
        this.storage.setItem(key, raw);
      } catch {
        failed.push(key);
      }
    };
    const drop = (key) => {
      try {
        if (typeof this.storage.removeItem === "function") this.storage.removeItem(key);
        else this.storage.setItem(key, PORTAL_DELETED);
      } catch {
        failed.push(key);
      }
    };
    const oldIndex = this.readJson(this.metaKey()) || this.scanIndex() || { responses: [], queues: [], conflicts: [], local: [] };
    // Dropping a stale recoverable response frees quota and can never lose
    // durable work, so it runs first: a quota-blocked queue put must see
    // the freed space in the same pass.
    for (const path of oldIndex.responses || [])
      if (!Object.hasOwn(data.responses || {}, path)) drop(this.responseKey(path));
    if (failed.length) return failed;
    for (const [id, queue] of Object.entries(data.queues || {})) put(this.queueKey(id), queue);
    for (const [id, match] of Object.entries(data.local || {})) put(this.localKey(id), match);
    for (const [id, conflict] of Object.entries(data.conflicts || {})) put(this.conflictKey(id), conflict);
    put(this.archivesKey(), data.archives || []);
    put(this.archivedKey(), data.archivedMatches || []);
    put(this.selectedKey(), data.selectedId ?? null);
    if (failed.length) return failed;
    for (const [path, value] of Object.entries(data.responses || {})) put(this.responseKey(path), value);
    put(this.recencyKey(), this.recencyValue(data));
    if (failed.length) return failed;
    for (const id of oldIndex.queues || [])
      if (!Object.hasOwn(data.queues || {}, id)) drop(this.queueKey(id));
    for (const id of oldIndex.conflicts || [])
      if (!Object.hasOwn(data.conflicts || {}, id)) drop(this.conflictKey(id));
    for (const id of oldIndex.local || [])
      if (!Object.hasOwn(data.local || {}, id)) drop(this.localKey(id));
    if (failed.length) return failed;
    put(this.metaKey(), this.metaValue(data));
    return failed;
  }
  cacheTouch(data, path) {
    data.cacheAccess ||= {};
    data.cacheClock = Math.max(Date.now(), (data.cacheClock || 0) + 1);
    data.cacheAccess[path] = data.cacheClock;
  }
  /** Records one cache hit in the single recency record: the path moves to
   * the newest end with a monotonic timestamp. Best effort only. */
  recordCacheAccess(path, clock) {
    try {
      const recency = this.readJson(this.recencyKey()) || { clock: 0, entries: [] };
      const now = Math.max(Date.now(), (recency.clock || 0) + 1, (clock || 0) + 1);
      recency.clock = now;
      recency.entries = (Array.isArray(recency.entries) ? recency.entries : []).filter((entry) => entry?.path !== path);
      recency.entries.push({ path, at: now });
      if (recency.entries.length > RECENCY_CAP) recency.entries.splice(0, recency.entries.length - RECENCY_CAP);
      this.storage.setItem(this.recencyKey(), JSON.stringify(recency));
    } catch (error) {
      console.warn("Could not save cache access order:", error);
    }
  }
  storedKeyBytes() {
    const out = [];
    for (const stored of this.storedKeys()) {
      const raw = this.rawGet(stored);
      if (typeof raw === "string") out.push({ key: stored, bytes: utf8Bytes(raw) });
    }
    return out;
  }
  storageInfo() {
    const data = this.read();
    const bytes = (value) => byteLength(value);
    const cache = Object.entries(data.responses || {}).reduce(
      (sum, [path, value]) => sum + this.responseBytes(path, value), 0);
    const queued = bytes(data.queues || {});
    const practice = bytes(data.local || {});
    const archives = bytes({ archives: data.archives || [], archivedMatches: data.archivedMatches || [] });
    const conflicts = bytes(data.conflicts || {});
    const selected = bytes(data.selectedId ?? null);
    const recency = bytes(this.recencyValue(data));
    const meta = bytes(this.metaValue(data));
    const total = cache + queued + practice + archives + conflicts + selected + recency + meta;
    const largest = Object.entries(data.responses || {})
      .map(([path, value]) => ({ path, bytes: this.responseBytes(path, value), lastUsed: data.cacheAccess[path] || 0 }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 5);
    // True LRU order: least recently used first; entries never touched
    // (lastUsed 0) sort first. Protected entries are never evicted.
    const evictionOrder = Object.keys(data.responses || {})
      .filter((path) => !this.protectedCache(data, path))
      .sort((a, b) => (data.cacheAccess[a] || 0) - (data.cacheAccess[b] || 0));
    const perMatchQueue = Object.entries(data.queues || {})
      .map(([id, queue]) => ({ id, bytes: bytes(queue), moves: queue.length }))
      .sort((a, b) => b.bytes - a.bytes);
    const perPractice = Object.entries(data.local || {})
      .map(([id, match]) => ({ id, bytes: bytes(match), gameId: match.game_id || null }))
      .sort((a, b) => b.bytes - a.bytes);
    let accounts = [];
    const totals = new Map();
    for (const { key, bytes: size } of this.storedKeyBytes()) {
      if (!key.startsWith(PORTAL_PREFIX)) continue;
      const account = key.split(".").slice(0, 4).join(".");
      totals.set(account, (totals.get(account) || 0) + size);
    }
    accounts = [...totals.entries()]
      .map(([key, size]) => ({ key, bytes: size }))
      .sort((a, b) => b.bytes - a.bytes);
    if (!accounts.length) accounts = [{ key: this.key(), bytes: total }];
    const otherKeys = this.storedKeyBytes()
      .filter(({ key }) => !key.startsWith(PORTAL_PREFIX))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 20);
    return {
      total,
      cache,
      queued,
      practice,
      archives,
      entries: Object.keys(data.responses || {}).length,
      budgetBytes: RESPONSE_BUDGET_BYTES,
      cacheBytes: cache,
      largest,
      evictionOrder,
      nextToEvict: evictionOrder[0] || null,
      perMatchQueue,
      perPractice,
      accounts,
      otherKeys,
    };
  }
  /** Service-worker shell cache size, for the Device storage panel. Pages
   * can read it; null when the Cache API is unavailable or unreadable. */
  async swCacheInfo() {
    try {
      const cachesApi = globalThis.caches;
      if (!cachesApi) return null;
      const names = await cachesApi.keys();
      let entries = 0,
        bytes = 0;
      for (const name of names) {
        if (!name.startsWith("playroom-portal-shell-")) continue;
        const cache = await cachesApi.open(name);
        const requests = await cache.keys();
        entries += requests.length;
        for (const request of requests) {
          try {
            const response = await cache.match(request);
            if (!response) continue;
            const length = Number(response.headers?.get?.("content-length"));
            if (Number.isSafeInteger(length) && length >= 0) {
              bytes += length;
              continue;
            }
            bytes += (await response.clone().blob()).size;
          } catch {
            // One unreadable entry must not hide the rest.
          }
        }
      }
      return { entries, bytes };
    } catch {
      return null;
    }
  }
  protectedCache(data, path) {
    const id = /^\/matches\/([^/]+)$/.exec(path)?.[1];
    return (id !== undefined && data.queues?.[id]?.length > 0) ||
      Object.values(data.local || {}).some(match =>
        path === `/games/${match.game_id}/versions/${match.game_version}`);
  }
  clearCache() {
    const data = this.read();
    for (const path of Object.keys(data.responses || {})) {
      if (!this.protectedCache(data, path)) {
        delete data.responses[path];
        if (data.cacheAccess) delete data.cacheAccess[path];
      }
    }
    this.write(data);
    // The superseded side key must not outlive the cache it described.
    try {
      this.storage.removeItem?.(`${this.key()}.lru`);
    } catch {}
  }
  /** Deletes one recoverable cached response. Protected entries (queued
   * matches, practice game code) refuse; returns false when nothing was
   * deleted. A storage failure still throws so the panel can report it. */
  deleteCached(path) {
    const data = this.read();
    if (!Object.hasOwn(data.responses || {}, path) || this.protectedCache(data, path)) return false;
    delete data.responses[path];
    if (data.cacheAccess) delete data.cacheAccess[path];
    this.write(data);
    return true;
  }
  write(data, { cacheOnly = false } = {}) {
    data.responses ||= {};
    data.cacheAccess ||= {};
    this.mergeRecency(data);
    for (const path of Object.keys(data.cacheAccess))
      if (!Object.hasOwn(data.responses, path)) delete data.cacheAccess[path];
    // Queued moves and local practice must keep their required snapshots.
    const droppable = Object.keys(data.responses).filter(path => !this.protectedCache(data, path))
      .sort((a, b) => (data.cacheAccess[a] || 0) - (data.cacheAccess[b] || 0));
    let cacheBytes = 0;
    for (const [path, value] of Object.entries(data.responses))
      cacheBytes += this.responseBytes(path, value);
    const evictOne = () => {
      const path = droppable.shift();
      if (path === undefined) return false;
      cacheBytes -= this.responseBytes(path, data.responses[path]);
      delete data.responses[path];
      delete data.cacheAccess[path];
      return true;
    };
    while (droppable.length && cacheBytes > RESPONSE_BUDGET_BYTES) evictOne();
    let failed = this.fanOut(data);
    // A quota failure drops recoverable responses and retries the whole
    // fan-out, so a move is still saved when the cache can make room and
    // the evicted pieces are actually deleted.
    while (failed.length && droppable.length) {
      evictOne();
      failed = this.fanOut(data);
    }
    // The quota is per browser origin, not per account: when this account
    // has nothing left to drop, the space may be held by other accounts'
    // cached answers on this device. Those are refetchable GET responses
    // (never queues, practice matches or archives), so reclaim them
    // before declaring the device full.
    if (failed.length) {
      const foreign = this.foreignResponseKeys();
      while (failed.length && foreign.length) {
        try {
          this.storage.removeItem(foreign.shift());
        } catch {
          // A denied removal must not mask the original failure.
        }
        failed = this.fanOut(data);
      }
    }
    if (failed.length) {
      const message =
        "Device storage is full or unavailable. This move was not saved; free space and retry.";
      // The server can't see this otherwise: tell its log (common.js).
      if (!cacheOnly) globalThis.reportClientError?.("storage_full", message);
      throw Object.assign(new Error(message), { storageFailure: true });
    }
  }
  /** A write the server operation has already survived: never throw, just
   * leave the notice for the status line. The on-device copy stays stale
   * and can be retried. */
  writeBestEffort(data) {
    try {
      this.write(data);
      return true;
    } catch (error) {
      console.warn("Could not save portal data:", error);
      this.notice = I18n.t("ui.offline.storage_write_failed", {}, "Device storage could not be updated; online play still works.");
      return false;
    }
  }
  cached(path) {
    const data = this.read();
    const value = data.responses[path];
    if (value !== undefined) {
      this.recordCacheAccess(path, data.cacheClock);
    }
    return value;
  }
  writeCache(data) {
    try { this.write(data, { cacheOnly: true }); }
    catch (error) {
      // Caching must never fail the page: any storage error just means
      // this answer is not saved for offline use.
      this.notice = I18n.t("ui.offline.cache_unavailable", {}, "Device cache unavailable; online play still works.");
    }
  }
  save(path, value) {
    const data = this.read();
    data.responses[path] = value;
    this.cacheTouch(data, path);
    this.writeCache(data);
    return value;
  }
  decorate(match) {
    const data = this.read(),
      queue = data.queues[match.id] || [];
    let result = queue.length
      ? data.responses[`/matches/${match.id}`] || match
      : match;
    for (const item of queue) result = this.apply(result, item.body);
    return {
      ...result,
      pending: queue.length,
      conflict: data.conflicts[match.id] || null,
    };
  }
  apply(match, body) {
    // A move ({move}) carries no resulting state: the server computes
    // it. The optimistic copy keeps the current view until the sync lands.
    if (!("new_state" in body)) {
      return { ...match, move_count: body.expected_move_count + 1 };
    }
    return {
      ...match,
      state: body.new_state,
      turn_of_player_indices: body.next_turn_player_indices,
      status: body.next_turn_player_indices === null ? "over" : "ongoing",
      end_reason: body.next_turn_player_indices === null ? "finished" : null,
      move_count: body.expected_move_count + 1,
    };
  }
  async get(path, options = {}) {
    const localId = path.startsWith("/matches/") ? path.slice(9) : null;
    if (localId?.startsWith("local-")) {
      const snapshot = localId.endsWith("/history");
      const history = localId.endsWith("/moves") || snapshot;
      const match = this.read().local[snapshot ? localId.slice(0, -8) : history ? localId.slice(0, -6) : localId];
      if (!match) throw new Error(I18n.t("ui.offline.err_practice_gone", {}, "Local practice is no longer saved."));
      if (snapshot) return {initial_state: match.initialState ?? null, initial_turn_player_indices: Object.hasOwn(match,"initialTurn") ? match.initialTurn : (match.historyStart === 0 ? [0] : null), moves: match.moves || []};
      return history ? (match.moves || []) : match;
    }
    let value;
    const identity = this.key();
    try {
      if (!this.online() || Date.now() < this.retryAfter)
        throw Object.assign(new TypeError("Offline"), { cachedOnly: true });
      value = await this.request("GET", path, options);
      if (identity !== this.key())
        throw Object.assign(new Error("Account changed"), { status: 409 });
      this.network = true;
      const d = this.read();
      const paged = /^\/v2(\/(?:games|matches(?:\/open)?))\?/.exec(path);
      if (paged) {
        // Cache only the most recent page per list. Preserve the old aliases
        // used to restore the offline shell and queued local moves.
        for (const key of Object.keys(d.responses)) {
          if(key.startsWith("/v2"+paged[1]+"?") && key!==path) {
            delete d.responses[key];
            if (d.cacheAccess) delete d.cacheAccess[key];
          }
        }
        d.responses[paged[1]]=value.items;
        if(paged[1]==="/matches") for(const match of value.items) {
          if(!d.queues[match.id]?.length && "state" in match) d.responses[`/matches/${match.id}`]=match;
        }
      }
      const matchId = /^\/matches\/([^/]+)$/.exec(path)?.[1];
      if (!(matchId && d.queues[matchId]?.length)) d.responses[path] = value;
      if (path === "/matches")
        for (const match of value)
          if (!d.queues[match.id]?.length && "state" in match)
            d.responses[`/matches/${match.id}`] = match;
      this.cacheTouch(d, path);
      this.writeCache(d);
    } catch (error) {
      if (error.storageFailure) throw error;
      if (
        error.status === 404 &&
        localId &&
        this.read().queues[localId]?.length
      )
        return this.decorate(this.cached(path));
      if (error.status && error.status < 500) throw error;
      this.network = false;
      if (!error.cachedOnly) this.retryAfter = Date.now() + 10000;
      value = this.cached(path);
      if (value === undefined)
        throw new Error(
          I18n.t("ui.offline.err_server_unreachable", {}, "Couldn't reach the server, and this data isn't saved on this device yet. Please try again."),
        );
    }
    if (path.startsWith("/v2/matches?")) {
      const d=this.read(), ids=new Set(value.items.map(m=>m.id));
      const missing=Object.keys(d.queues).filter(id=>!ids.has(id)).map(id=>d.responses[`/matches/${id}`]).filter(Boolean);
      return {...value,items:[...value.items,...missing].map(m=>this.decorate(m)).concat(Object.values(d.local))};
    }
    if (path === "/matches") {
      const d = this.read(),
        ids = new Set(value.map((m) => m.id));
      const missing = Object.keys(d.queues)
        .filter((id) => !ids.has(id))
        .map((id) => d.responses[`/matches/${id}`])
        .filter(Boolean);
      return [...value, ...missing]
        .map((m) => this.decorate(m))
        .concat(Object.values(d.local));
    }
    if (path !== "/matches/open" && /^\/matches\/[^/]+$/.test(path))
      return this.decorate(value);
    return value;
  }
  archiveMatch(id) {
    const d = this.read();
    d.archivedMatches ||= [];
    d.archivedMatches.push({id, match:d.local[id] || d.responses[`/matches/${id}`], moves:d.queues[id] || [], conflict:d.conflicts[id] || null, savedAt:new Date().toISOString()});
    delete d.local[id];delete d.queues[id];delete d.conflicts[id];
    for (const key of Object.keys(d.responses)) {
      if (key === `/matches/${id}` || key.startsWith(`/matches/${id}/`)) delete d.responses[key];
      else if (Array.isArray(d.responses[key]) && key.startsWith("/matches")) d.responses[key] = d.responses[key].filter(match=>match.id!==id);
    }
    if (d.selectedId === id) d.selectedId = null;
    // The server delete already succeeded: a storage failure must not
    // report the match as still there.
    this.writeBestEffort(d);
  }
  endPractice(id) {
    const d = this.read(), match = d.local[id];
    if (!match || match.status !== "ongoing") return;
    match.resumeTurn = match.turn_of_player_indices;
    match.turn_of_player_indices = null;match.status = "over";match.end_reason = "player_left";
    this.writeBestEffort(d);
  }
  resumePractice(id) {
    const d = this.read(), match = d.local[id];
    if (!match?.resumeTurn) return;
    match.turn_of_player_indices = match.resumeTurn;delete match.resumeTurn;
    match.status = "ongoing";match.end_reason = null;this.writeBestEffort(d);
  }
  async api(method, path, options = {}) {
    const matchId = /^\/matches\/([^/]+)$/.exec(path)?.[1];
    if (method === "DELETE" && matchId?.startsWith("local-")) {this.archiveMatch(matchId);return null;}
    if (method === "GET") return this.get(path, options);
    if (!this.online())
      throw new Error(
        I18n.t("ui.offline.err_needs_connection", {}, "This action needs a connection. Saved matches and local practice are available offline."),
      );
    const identity = this.key();
    let result;
    try {result = await this.request(method, path, options);}
    catch (error) {
      if (!(method === "DELETE" && matchId && error.status === 404 && this.cached(path)?.owner_user_id === this.user()?.id)) throw error;
    }
    if (identity !== this.key())
      throw new Error(I18n.t("ui.offline.err_account_refresh", {}, "Account changed; refresh to see the result."));
    if (method === "DELETE" && matchId) this.archiveMatch(matchId);
    if (result?.id && path.startsWith("/matches"))
      this.save(`/matches/${result.id}`, result);
    return result;
  }
  enqueue(match, body, {reportFailure = true} = {}) {
    const data = this.read(),
      id = match.id;
    if (data.conflicts[id])
      throw new Error(I18n.t("ui.offline.err_resolve_conflict", {}, "Resolve the sync conflict before making another move."));
    if (id.startsWith("local-")) {
      if (data.local[id]?.move_count !== body.expected_move_count)
        throw new Error(
          I18n.t("ui.offline.err_practice_other_tab", {}, "Local practice changed in another tab. Refresh before moving."),
        );
      const previous = data.local[id];
      data.local[id] = this.apply(previous, body);
      data.local[id].moves = [...(previous.moves || []), {new_state: body.new_state, next_turn_player_indices: body.next_turn_player_indices}];
      this.write(data, {cacheOnly: !reportFailure});
      return data.local[id];
    }
    // The in-memory match can run ahead of the saved response: the active-match
    // poll refreshes state.match straight from the server without rewriting
    // the offline cache, so a move made right after an opponent's (or the
    // computer's) move would otherwise be rejected as "changed in another
    // tab" even though it is based on the fresh view. But the saved response
    // is the base the queued moves were built on, so only treat it as stale
    // when the match has advanced past it plus the queued moves; a saved
    // response that is ahead still means this view is stale.
    const cached = data.responses[`/matches/${id}`];
    const queue = data.queues[id] || [];
    const base = cached && match.move_count > cached.move_count + queue.length
      ? match
      : cached || match;
    if (base.move_count + queue.length !== body.expected_move_count)
      throw new Error(
        I18n.t("ui.offline.err_match_other_tab", {}, "This match changed in another tab. Refresh before moving."),
      );
    data.responses[`/matches/${id}`] = base;
    queue.push({
      requestId: crypto.randomUUID(),
      body,
      baseState: match.state,
      baseTurn: match.turn_of_player_indices,
    });
    data.queues[id] = queue;
    this.write(data);
    return this.decorate(base);
  }
  async submitMove(match, body) {
    let pending;
    try {
      pending = this.enqueue(match, body, {reportFailure: !this.online()});
    } catch (error) {
      if (!error.storageFailure || !this.online() || match.id.startsWith("local-")) throw error;
      const data = this.read();
      if (data.queues[match.id]?.length || data.conflicts[match.id]) throw error;
      const account = this.user(), identity = this.key();
      let result;
      try {
        result = await this.request("POST", `/matches/${match.id}/moves`, {
          user:account, requestId:crypto.randomUUID(), body,
        });
      } catch (requestError) {
        if (requestError.status && requestError.status < 500) throw requestError;
        throw new Error(I18n.t("ui.offline.err_move_unknown", {}, "The server may have received this move. Refresh the match before trying again."));
      }
      if (identity !== this.key())
        throw new Error(I18n.t("ui.offline.err_account_refresh", {}, "Account changed; refresh to see the result."));
      this.notice = I18n.t("ui.offline.cache_unavailable", {}, "Device cache unavailable; online play still works.");
      return result;
    }
    await this.sync({force:true});
    return this.read().queues[match.id]?.length ? pending : this.cached(`/matches/${match.id}`) || pending;
  }
  async sync({ force = false } = {}) {
    // The retry backoff keeps background polls from hammering a dead
    // connection; an explicit move (force) still gets its attempt.
    if (!this.online() || !this.user() || (!force && Date.now() < this.retryAfter)) return;
    // Caller holds the origin-wide portal lock. Reload storage on every write.
    const account = this.user();
    const identity = this.key();
    const guard = () => {
      if (identity !== this.key())
        throw new Error(I18n.t("ui.offline.err_account_sync", {}, "Account changed; sync paused."));
    };
    for (const id of Object.keys(this.read().queues)) {
      if (this.read().conflicts[id]) continue;
      let retries = 0;
      while (this.read().queues[id]?.length) {
        const item = this.read().queues[id][0],
          body = item.body;
        try {
          const remote = await this.request("GET", `/matches/${id}`, {
            user: account,
          });
          guard();
          this.network = true;
          let accepted = false;
          if (remote.move_count > body.expected_move_count) {
            const paged = typeof StoragePages !== "undefined" && await StoragePages.enabled();
            const history = await this.request("GET", paged ? `/v2/matches/${id}/history?start=${body.expected_move_count}&limit=1` : `/matches/${id}/moves`, {user: account});
            guard();
            const previous = paged ? history.items[0] : history[body.expected_move_count];
            accepted =
              previous?.made_by_user_id === account.id &&
              ("move" in body
                ? PortalOffline.equal(previous.move, body.move)
                : PortalOffline.equal(previous.new_state, body.new_state) &&
                  PortalOffline.equal(
                    previous.next_turn_player_indices,
                    body.next_turn_player_indices,
                  ));
            if (!accepted) {
              this.conflict(
                id,
                remote,
                I18n.t("ui.offline.notice_other_player", {}, "Another player changed this match. Your offline moves are saved for review."),
              );
              break;
            }
          } else if (
            remote.move_count !== body.expected_move_count ||
            remote.status !== "ongoing" ||
            !PortalOffline.equal(remote.state, item.baseState) ||
            !PortalOffline.equal(remote.turn_of_player_indices, item.baseTurn)
          ) {
            this.conflict(
              id,
              remote,
              I18n.t("ui.offline.notice_changed_offline", {}, "The match changed while offline. Review your saved moves before using the server version."),
            );
            break;
          }
          const updated = accepted
            ? remote
            : await this.request("POST", `/matches/${id}/moves`, {
                user: account,
                requestId: item.requestId,
                body,
              });
          guard();
          const data = this.read();
          data.queues[id].shift();
          data.responses[`/matches/${id}`] = updated;
          if (!data.queues[id].length) delete data.queues[id];
          this.write(data);
        } catch (error) {
          guard();
          if (error.storageFailure) {
            this.retryAfter = Date.now() + 10000;
            this.notice = I18n.t("ui.offline.err_queue_update", {}, "Could not update the saved queue. The move remains saved; retry sync after freeing storage.");
            return;
          }
          if (error.status === 409) {
            if (++retries < 3) continue;
            this.conflict(
              id,
              null,
              I18n.t("ui.offline.notice_repeated", {}, "Repeated sync conflict. Review the server version before continuing."),
            );
            break;
          } // Re-read authoritative state before deciding whether to replay.
          if (error.status && error.status < 500) {
            this.conflict(id, null, `Sync stopped: ${error.message}`);
            break;
          }
          this.network = false;
          this.retryAfter = Date.now() + 10000;
          this.notice =
            I18n.t("ui.offline.notice_unavailable", {}, "Connection unavailable. Moves remain saved on this device.");
          return;
        }
      }
    }
  }
  conflict(id, remote, message) {
    const d = this.read();
    d.conflicts[id] = { remote, message };
    // Recording a conflict must not throw away the sync that found it.
    this.writeBestEffort(d);
  }
  resolve(id) {
    const d = this.read();
    const conflict = d.conflicts[id];
    if (!conflict) return;
    // Keep an explicit archive rather than silently deleting a player's offline work.
    d.archives ??= [];
    d.archives.push({
      id,
      moves: d.queues[id],
      savedAt: new Date().toISOString(),
    });
    delete d.queues[id];
    delete d.conflicts[id];
    if (conflict.remote) d.responses[`/matches/${id}`] = conflict.remote;
    this.writeBestEffort(d);
  }
  async practice(game, mode = "computer") {
    const user = this.user();
    if (!user)
      throw new Error(I18n.t("ui.offline.err_login_first", {}, "Log in online once before starting offline practice."));
    const count = Math.min(...game.allowed_player_counts),
      id = `local-${crypto.randomUUID()}`;
    const match = {
      id,
      game_id: game.id,
      game_version: game.version,
      owner_user_id: user.id,
      players: Array.from({ length: count }, (_, i) => ({
        player_index: i,
        id: `local-player-${i}`,
        kind: i === 0 || mode === "pass" ? "human" : "computer",
        user_id: i === 0 ? user.id : null,
      })),
      status: "ongoing",
      state: null,
      turn_of_player_indices: [0],
      move_count: 0,
      end_reason: null,
      created_at: new Date().toISOString(),
      localMode: mode,
      token_pot: 0,
      bet_per_player: 0,
      practiceSeed: crypto.getRandomValues(new Uint32Array(1))[0],
      historyStart: 0,
    };
    const identity = this.key();
    if (game.server_code) {
      const result = await PortalPractice.call(game, "newMatch", [], match);
      await this.practiceResult(game, match, result, false);
      match.initialState = match.state;
      match.initialTurn = match.turn_of_player_indices;
      await this.practiceComputers(game, match);
    }
    if (identity !== this.key()) throw new Error(I18n.t("ui.offline.err_account_practice", {}, "Account changed; practice was not saved."));
    const d = this.read();
    d.local[id] = match;
    d.responses[`/games/${game.id}/versions/${game.version}`] = game;
    this.write(d);
    return match;
  }
  async practiceResult(game, match, result, record = true) {
    const ids = match.players.map(p=>p.id);
    if (!result || !("state" in result) || !(result.turn === null ||
        (Array.isArray(result.turn) && result.turn.length &&
         new Set(result.turn).size === result.turn.length && result.turn.every(id=>ids.includes(id)))))
      throw new Error(I18n.t("ui.offline.err_invalid_state", {}, "Local game returned an invalid state or turn."));
    match.logicState = result.state;
    match.turn_of_player_indices = result.turn === null ? null : result.turn.map(id=>ids.indexOf(id));
    match.status = result.turn === null ? "over" : "ongoing";
    match.end_reason = result.turn === null ? "finished" : null;
    if (record) match.move_count++;
    const seat = match.localMode === "pass" ? (match.turn_of_player_indices?.[0] ?? 0) : 0;
    match.state = await PortalPractice.call(game,"viewFor",[match.logicState,ids[seat]],match);
    if (record) match.moves = [...(match.moves || []), {
      new_state:match.state,next_turn_player_indices:match.turn_of_player_indices}];
  }
  async practiceComputers(game, match) {
    for (let count=0;match.status === "ongoing";count++) {
      const computer = match.turn_of_player_indices.map(i=>match.players[i]).find(p=>p.kind === "computer");
      if (!computer) return;
      if (count >= 200) throw new Error(I18n.t("ui.offline.err_move_limit", {}, "Local game exceeded the computer move limit."));
      const move = await PortalPractice.call(game,"computerMove",[match.logicState,computer.id],match);
      const result = await PortalPractice.call(game,"applyMove",[match.logicState,computer.id,move],match);
      await this.practiceResult(game,match,result);
    }
  }
  async practiceMove(match, move) {
    if (!match.id.startsWith("local-") || !match.localMode)
      throw new Error(I18n.t("ui.offline.err_device_only", {}, "Only device practice can run game rules locally."));
    const identity = this.key();
    const original = this.read().local[match.id];
    if (!original || original.move_count !== match.move_count || original.status !== "ongoing")
      throw new Error(I18n.t("ui.offline.err_practice_changed", {}, "Local practice changed. Refresh before moving."));
    const next = JSON.parse(JSON.stringify(original));
    const game = this.cached(`/games/${match.game_id}/versions/${match.game_version}`);
    if (!game?.server_code) throw new Error(I18n.t("ui.offline.err_rules_missing", {}, "Practice rules are not saved on this device."));
    const seat = next.localMode === "pass" ? next.turn_of_player_indices[0] : 0;
    if (!next.turn_of_player_indices.includes(seat)) throw new Error(I18n.t("ui.error.not_your_turn", {}, "It isn't your turn."));
    const result = await PortalPractice.call(game,"applyMove",[next.logicState,next.players[seat].id,move],next);
    await this.practiceResult(game,next,result);
    await this.practiceComputers(game,next);
    if (identity !== this.key()) throw new Error(I18n.t("ui.offline.err_account_move", {}, "Account changed; move was not saved."));
    const data = this.read();
    if (!PortalOffline.equal(data.local[match.id],original))
      throw new Error(I18n.t("ui.offline.err_practice_other_tab", {}, "Local practice changed in another tab. Refresh before moving."));
    data.local[match.id] = next;
    this.write(data);
    return next;
  }
  static equal(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object")
      return false;
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((k) => Object.hasOwn(b, k) && PortalOffline.equal(a[k], b[k]))
    );
  }
}
if (typeof module !== "undefined") module.exports = PortalOffline;

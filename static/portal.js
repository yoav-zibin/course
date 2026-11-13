// Portal: list your matches, create, join, start, leave and delete them, and play them.

// The selected match's game runs in a sandboxed iframe; the page polls the server and
// sends the game state_changed whenever the match changes.
// Identity comes from Auth (the account menu); data comes from the public and
// authenticated API endpoints, never from the debug tools.

"use strict";

const $ = (id) => document.getElementById(id);
const POLL_MS = 2000;
const MATCH_POLL_MS = 1000;
async function portalFetch(method, path, { body, user, requestId } = {}) {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 20000);
  try {
    const headers = {};
    if (requestId) headers["Idempotency-Key"] = requestId;
    const campaignCode = window.ExperimentCampaignCode?.();
    if (campaignCode) headers["X-Campaign-Code"] = campaignCode;
    if (user) {
      headers["X-User-Id"] = user.id;
      headers["X-User-Password"] = user.password;
    }
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(I18n.t("ui.error.invalid_response", {}, "Invalid server response"));
    }
    if (!response.ok)
      throw new ApiError(response.status, data?.detail || response.statusText);
    return data;
  } finally {
    clearTimeout(timer);
  }
}
// Batched reads: GETs queue up and, 100ms after the last one arrives, go out as
// a single /batch call; the responses are split back to the original callers.
// A request that arrives while a batch is in flight starts the next batch, so
// batches are at least 100ms apart. Queues are per user, so one batch never
// mixes credentials. Only plain GETs are batched; anything with a body or an
// idempotency key (a write) goes straight out, and the /batch call itself uses
// portalFetch so it never re-enters the queue. A single match (GET
// /matches/{id}) is never batched: it is the live game poll, and sharing a
// batch with the catalog would let a slow catalog delay a move.
const BATCH_WAIT_MS = 100;
const batchQueues = new Map();
function enqueueBatchGet(path, user) {
  const key = user ? user.id : "anonymous";
  let queue = batchQueues.get(key);
  if (!queue) {
    queue = { items: [], user, timer: null };
    batchQueues.set(key, queue);
  }
  return new Promise((resolve, reject) => {
    queue.items.push({ path, resolve, reject });
    clearTimeout(queue.timer);
    queue.timer = setTimeout(() => flushBatch(key), BATCH_WAIT_MS);
  });
}
async function flushBatch(key) {
  const queue = batchQueues.get(key);
  if (!queue || !queue.items.length) return;
  batchQueues.delete(key);
  const items = queue.items;
  const requests = items.map(({ path }) => ({ method: "GET", path }));
  let results;
  try {
    results = await portalFetch(
      "GET",
      `/batch?requests=${encodeURIComponent(JSON.stringify(requests))}`,
      { user: queue.user },
    );
  } catch (error) {
    // The batch call itself failed: every queued request fails the same way,
    // and PortalOffline falls back to its saved copy for each of them.
    for (const item of items) item.reject(error);
    return;
  }
  for (let i = 0; i < items.length; i++) {
    const result = Array.isArray(results) ? results[i] : null;
    if (!result || typeof result.status !== "number") {
      items[i].reject(new Error(I18n.t("ui.error.invalid_response", {}, "Invalid server response")));
      continue;
    }
    if (result.status >= 200 && result.status < 300) items[i].resolve(result.body);
    else
      items[i].reject(
        new ApiError(result.status, result.body?.detail || String(result.status)),
      );
  }
}
async function portalTransport(method, path, { body, user, requestId } = {}) {
  if (
    method === "GET" &&
    body === undefined &&
    !requestId &&
    !/^\/matches\/(?!open$)[^/]+$/.test(path)
  )
    return enqueueBatchGet(path, user);
  return portalFetch(method, path, { body, user, requestId });
}
// Lazy-loads a portal script that is not needed for the first paint (speed
// clock, sounds). The file is already in the service-worker shell cache, so
// the load is local and fast. Concurrent calls for the same file share one load.
const portalScriptLoads = new Map();
function loadPortalScript(src) {
  if (!portalScriptLoads.has(src)) {
    portalScriptLoads.set(src, new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(I18n.t("ui.error.script_load_failed", {src}, `Failed to load ${src}`)));
      document.head.appendChild(script);
    }));
  }
  return portalScriptLoads.get(src);
}
// Browsers that deny storage entirely (private mode, blocked cookies)
// must not brick the portal: PortalOffline falls back to an in-memory
// store when the global itself, or its probe, is unavailable. Online play
// still works; only saving for offline use is lost.
function portalStorage() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}
const offline = new PortalOffline(portalStorage(), portalTransport, () =>
  Auth.current(),
);
if ("serviceWorker" in navigator)
  navigator.serviceWorker.addEventListener("message", event => {
    if (event.data?.type === "portal-shell-updated") location.reload();
  });
const portalRequest = (method, path, options = {}) =>
  offline.api(method, path, { user: Auth.current(), ...options });
const portalLock = (run) =>
  navigator.locks
    ? navigator.locks.request("playroom-portal", run)
    : Promise.reject(
        new Error(
          I18n.t("ui.error.web_locks", {}, "Offline moves need a current browser with Web Locks support."),
        ),
      );
let shellReady = false;
const RANDOM_GAME = {
  id: "__random__",
  name: "Random",
  description: "Join an open match of any game",
  allowed_player_counts: [2],
};
const isRandomGame = (game) => game === RANDOM_GAME;
function offlineStatus() {
  window.PortalMatchLayout?.connection(navigator.onLine && offline.network);
  const data = offline.read();
  const pending = Object.values(data.queues).reduce((n, q) => n + q.length, 0);
  const conflicts = Object.keys(data.conflicts).length;
  const parts = [
    navigator.onLine && offline.network ? I18n.t("ui.offline.online", {}, "Online") : I18n.t("ui.offline.offline", {}, "Offline"),
    I18n.plural("ui.offline.pending", pending, {}, { one: "1 pending move", many: `${pending} pending moves` }),
  ];
  if (conflicts) parts.push(I18n.plural("ui.offline.conflicts", conflicts, {}, { one: "1 sync conflict", many: `${conflicts} sync conflicts` }));
  parts.push(shellReady ? I18n.t("ui.offline.saved", {}, "Portal saved for offline") : I18n.t("ui.offline.not_ready", {}, "Offline setup not ready"));
  if (offline.notice) parts.push(offline.notice);
  $("offline-status").textContent = parts.join(" · ");
}

// Web push notifications: the toggle subscribes this browser and registers it with
// the server, which then pushes turn and match events. The logic is shared with the
// builder (push-notifications.js); arriving pushes are shown by portal-sw.js.
function setupNotifications() {
  return PushNotifications.setup($("notify-toggle"), portalTransport);
}

function toggleNotifications() {
  return PushNotifications.toggle($("notify-toggle"), portalTransport);
}

function currentPushSubscription() {
  return PushNotifications.currentSubscription();
}

const state = {
  games: [], // latest versions, from GET /games
  recentGames: [], // this account's bounded, most-recent-first game list
  recentGamesFetchedAt: 0,
  recentGamesRequestVersion: 0,
  recentGamesForceRefresh: true,
  recentGamesUserId: null,
  gamePopularityScores: new Map(),
  gamePopularityFetchedAt: new Map(),
  gamePopularityRequests: new Map(),
  gamePopularityVersions: new Map(),
  popularGames: [], // bounded server ranking; refreshes after starts and at most once per minute otherwise
  popularGamesFetchedAt: 0,
  popularGamesRequestVersion: 0,
  popularGamesForceRefresh: false,
  popularGamesStatus: "loading",
  gameCache: new Map(), // "game_id@version" -> game (null when gone)
  pictureCache: new Map(),
  nameCache: new Map(), // user id -> display name
  myMatches: [],
  openMatches: [],
  selectedId: null,
  pendingInvite: null, // a match invite token from #invite=, until it is accepted or dismissed
  match: null, // the selected match, from GET /matches/{id}
  armed: null, // an action waiting for a confirming second click
  loaded: null, // "match_id@game_id@version" loaded in the iframe
  lastSent: null, // the last state_changed sent, as JSON
  moveInFlight: false,
  refreshing: false,
  refreshAgain: false,
  creating: false,
  randomJoining: false,
  revealedMatch: null,
  gameSearchOpen: false,
  gameSearchQuery: "",
  gameSearchActive: 0,
  gameSearchOriginal: "",
  gameSearchKey: null,
  filteredGames: [],
  libraryFilter: "all",
  libraryView: "grid",
  libraryKey: null,
  requestedGameHandled: false,
  detailCreatorInitialized: false,
  detailGameId:
    new URLSearchParams(location.search).get("game") ||
    new URLSearchParams(location.hash.slice(1)).get("game"),
};

const frame = new GameFrame(
  $("game-box"),
  (move) => onMakeMove(move),
  // A game that posts anything but make_move is misbehaving, but that is the
  // game's bug, not the player's: log it for debugging and stay silent in
  // the UI instead of flashing an error the player cannot act on.
  (problem) => console.error(problem),
);

// Data

// TOKEN_UI_POLISH_V1: backend-owned balances; never award or settle tokens in the browser.
let walletBalance = null;
function updateStakePreview() {
  const select = $("match-stake"), preview = $("stake-preview"), panel = $("token-stake-panel");
  if (!select || !preview || !panel) return;
  const game = state.games.find(g => g.id === (state.detailGameId || $("new-game").value));
  const solo = Boolean(game && game.allowed_player_counts.length === 1 && game.allowed_player_counts[0] === 1);
  panel.classList.toggle("is-solo", solo);
  select.disabled = solo;
  if (solo && select.value !== "0") select.value = "0";
  const amount = Number(select.value);
  if (!amount || solo) {
    preview.replaceChildren(el("span", {class:"stake-preview-text", textContent: solo ? I18n.t("ui.stakes.preview_solo", {}, "Solo game · No wager") : I18n.t("ui.stakes.preview_free", {}, "Free game · No tokens at risk")}));
  } else {
    const params = {amount, pot: amount * 2, balance: walletBalance};
    preview.replaceChildren(
      el("span", {class:"stake-preview-text", textContent: walletBalance === null
        ? I18n.t("ui.stakes.preview", params, `${amount} tokens per person · ${amount * 2} tokens in a 2-player pot`)
        : I18n.t("ui.stakes.preview_wallet", params, `${amount} tokens per person · ${amount * 2} tokens in a 2-player pot · Wallet: ${walletBalance} tokens`)}));
  }
}

async function updateTokenWallet(user, record) {
  const wallet = $("token-wallet");
  if (!user) { wallet.hidden = true; walletBalance = null; updateStakePreview(); return; }
  try {
    // [record] is the /users/{id} row fetched with the catalog batch; when it
    // is not supplied (or the batch fetch failed), fetch it directly.
    if (record === undefined)
      record = await portalTransport("GET", `/users/${encodeURIComponent(user.id)}`, {user});
    if (!record) { wallet.hidden = true; walletBalance = null; updateStakePreview(); return; }
    if (me()?.id !== user.id) return;
    // Accounts saved before short invite links learn their referral code here.
    state.pictureCache.set(user.id, record.picture_url);
    state.nameCache.set(user.id, record.display_name);
    if (record.referral_code) Auth.setReferralCode?.(user.id, record.referral_code);
    if (Auth.setPicture?.(user.id, record.picture_url)) renderPortalAccountMenu();
    if (!Number.isSafeInteger(record.token_balance) || record.token_balance < 0) {
      wallet.hidden = true; walletBalance = null; updateStakePreview(); return;
    }
    walletBalance = record.token_balance;
    const balance = String(walletBalance);
    if ($("token-balance").textContent !== balance) $("token-balance").textContent = balance;
    wallet.title = I18n.t("ui.portal.wallet_hint", {balance}, `${balance} virtual tokens · +10 daily allowance on your first paid match entry`);
    wallet.hidden = false;
    // No optimistic balance adjustments: the server may grant today's +10 at start.
    updateStakePreview();
  } catch {
    wallet.hidden = true; walletBalance = null; updateStakePreview();
  }
}

function updateMatchCurrency(match, user) {
  const box = $("match-currency");
  if (!match || match.localMode) { box.hidden = true; return; }
  const stake = match.bet_per_player ?? 0;
  const pot = match.token_pot ?? 0;
  if (!Number.isSafeInteger(stake) || !Number.isSafeInteger(pot)) { box.hidden = true; return; }
  const paid = stake > 0;
  box.className = `match-currency token-summary${paid ? " is-paid" : ""}`;
  const title = el("div", {class:"token-summary-title"},
    el("span", {class:"token-summary-icon", "aria-hidden":"true", textContent:"✦"}),
    el("strong", {textContent: paid ? I18n.t("ui.stakes.paid", {}, "Match stakes") : I18n.t("ui.stakes.free", {}, "Free match")}));
  const values = el("div", {class:"token-summary-values"},
    el("div", {}, el("span", {textContent:I18n.t("ui.stakes.per_player", {}, "Per player")}), el("strong", {textContent:I18n.t("ui.stakes.tokens", {count: stake}, `${stake} tokens`)})),
    el("div", {}, el("span", {textContent:I18n.t("ui.stakes.pot", {}, "Pot")}), el("strong", {textContent:I18n.t("ui.stakes.tokens", {count: pot}, `${pot} tokens`)})));
  const notes = [];
  if (paid && match.status === "waiting_for_players")
    notes.push(el("p", {class:"token-summary-note", textContent:I18n.t("ui.stakes.pot_note", {}, "Pot is collected when the match starts. Paid matches need human players.")}));
  if (paid && match.status === "over" && match.token_payouts != null) {
    const seat = user && match.players.find(p => p.user_id === user.id);
    if (seat) {
      const payout = match.token_payouts[String(seat.player_index)] ?? 0;
      const net = payout - stake;
      notes.push(el("div", {class:"token-summary-payout"},
        el("span", {textContent:I18n.t("ui.stakes.your_payout", {}, "Your payout")}),
        el("strong", {textContent:I18n.t("ui.stakes.tokens", {count: payout}, `${payout} tokens`)}),
        el("small", {textContent:I18n.t("ui.stakes.net", {amount: `${net > 0 ? "+" : ""}${net}`}, `Net ${net > 0 ? "+" : ""}${net} tokens`)})));
    } else notes.push(el("p", {class:"token-summary-note", textContent:I18n.t("ui.stakes.settled", {}, "Payouts settled for all players.")}));
  }
  if (!paid && match.status === "over")
    notes.push(el("p", {class:"token-summary-note", textContent:I18n.t("ui.stakes.none_wagered", {}, "No tokens were wagered in this game.")}));
  box.replaceChildren(title, values, ...notes);
  box.hidden = false;
}


function me() {
  return Auth.current();
}

function renderPortalAccountMenu() {
  const container = $("account-menu");
  Auth.renderMenu(container);
  const panel = container.querySelector(".auth-menu-panel");
  panel?.querySelector(".portal-immersive-menu")?.remove();
  if (!panel || document.documentElement.dataset.skin !== "immersive" || document.documentElement.dataset.portalLayout) return;

  const menu = el("div", { class: "portal-immersive-menu" },
    el("button", {
      type: "button",
      textContent: I18n.t("ui.portal.my_matches", {}, "My matches"),
      onclick: () => {
        container._hideAuthMenu?.();
        document.querySelector(".topbar .sidebar-toggle")?.click();
      },
    }),
  );
  panel.prepend(menu);
}

function syncPortalRoutes() {
  const params = new URLSearchParams(location.search);
  params.delete("game");
  const back = document.querySelector(".back-to-games");
  const query = params.toString();
  if (back)
    back.href = "/static/portal.html" + (query ? `?${query}` : "");
}

/** Leaves the game page for the catalog. The plain link is not enough: it
 * only drops the address's game marker, which the page reads once at load
 * (and the ?game= form is a full navigation back to the same game unless
 * the parameter goes too), so the game page stayed open. */
function leaveGamePage(event) {
  event.preventDefault();
  const params = new URLSearchParams(location.search);
  params.delete("game");
  const query = params.toString();
  const target = "/static/portal.html" + (query ? `?${query}` : "");
  if (location.pathname + location.search !== target) {
    location.assign(target);
    return;
  }
  // Only the hash differs, so navigating would stay in this document:
  // reset the game view in place instead.
  history.replaceState(null, "", target);
  state.detailGameId = null;
  state.requestedGameHandled = true;
  $("match-creator").open = true;
  render();
  refresh();
}

/** A display name from the cache, or a short id while it loads. */
function nameOf(userId) {
  return state.nameCache.get(userId) ?? shortId(userId);
}

function playerName(player) {
  if (player.kind === "human" && !player.user_id)
    return I18n.t("ui.match.player_n", { number: player.player_index + 1 }, `Player ${player.player_index + 1}`);
  return player.user_id
    ? nameOf(player.user_id)
    : I18n.t("ui.match.computer_name", { number: player.player_index + 1 }, `Computer ${player.player_index + 1}`);
}

/** Whether [user] may report [player] in [match]: another human in an online match. */
function canReportPlayer(match, player, user) {
  return Boolean(user && !match.localMode && player.kind === "human" && player.user_id && player.user_id !== user.id);
}

/** The owner of a (non-quick) match that hasn't started may remove other humans. */
function canRemovePlayer(match, player, user) {
  return Boolean(user && !match.localMode && match.status === "waiting_for_players" &&
    match.owner_user_id === user.id && match.matchmaking_player_count == null &&
    player.kind === "human" && player.user_id && player.user_id !== user.id);
}

/** Opens the feedback dialog for [target] {type, id, name}: a fixed [kind], or the
 * sender's choice of bug, suggestion or problem. */
function openFeedback(target, {kind = "bug", chooseKind = true} = {}) {
  window.FeedbackDialog?.open({target, kind, chooseKind, user: me(), page: location.pathname + location.hash});
}

function gameOf(gameId, version) {
  return state.gameCache.get(`${gameId}@${version}`) ?? null;
}

/** Display metadata for a game: its full record when that version is cached,
 * otherwise the slim catalog entry. The catalog carries names and join rules
 * (but no code), which is all match lists need; the server still enforces the
 * pinned version's exact rules when someone actually joins. */
function gameMetaOf(gameId, version) {
  return (
    gameOf(gameId, version) ??
    state.games.find((game) => game.id === gameId) ??
    null
  );
}

/** Fetches one full game version (code included) into the cache. Loading the
 * whole catalog's code on every page load made one enormous response; a
 * single game's call stays small. */
async function fetchGameVersion(gameId, version) {
  const game = await portalRequest(
    "GET",
    `/games/${gameId}/versions/${version}`,
  );
  state.gameCache.set(`${gameId}@${version}`, game);
  return game;
}

function seatOf(match, userId) {
  return match.players.find((player) => player.user_id === userId && player.active !== false) ?? null;
}

/** Whether this viewer may move now: their own seat is in the turn. Players
 * only ever act for themselves. In pass-and-play the viewer's seat is the
 * turn seat (see the mySeat computation where the message is built), so the
 * same check covers it; computers move on the server, never through a client. */
function canMove(match, userId) {
  if (
    !match ||
    !userId ||
    match.status !== "ongoing" ||
    match.turn_of_player_indices === null
  )
    return false;
  if (match.localMode === "pass") return true;
  const seat = seatOf(match, userId);
  return seat !== null && match.turn_of_player_indices.includes(seat.player_index);
}

function isYourTurn(match, userId) {
  const seat = seatOf(match, userId);
  return match.status === "ongoing" && seat && (match.turn_of_player_indices ?? []).includes(seat.player_index);
}

function isJoinable(match, userId) {
  if (match.localMode || !userId || match.players.some(player => player.user_id === userId)) return false;
  if (match.players.some(player => player.kind === "computer")) return false;
  const game = gameMetaOf(match.game_id, match.game_version);
  if (!game) return false;
  if (game.published === false) return false;
  const max = Math.max(...game.allowed_player_counts);
  if (match.status === "waiting_for_players") return match.players.length < max;
  if (match.status === "ongoing" && game.allows_join_mid_match) {
    return match.players.length < max;
  }
  return false;
}

/** Fetches the player names for everything on screen, plus the full version
 * of the open match's game. Match lists render names and joinability from
 * the slim catalog (gameMetaOf), so their games' code is not fetched here;
 * a game's code is fetched on demand when it is opened. */
async function ensureDetails() {
  const userIds = new Set();
  const collect = (match) => {
    userIds.add(match.owner_user_id);
    for (const player of match.players)
      if (player.user_id) userIds.add(player.user_id);
  };
  state.myMatches.forEach(collect);
  state.openMatches.forEach(collect);
  if (state.match) collect(state.match);
  // Keep only visible data plus a small recent cache as users traverse pages.
  const openGameKeys = new Set(
    state.match ? [`${state.match.game_id}@${state.match.game_version}`] : [],
  );
  const detailGame=state.games.find(game=>game.id===state.detailGameId);
  if (detailGame) openGameKeys.add(`${detailGame.id}@${detailGame.version}`);
  for (const [cache, needed] of [[state.gameCache,openGameKeys],[state.nameCache,userIds],[state.pictureCache,userIds]]) {
    for (const key of cache.keys()) if (cache.size > 128 && !needed.has(key)) cache.delete(key);
  }
  // One batched request for every missing profile: fetching them one by one
  // was the portal's worst slow-request offender under load.
  const missingUserIds = [...userIds].filter(
    (id) => !state.nameCache.has(id) || !state.pictureCache.get(id),
  );
  await Promise.all([
    (async () => {
      if (!missingUserIds.length) return;
      try {
        const profiles = await portalRequest(
          "GET",
          `/users?ids=${missingUserIds.map(encodeURIComponent).join(",")}`,
        );
        const found = new Set();
        for (const profile of profiles) {
          found.add(profile.id);
          state.nameCache.set(profile.id, profile.display_name);
          state.pictureCache.set(profile.id, profile.picture_url);
        }
        for (const id of missingUserIds)
          if (!found.has(id)) state.nameCache.set(id, shortId(id));
      } catch {
        for (const id of missingUserIds) state.nameCache.set(id, shortId(id));
      }
    })(),
    // Only the open match needs its game's full version (code) right now,
    // and that is a single small request.
    (async () => {
      if (!state.match) return;
      const key = `${state.match.game_id}@${state.match.game_version}`;
      if (state.gameCache.get(key)?.code) return;
      try {
        await fetchGameVersion(state.match.game_id, state.match.game_version);
      } catch {
        // A transient network error must not permanently poison this
        // version: it stays uncached and is retried on the next refresh.
      }
    })(),
    (async () => {
      if (!detailGame) return;
      const key=`${detailGame.id}@${detailGame.version}`;
      if (state.gameCache.get(key)?.code) return;
      try {
        await fetchGameVersion(detailGame.id,detailGame.version);
      } catch {
        // The focused game version is retried on the next refresh.
      }
    })(),
  ]);
}

// Coalesce polls before they enter Web Locks, so slow requests cannot build an
// unbounded queue ahead of a player's move (including from the same tab).
let refreshPending = null;
function refresh() {
  if (refreshPending) return refreshPending;
  refreshPending = portalLock(refreshLocked)
    .catch(error => showPageError(error.message))
    .finally(() => { refreshPending = null; });
  return refreshPending;
}

// Poll the active online match independently of catalog/list refreshes. A slow
// catalog request or another tab's offline lock must not delay the next turn.
let matchPollPending = false;
async function pollActiveMatch() {
  const current = state.match, user = me();
  if (matchPollPending || document.hidden || !navigator.onLine || !user ||
      !current || current.localMode || current.status !== "ongoing" ||
      state.selectedId !== current.id || state.moveInFlight ||
      offline.read().queues?.[current.id]?.length) return;
  matchPollPending = true;
  try {
    const next = await portalTransport("GET", `/matches/${encodeURIComponent(current.id)}`, {user});
    if (me()?.id !== user.id || state.selectedId !== current.id || state.moveInFlight ||
        !state.match || state.match.id !== current.id ||
        offline.read().queues?.[current.id]?.length ||
        next.move_count < state.match.move_count ||
        (next.move_count === state.match.move_count && next.updated_at < state.match.updated_at)) return;
    if (next.move_count === state.match.move_count && next.updated_at === state.match.updated_at) return;
    state.match = offline.decorate(next);
    render();
    await syncGame();
  } catch {
    // The regular refresh owns offline fallback and user-visible errors.
  } finally {
    matchPollPending = false;
  }
}

function invalidatePopularGames() {
  state.popularGamesFetchedAt = 0;
  state.popularGamesForceRefresh = true;
  state.popularGamesRequestVersion += 1;
  if (state.refreshing) state.refreshAgain = true;
}

function invalidateRecentGames() {
  state.recentGamesFetchedAt = 0;
  state.recentGamesForceRefresh = true;
  state.recentGamesRequestVersion += 1;
  if (state.refreshing) state.refreshAgain = true;
}

function invalidateGamePopularity(gameId) {
  if (!gameId) return;
  state.gamePopularityVersions.set(
    gameId,
    (state.gamePopularityVersions.get(gameId) || 0) + 1,
  );
  state.gamePopularityScores.delete(gameId);
  state.gamePopularityFetchedAt.delete(gameId);
  state.gamePopularityRequests.delete(gameId);
}

function selectedSetupGame() {
  const id = state.detailGameId || $("new-game").value;
  return state.games.find(game => game.id === id) || null;
}

function renderGamePopularity(game, score) {
  const label = $("selected-game-popularity");
  label.hidden = !game;
  if (!game) return;
  label.textContent = score === null
    ? I18n.t("ui.games.popularity_score_unavailable", {}, "Popularity score: unavailable")
    : I18n.t("ui.games.popularity_score", {score: I18n.number(score)}, `Popularity score: ${score}`);
}

function updateGamePopularity(game) {
  const label = $("selected-game-popularity");
  if (!game || isRandomGame(game)) {
    label.hidden = true;
    return;
  }
  const fetchedAt = state.gamePopularityFetchedAt.get(game.id) || 0;
  if (state.gamePopularityScores.has(game.id) && Date.now() - fetchedAt < 60_000) {
    renderGamePopularity(game, state.gamePopularityScores.get(game.id));
    return;
  }
  label.hidden = false;
  label.textContent = I18n.t("ui.games.popularity_loading", {}, "Popularity score: loading…");
  if (state.gamePopularityRequests.has(game.id)) return;
  const version = state.gamePopularityVersions.get(game.id) || 0;
  state.gamePopularityVersions.set(game.id, version);
  const request = portalRequest(
    "GET",
    `/games/${encodeURIComponent(game.id)}/popularity`,
    {user: me()},
  ).then(result => {
    if (state.gamePopularityVersions.get(game.id) !== version) return;
    const score = Number.isSafeInteger(result?.score) && result.score >= 0 ? result.score : 0;
    state.gamePopularityScores.set(game.id, score);
    state.gamePopularityFetchedAt.set(game.id, Date.now());
    if (selectedSetupGame()?.id === game.id)
      renderGamePopularity(game, score);
  }).catch(() => {
    if (state.gamePopularityVersions.get(game.id) !== version) return;
    state.gamePopularityScores.set(game.id, null);
    state.gamePopularityFetchedAt.set(game.id, Date.now());
    if (selectedSetupGame()?.id === game.id)
      renderGamePopularity(game, null);
  }).finally(() => {
    if (state.gamePopularityVersions.get(game.id) === version)
      state.gamePopularityRequests.delete(game.id);
  });
  state.gamePopularityRequests.set(game.id, request);
}

async function refreshLocked() {
  if (state.refreshing) {
    // Refresh again once the current one finishes, so it sees the latest changes.
    state.refreshAgain = true;
    return;
  }
  state.refreshing = true;
  state.refreshAgain = false;
  try {
    const user = me();
    // Local practice has its pinned rules and position on-device. Never hold
    // the origin's move lock while fetching remote metadata for this screen.
    if (state.selectedId?.startsWith("local-")) {
      state.match = await portalRequest("GET", `/matches/${state.selectedId}`);
      const saved = offline.read();
      const locals = Object.values(saved.local);
      state.myMatches = state.myMatches.filter(match => !match.localMode).concat(locals);
      const match = state.match;
      const game = saved.responses[`/games/${match.game_id}/versions/${match.game_version}`];
      if (game) state.gameCache.set(`${match.game_id}@${match.game_version}`, game);
      if (user) {
        state.nameCache.set(user.id,user.display_name);
        state.pictureCache.set(user.id,user.picture_url || "");
      }
      render();
      await syncGame();
      showPageError("");
      return;
    }
    if (!user) $("token-wallet").hidden = true;
    if (!user) {
      state.recentGames = [];
      state.recentGamesFetchedAt = 0;
      state.recentGamesForceRefresh = true;
      state.recentGamesUserId = null;
    } else if (state.recentGamesUserId !== user.id) {
      state.recentGames = [];
      state.recentGamesFetchedAt = 0;
      state.recentGamesForceRefresh = true;
      state.recentGamesUserId = user.id;
    }
    await offline.sync();
    const popularityDue = state.popularGamesForceRefresh || Date.now() - state.popularGamesFetchedAt >= 60_000;
    const popularityRequestVersion = state.popularGamesRequestVersion;
    const recentGamesDue = Boolean(user) && (state.recentGamesForceRefresh || Date.now() - state.recentGamesFetchedAt >= 60_000);
    const recentGamesRequestVersion = state.recentGamesRequestVersion;
    const [games, myMatches, openMatches, popularGames, recentGames, userRecord] = await Promise.all([
      StoragePages.list(portalRequest, "/games", {user}),
      user ? StoragePages.list(portalRequest, "/matches", {user}) : [],
      StoragePages.list(portalRequest, "/matches/open", {user}),
      popularityDue
        ? portalRequest("GET", "/games/popular?limit=8", {user}).catch(() => null)
        : null,
      recentGamesDue
        ? portalRequest("GET", "/users/me/recent-games", {user}).catch(() => null)
        : null,
      // The token-wallet row rides the same batch instead of its own call.
      user
        ? portalRequest("GET", `/users/${encodeURIComponent(user.id)}`, {user}).catch(() => null)
        : null,
    ]);
    state.games = games;
    state.myMatches = myMatches;
    state.openMatches = openMatches;
    if (recentGamesDue && recentGamesRequestVersion === state.recentGamesRequestVersion && user?.id === me()?.id) {
      state.recentGamesFetchedAt = Date.now();
      state.recentGamesForceRefresh = false;
      if (Array.isArray(recentGames)) state.recentGames = recentGames;
    }
    if (popularityDue && popularityRequestVersion === state.popularGamesRequestVersion) {
      state.popularGamesFetchedAt = Date.now();
      state.popularGamesForceRefresh = false;
      if (Array.isArray(popularGames)) {
        const oldRanking = state.popularGames.map(game => game.id).join("\u0000");
        const nextRanking = popularGames.map(game => game.id).join("\u0000");
        if (oldRanking !== nextRanking) $("popular-games").scrollLeft = 0;
        state.popularGames = popularGames;
        state.popularGamesStatus = popularGames.length ? "ranked" : "collecting";
      } else {
        state.popularGamesStatus = "unavailable";
      }
    }
    if (state.detailGameId && !state.games.some(game=>game.id===state.detailGameId)) {
      try { state.games.push(await portalRequest("GET", `/games/${encodeURIComponent(state.detailGameId)}`)); }
      catch (error) { if(error.status!==404) throw error; }
    }
    if (state.selectedId) {
      try {
        const selectedId = state.selectedId;
        const refreshedMatch = await portalRequest(
          "GET",
          `/matches/${selectedId}`,
        );
        if (state.selectedId === selectedId && (!state.match || state.match.id !== selectedId ||
            refreshedMatch.move_count > state.match.move_count ||
            (refreshedMatch.move_count === state.match.move_count && refreshedMatch.updated_at >= state.match.updated_at)))
          state.match = refreshedMatch;
      } catch (error) {
        if (error.status !== 404) throw error;
        showMessage(I18n.t("ui.match.gone", {}, "This match no longer exists."), "error");
        state.replay = null;
        state.match = null;
      }
    }
    await ensureDetails();
    if (user?.id !== me()?.id) return;
    await updateTokenWallet(user, userRecord);
    if (user?.id !== me()?.id) return;
    render();
    window.PortalFeedback?.update(state.match, user?.id, {
      suppressed: Boolean(state.replay || state.match?.pending || state.match?.conflict || state.match?.localMode || !navigator.onLine),
      yourTurn: Boolean(user && state.match && isYourTurn(state.match, user.id)),
      outcome: state.match ? matchOutcome(state.match, user?.id)?.kind : null,
    });
    await syncGame();
    showPageError("");
    offlineStatus();
  } catch (error) {
    window.PortalFeedback?.reset();
    showPageError(I18n.t("ui.portal.load_failed", {message: error.message}, `Couldn't load data from the server: ${error.message}`));
  } finally {
    state.refreshing = false;
    offlineStatus();
  }
  if (state.refreshAgain) await refreshLocked();
}

// Lists

// Games own their opaque state. Only display an outcome when they explicitly
// report a valid winning seat or a completed draw; never infer a loss from leaving.
function matchOutcome(match, userId) {
  if (match.status !== "over") return null;
  if (match.end_reason && match.end_reason !== "finished")
    return {label:I18n.t("ui.match.ended_early", {}, "Ended early"), kind:"neutral"};
  const result = match.state ?? match.result;
  const seat = seatOf(match, userId);
  let outcome = {label:I18n.t("ui.match.result_unavailable", {}, "Result unavailable"), kind:"neutral"};
  if (result && typeof result === "object") {
    if (Number.isInteger(result.winner) && match.players.some(player => player.player_index === result.winner)) {
      outcome = seat
        ? {label:seat.player_index === result.winner ? I18n.t("ui.match.you_won", {}, "You won") : I18n.t("ui.match.you_lost", {}, "You lost"), kind:seat.player_index === result.winner ? "win" : "loss"}
        : {label:I18n.t("ui.match.won", {name: playerName(match.players.find(player => player.player_index === result.winner))}, "{name} won"), kind:"neutral"};
    } else if (result.winner === -1 || (result.winner === null && (result.draw === true || result.done === true))) {
      outcome = {label:I18n.t("ui.match.draw", {}, "Draw"), kind:"draw"};
    }
  }
  if (match.pending || match.conflict) outcome = {...outcome, label:outcome.label + " · " + I18n.t("ui.match.awaiting_sync", {}, "awaiting sync")};
  return outcome;
}

function matchItem(match) {
  const game = gameMetaOf(match.game_id, match.game_version);
  const user = me();
  const yourTurn = user && isYourTurn(match, user.id);
  const badges = [el("span", { class: `badge ${match.status}`, textContent: I18n.t(`status.${match.status}`, {}, match.status.replaceAll("_", " ")) })];
  const outcome = matchOutcome(match, user?.id);
  if (outcome) badges.push(el("span", {class:`badge result-${outcome.kind}`, textContent:outcome.label}));
  if (yourTurn) badges.unshift(el("span", { class: "badge turn", textContent: I18n.t("ui.match.your_turn", {}, "your turn") }));
  return el(
    "button",
    {
      type: "button",
      class: "list-item",
      "aria-selected": String(match.id === state.selectedId),
      onclick: () => selectMatch(match.id),
    },
    el("div", { class: "title" }, game ? I18n.gameName(game.id, game.name) : "?", ...badges),
    el("div", {
      class: "sub",
      textContent: `${match.players.map(playerName).join(", ")} · ${I18n.t("ui.match.moves_count", { count: match.move_count }, `${match.move_count} moves`)}`,
    }),
  );
}

function renderLists() {
  const user = me();
  const groups = [
    ["turn", (m) => user && isYourTurn(m, user.id)],
    ["ongoing", (m) => m.status === "ongoing"],
    ["waiting", (m) => m.status === "waiting_for_players"],
    ["over", (m) => m.status === "over"],
  ];
  const shown = new Set();
  for (const [id, predicate] of groups) {
    const matches = state.myMatches.filter((m) => !shown.has(m.id) && predicate(m));
    matches.forEach((m) => shown.add(m.id));
    $("count-" + id).textContent = String(matches.length);
    if (id === "turn") $("group-turn").hidden = matches.length === 0;
    renderMatchList($("list-" + id), matches);
    if (matches.some((m) => m.id === state.selectedId) && state.revealedMatch !== state.selectedId) {
      $("group-" + id).open = true;
      state.revealedMatch = state.selectedId;
    }
  }
  $("portal-login-note").hidden = Boolean(user);

  const open = user ? state.openMatches.filter((m) => isJoinable(m, user.id)) : state.openMatches;
  $("count-open").textContent = String(open.length);
  renderMatchList($("open-matches"), open);

  const games = state.games;
  const select = $("new-game");
  const previous = select.value;
  const key = JSON.stringify(games.map((game) => [game.id, game.version]));
  if (select.dataset.key !== key) {
    select.dataset.key = key;
    if (state.detailGameId) {
      select.value = games.some((game) => game.id === state.detailGameId) ? state.detailGameId : "";
    } else {
      const requested = state.requestedGameHandled ? null : new URLSearchParams(location.hash.slice(1)).get("game");
      if (games.length) state.requestedGameHandled = true;
      const chosen = requested || previous;
      if (!state.gameSearchOpen) select.value = games.some((game) => game.id === chosen) ? chosen : "";
      else if (!games.some((game) => game.id === previous)) select.value = "";
    }
  }
  renderGameSearch();
  StoragePages.controls("/games", user, $("game-results"), refresh);
  StoragePages.controls("/games", user, $("game-library"), refresh);
  StoragePages.controls("/matches", user, $("group-over"), refresh);
  StoragePages.controls("/matches/open", user, $("open-matches"), refresh);
  updateMatchSetup();
}

function openGamePage(id) {
  if (![state.games, state.popularGames, state.recentGames].some(games =>
    games.some(game => game.id === id))) return;
  const route = new URLSearchParams({ game: id });
  const skin = new URLSearchParams(location.search).get("skin");
  if (skin) route.set("skin", skin);
  location.assign(`/static/portal.html?${route}`);
}

async function joinRandomMatch() {
  if (state.randomJoining) return;
  const user = me();
  if (!user) {
    showPageError(I18n.t("ui.portal.random_login", {}, "Log in to join a random match."));
    return;
  }
  if (!navigator.onLine) {
    showPageError(I18n.t("ui.portal.random_offline", {}, "Connect to the internet to join a random match."));
    return;
  }
  state.randomJoining = true;
  state.libraryKey = null;
  renderLibrary();
  try {
    const [openMatches, games] = await Promise.all([
      StoragePages.list(portalRequest,"/matches/open",{user}),
      StoragePages.list(portalRequest,"/games",{user}),
    ]);
    state.openMatches = openMatches;
    state.games = games;
    await ensureDetails();
    // A random join must not commit the player to anything they didn't pick:
    // skip matches that stake tokens or run a move clock.
    const candidates = state.openMatches.filter((match) => isJoinable(match, user.id) &&
      !(match.bet_per_player > 0) && match.turn_seconds == null);
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    for (const match of candidates) {
      try {
        const joined = await portalRequest("POST", `/matches/${match.id}/join`, {user});
        if (joined?.status === "ongoing") {
          invalidatePopularGames();
          invalidateRecentGames();
          invalidateGamePopularity(joined.game_id);
        }
        selectMatch(match.id);
        return;
      } catch (error) {
        if (error.status !== 409) throw error;
      }
    }

    const multiplayerGames = state.games.filter((game) =>
      game.published !== false && game.allowed_player_counts.some((count) => count > 1));
    if (!multiplayerGames.length)
      throw new Error(I18n.t("ui.portal.no_multiplayer_games", {}, "No published multiplayer games are available to create a lobby."));
    const game = multiplayerGames[Math.floor(Math.random() * multiplayerGames.length)];
    const match = await portalRequest("POST", "/matches", {
      user,
      body: {game_id: game.id, num_computer_opponents: 0},
    });
    selectMatch(match.id);
  } catch (error) {
    showPageError(I18n.t("ui.portal.random_failed", {message: error.message}, `Couldn't join a random match: ${error.message}`));
  } finally {
    state.randomJoining = false;
    state.libraryKey = null;
    renderLibrary();
  }
}

function gameCountLabel(game) {
  const counts = game.allowed_player_counts.join(", ");
  return game.allowed_player_counts.length === 1 && game.allowed_player_counts[0] === 1
    ? I18n.t("ui.games.solo_label", {}, "1 player · solo")
    : I18n.t("ui.games.players_label", { counts }, `${counts} players`);
}

function libraryGames() {
  const query = state.gameSearchQuery.trim().toLocaleLowerCase();
  const matches = game =>
    `${game.name} ${game.description || ""}`.toLocaleLowerCase().includes(query) &&
    (state.libraryFilter === "all" || (state.libraryFilter === "solo"
      ? game.allowed_player_counts.includes(1)
      : game.allowed_player_counts.some(count => count > 1)));
  return [
    ...(matches(RANDOM_GAME) ? [RANDOM_GAME] : []),
    ...state.games.filter(matches),
  ];
}

// Distinguish games that share a name, even when filtering hides one of them.
function catalogGameLabel(game) {
  const name = game.name.trim().toLocaleLowerCase();
  const duplicate = state.games.some(other => other.id !== game.id && other.name.trim().toLocaleLowerCase() === name);
  const short = game.id.slice(0, 8);
  const id = state.games.some(other => other.id !== game.id && other.id.slice(0, 8) === short) ? game.id : short;
  const shown = I18n.gameName(game.id, game.name);
  return duplicate ? `${shown} · v${game.version} · ${id}` : shown;
}

function renderLibrary() {
  renderRecentGames();
  renderPopularGames();
  const games = libraryGames();
  const selected = $("new-game").value;
  const key = JSON.stringify([games, games.map(catalogGameLabel), selected, state.libraryView, state.libraryFilter, state.randomJoining, I18n.revision()]);
  if (state.libraryKey === key) return;
  state.libraryKey = key;
  // The "Random game" card isn't a game: count only real ones.
  const gameCount = games.filter(game => !isRandomGame(game)).length;
  $("library-count").textContent = I18n.t("ui.games.count", { count: gameCount }, `${gameCount} ${gameCount === 1 ? "game" : "games"} to explore`);
  $("library-empty").hidden = games.length > 0;
  $("game-library").className = `game-library-grid ${state.libraryView === "list" ? "is-list" : ""}`;
  $("game-library").replaceChildren(...games.map(game => {
    const hue = Array.from(game.id).reduce((value, letter) => value + letter.charCodeAt(0), 0) % 360;
    const random = isRandomGame(game);
    // The "Random" card is built into the page; every other game's text is its builder's.
    const name = random ? I18n.t("ui.games.random_name", {}, game.name) : catalogGameLabel(game);
    const description = random ? I18n.t("ui.games.random_description", {}, game.description) : I18n.gameDescription(game.id, game.description);
    const initials = name.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0] || "").join("");
    return el("button", {type:"button", class:"library-card", "aria-pressed":String(game.id === selected),
      "aria-label":random ? `${name}. ${description}` : I18n.t("ui.games.open_aria", { name, players: gameCountLabel(game) }, `Open ${name}, ${gameCountLabel(game)}`),
      disabled:random && state.randomJoining,
      onclick:() => random ? joinRandomMatch() : openGamePage(game.id)},
      game.cover_url ? el("img", {class:"library-art", src:game.cover_url, alt:"", loading:"lazy", style:"object-fit:cover;width:100%;aspect-ratio:16/9"}) : el("span", {class:"library-art", style:`--art-hue:${hue}`, "aria-hidden":"true"},
        el("span", {class:"library-monogram", textContent:initials}),
        el("span", {class:"library-art-label", textContent:I18n.t("ui.app_name", {}, "Game platform").toUpperCase()})),
      el("span", {class:"library-copy"}, el("span", {class:"library-mode", textContent:gameCountLabel(game)}),
        el("span", {class:"library-title", textContent:name}),
        el("span", {class:"library-description", textContent:description || I18n.t("ui.games.default_description", {}, "Choose this game to start a new match.")}),
        el("span", {class:"library-select", textContent:random ? (state.randomJoining ? I18n.t("ui.games.finding_match", {}, "Finding a match…") : I18n.t("ui.games.random_join", {}, "Join a random match ↗")) : I18n.t("ui.games.open_game", {}, "Open game ↗")})));
  }));
}

function renderRecentGames() {
  const section = $("recent-games-section");
  if (!section) return;
  const row = $("recent-games");
  const games = me()
    ? state.recentGames.filter(game => game.published !== false)
    : [];
  section.hidden = games.length === 0;
  const gameIds = games.map(game => game.id).join("\u0000");
  if (row.dataset.gameIds !== gameIds) {
    row.dataset.gameIds = gameIds;
    row.scrollLeft = 0;
  }
  row.replaceChildren(...gameCarouselCards(games));
  scheduleGamesCarouselUpdate("recent-games");
}

function gameCarouselCards(games, ranked = false) {
  return games.map((game, index) => {
    const hue = Array.from(game.id).reduce((value, letter) => value + letter.charCodeAt(0), 0) % 360;
    const name = catalogGameLabel(game);
    const initials = name.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0] || "").join("");
    return el("button", {
      type: "button",
      class: "popular-game-card",
      "aria-label": I18n.t("ui.games.open_aria", {name, players: gameCountLabel(game)}, `Open ${name}, ${gameCountLabel(game)}`),
      onclick: () => openGamePage(game.id),
    },
      ...(ranked ? [el("span", {class: "popular-game-rank", textContent: String(index + 1)})] : []),
      el("span", {class: "popular-game-art", style: `--art-hue:${hue}`, "aria-hidden": "true"},
        el("span", {class: "popular-game-monogram", textContent: initials})),
      el("span", {class: "popular-game-copy"},
        el("span", {class: "popular-game-title", textContent: name}),
        el("span", {class: "popular-game-players", textContent: gameCountLabel(game)}),
        el("span", {class: "popular-game-open", textContent: I18n.t("ui.games.open_game", {}, "Play game ↗")})));
  });
}

function renderPopularGames() {
  const section = $("popular-games-section");
  if (!section) return;
  const row = $("popular-games");
  const previousScrollLeft = row.scrollLeft;
  // The API returns Firestore's descending score order. Keep it intact so
  // rank 1 is always the first card in the carousel.
  const rankedGames = state.popularGames.filter(game => game.published !== false);
  const hasRanking = rankedGames.length > 0;
  // The aggregate is intentionally populated from match starts. Before its first
  // score arrives, keep this row useful with catalog games and explain the state.
  const games = hasRanking
    ? rankedGames
    : state.games.filter(game => game.published !== false).slice(0, 8);
  section.hidden = games.length === 0;
  $("popular-games-eyebrow").hidden = !hasRanking;
  $("popular-games-metric").textContent = hasRanking
    ? I18n.t("ui.games.popularity_metric", {}, "Ranked by players in started matches")
    : state.popularGamesStatus === "unavailable"
      ? I18n.t("ui.games.popularity_unavailable", {}, "Showing games while popularity data loads.")
      : I18n.t("ui.games.popularity_collecting", {}, "Popularity rankings will appear as matches start.");
  row.replaceChildren(...gameCarouselCards(games, hasRanking));
  row.scrollLeft = previousScrollLeft;
  scheduleGamesCarouselUpdate("popular-games");
}

const gamesCarouselSchedulers = new Map();

function scheduleGamesCarouselUpdate(id) {
  gamesCarouselSchedulers.get(id)?.();
}

function updateGamesCarousel(id) {
  const row = $(id);
  const previous = $(`${id}-prev`);
  const next = $(`${id}-next`);
  if (!row || !previous || !next) return;
  const maxScroll = Math.max(0, row.scrollWidth - row.clientWidth);
  const canScroll = maxScroll > 2;
  previous.hidden = next.hidden = !canScroll;
  previous.disabled = !canScroll || row.scrollLeft <= 2;
  next.disabled = !canScroll || row.scrollLeft >= maxScroll - 2;
}

function setupGamesCarousel(id) {
  const row = $(id);
  const previous = $(`${id}-prev`);
  const next = $(`${id}-next`);
  if (!row || !previous || !next) return;
  let updateFrame = 0;
  const schedule = () => {
    if (updateFrame) return;
    updateFrame = requestAnimationFrame(() => {
      updateFrame = 0;
      updateGamesCarousel(id);
    });
  };
  gamesCarouselSchedulers.set(id, schedule);
  const scroll = direction => {
    const distance = Math.max(row.clientWidth * 0.8, 180);
    row.scrollBy({left: direction * distance, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"});
  };
  previous.addEventListener("click", () => scroll(-1));
  next.addEventListener("click", () => scroll(1));
  row.addEventListener("scroll", schedule, {passive: true});
  window.addEventListener("resize", schedule, {passive: true});
  if ("ResizeObserver" in window) new ResizeObserver(schedule).observe(row);
  schedule();
}

function setupPopularGamesCarousel() {
  setupGamesCarousel("recent-games");
  setupGamesCarousel("popular-games");
}

function renderGameSearch() {
  renderLibrary();
  const input = $("game-search");
  const selected = state.games.find((game) => game.id === $("new-game").value);
  if (!state.gameSearchOpen) input.value = selected?.name ?? state.gameSearchQuery;
  input.setAttribute("aria-expanded", String(state.gameSearchOpen));
  $("game-search-popup").hidden = !state.gameSearchOpen;
  const query = state.gameSearchQuery.trim().toLocaleLowerCase();
  const results = [RANDOM_GAME, ...state.games].filter((game) =>
    `${game.name} ${game.description || ""}`.toLocaleLowerCase().includes(query));
  state.filteredGames = results;
  state.gameSearchActive = Math.min(state.gameSearchActive, Math.max(0, state.filteredGames.length - 1));
  const key = JSON.stringify([state.gameSearchOpen, state.gameSearchQuery, state.gameSearchActive,
    results.map((game) => [game.id, game.version, catalogGameLabel(game)])]);
  if (key === state.gameSearchKey) return;
  state.gameSearchKey = key;
  input.setAttribute("aria-activedescendant", state.gameSearchOpen && state.filteredGames.length ? `game-result-${state.gameSearchActive}` : "");
  $("game-results").replaceChildren(...state.filteredGames.map((game, index) => el("button", {
    id: `game-result-${index}`, type: "button", role: "option", tabIndex: -1,
    class: "game-option", "aria-selected": String(index === state.gameSearchActive),
    onclick: () => isRandomGame(game) ? joinRandomMatch() : openGamePage(game.id),
  }, el("span", {class: "game-option-copy"},
    el("span", {textContent: isRandomGame(game) ? game.name : catalogGameLabel(game)}),
    ...(game.description ? [el("span", {class: "game-option-description", textContent: game.description})] : [])),
    el("small", {textContent: gameCountLabel(game)}))));
  $("game-results-note").textContent = results.length === 0 ? I18n.t("ui.portal.no_matching", {}, "No matching games. Try a different name.")
    : query
      ? I18n.plural("ui.portal.results_found", results.length, {}, {one: "1 game found. Scroll to browse all matches, or type to filter. Use arrow keys and Enter to open or join a game.", many: `${results.length} games found. Scroll to browse all matches, or type to filter. Use arrow keys and Enter to open or join a game.`})
      : I18n.plural("ui.portal.results_available", results.length, {}, {one: "1 game available. Scroll to browse the full catalog, or type to filter. Use arrow keys and Enter to open or join a game.", many: `${results.length} games available. Scroll to browse the full catalog, or type to filter. Use arrow keys and Enter to open or join a game.`});
}

function revealPortalSection(id) {
  const node = $(id);
  if (!node?.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  node.getAnimations?.().forEach(animation => animation.cancel());
  node.animate?.([{opacity:.45, transform:'translateY(5px)'}, {opacity:1, transform:'translateY(0)'}],
    {duration:180, easing:'ease-out'});
}

function browseAllGames() {
  if (!state.gameSearchOpen) state.gameSearchOriginal = $("new-game").value;
  $("game-search").value = "";
  onGameSearchInput();
  $("game-search").focus();
  revealPortalSection("game-search-popup");
}

function closeGameSearch(restore = false) {
  if (!state.gameSearchOpen) return;
  if (restore && !$("new-game").value && state.games.some((game) => game.id === state.gameSearchOriginal)) $("new-game").value = state.gameSearchOriginal;
  state.gameSearchOpen = false;
  if (restore || $("new-game").value) state.gameSearchQuery = "";
  renderGameSearch();
  updateMatchSetup();
}

function onGameSearchInput() {
  state.gameSearchOpen = true;
  state.gameSearchQuery = $("game-search").value;
  state.gameSearchActive = 0;
  $("new-game").value = "";
  renderGameSearch();
  updateMatchSetup();
  if (StoragePages.search("/games", me(), state.gameSearchQuery)) {
    clearTimeout(state.catalogSearchTimer);
    state.catalogSearchTimer = setTimeout(refresh, 300);
  }
}

function onGameSearchKey(event) {
  if (event.key === "Escape") { event.preventDefault(); closeGameSearch(true); return; }
  if (event.key === "Enter" && state.gameSearchOpen) {
    event.preventDefault();
    const game = state.filteredGames[state.gameSearchActive];
    if (game) isRandomGame(game) ? joinRandomMatch() : openGamePage(game.id);
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const wasOpen = state.gameSearchOpen;
    state.gameSearchOpen = true;
    if (wasOpen) state.gameSearchActive = (state.gameSearchActive + (event.key === "ArrowDown" ? 1 : -1) + Math.max(1, state.filteredGames.length)) % Math.max(1, state.filteredGames.length);
    renderGameSearch();
    $(`game-result-${state.gameSearchActive}`)?.scrollIntoView?.({block:"nearest"});
  }
}

function renderMatchList(node, matches) {
  // Keep the native details/summary nodes stable: polling must not reopen groups,
  // move keyboard focus, or replace unchanged buttons while someone is clicking.
  // The language is part of the key: the rows' badges, names and "N moves" are text built here.
  const key = JSON.stringify([matches, state.selectedId, [...state.nameCache],
    matches.map((m) => gameMetaOf(m.game_id, m.game_version)?.name), I18n.revision()]);
  if (node.dataset.key === key) return;
  node.dataset.key = key;
  node.replaceChildren(...(matches.length ? matches.map(matchItem)
    : [el("div", {class: "empty-note", textContent: I18n.t("ui.match.no_matches", {}, "No matches here.")})]));
}

// The selected match

/** Rebuilds a player-count select with [counts], keeping the current choice
 * when it is still offered and otherwise falling back to [fallback] of the
 * counts — the smallest for pass-and-play, the largest for computer matches,
 * which are the counts those flows used before the choice existed. The
 * select's label is hidden when the game offers fewer than two counts. */
function fillPlayerCounts(select, label, counts, fallback) {
  const previous = Number(select.value);
  select.replaceChildren(
    ...counts.map((count) => el("option", { value: String(count), textContent: String(count) })),
  );
  select.value = counts.length
    ? String(counts.includes(previous) ? previous : fallback(...counts))
    : "";
  label.hidden = counts.length < 2;
}

function updateMatchSetup() {
  const detailPage = Boolean(state.detailGameId);
  if (detailPage && !state.detailCreatorInitialized) {
    $("match-creator").open = false;
    state.detailCreatorInitialized = true;
  } else if (!detailPage) {
    state.detailCreatorInitialized = false;
  }
  const game = state.games.find((game) => game.id === (detailPage ? state.detailGameId : $("new-game").value));
  updateGamePopularity(detailPage && !state.selectedId ? game : null);
  const browsingGames = detailPage && $("match-creator").open;
  document.body?.classList.toggle("game-detail-mode", detailPage);
  $("game-catalog").hidden = detailPage && !browsingGames;
  $("game-detail-page").hidden = !detailPage || browsingGames || Boolean(state.selectedId);
  $("show-creator").hidden = detailPage;
  const maximum = game ? Math.max(...game.allowed_player_counts) - 1 : 0;
  $("create").disabled = !me() || !game || state.creating || !navigator.onLine;
  // Practice stays clickable while logged out: practice() sends the
  // visitor to the login page and back, rather than dead-ending here.
  $("practice").disabled = !game;
  fillPlayerCounts($("practice-player-count"), $("practice-count-choice"), game?.allowed_player_counts ?? [], Math.min);
  fillPlayerCounts($("computer-player-count"), $("computer-count-choice"), game?.allowed_player_counts.filter((count) => count > 1) ?? [], Math.max);
  $("practice-offline-note").hidden = false;
  const gameVersion=game && gameOf(game.id,game.version);
  const supportsComputerMatch=Boolean(gameVersion?.server_code && game.allowed_player_counts.some(count=>count>1));
  $("computer-match-option").hidden=!supportsComputerMatch;
  $("play-computers").disabled=!game || state.creating || !navigator.onLine;
  const solo = game?.allowed_player_counts.length === 1 && maximum === 0;
  $("speed-choice").hidden = solo;
  updateStakePreview();
  $("create").textContent = solo ? I18n.t("ui.portal.play_solo", {}, "Play solo ↗") : I18n.t("ui.portal.create_match", {}, "Create match ↗");
  $("selected-game-card").hidden = !game;
  const canGiveFeedback = Boolean(game && me() && game.owner_user_id && game.owner_user_id !== me().id && !isRandomGame(game));
  $("feedback-game").hidden = !canGiveFeedback;
  $("feedback-game").onclick = canGiveFeedback ? () => openFeedback({type: "game", id: game.id, name: I18n.gameName(game.id, game.name)}) : null;
  $("selected-game-name").textContent = (game && I18n.gameName(game.id, game.name)) || I18n.t("ui.games.choose", {}, "Choose a game");
  $("selected-game-description").textContent = (game && I18n.gameDescription(game.id, game.description)) || "";
  $("selected-game-mode").textContent = solo ? I18n.t("ui.games.solo_label", {}, "1 player · solo") : game ? I18n.t("ui.portal.mode_players", {counts: game.allowed_player_counts.join(", ")}, `${game.allowed_player_counts.join(", ")} players`) : "";
  $("create-hint").textContent = solo ? I18n.t("ui.portal.hint_solo", {}, "Starts immediately. No opponent needed.") : game ? I18n.t("ui.portal.hint_invite_friends", {}, "Create a match, then invite friends to join.") : state.games.length ? I18n.t("ui.portal.hint_choose", {}, "Choose a game from the search results to continue.") : I18n.t("ui.portal.hint_choose", {}, "Choose a game from the search results to continue.");
}

function selectMatch(id) {
  if (id === state.selectedId) return;
  state.selectedId = id;
  frame.unload();state.loaded = null;
  if (id) $("game-box").textContent = I18n.t("ui.portal.loading_game", {}, "Loading game…");
  const saved = offline.read();
  saved.selectedId = id;
  offline.writeCache(saved);
  state.replay = null;
  state.match = null;
  state.armed = null;
  state.lastSent = null;
  if (!state.detailGameId) $("match-creator").open = false;
  showMessage("");
  const route = new URLSearchParams();
  if (state.detailGameId) route.set("game", state.detailGameId);
  if (id) route.set("match", id);
  const routeHash = route.toString();
  history.replaceState(null, "", routeHash ? `#${routeHash}` : "#");
  refresh();
}

function showMessage(text, kind = "") {
  $("match-message").textContent = text;
  $("match-message").className = `message ${kind}`;
}

function actionButton(
  label,
  run,
  { primary = false, danger = false, confirm = null, disabled = false } = {},
) {
  const armed = confirm && state.armed === label;
  return el("button", {
    type: "button",
    class: primary ? "primary" : danger ? "danger" : "",
    disabled,
    textContent: armed ? I18n.t("ui.match.click_again", {label}, `${label}: click again to confirm`) : label,
    title: confirm ?? "",
    onclick: async () => {
      if (confirm && !armed) {
        state.armed = label;
        showMessage(confirm, "error");
        render();
        return;
      }
      state.armed = null;
      try {
        await run();
        showMessage("");
      } catch (error) {
        showMessage(error.message, "error");
      }
      await refresh();
    },
  });
}

function playerPicture(player) {
  if (player.kind !== "computer") {
    const account = me();
    return (account?.id === player.user_id ? account.picture_url : null) ||
      state.pictureCache.get(player.user_id) || "/static/avatars/users/puppy/puppy-natural-classic-open.png";
  }
  const animals = ["puppy", "bird", "cat", "bunny", "fox", "bear", "panda", "frog", "penguin", "otter"];
  return `/static/avatars/computers/${animals[Array.from(player.id || `computer-${player.player_index + 1}`).reduce((sum, char) => sum + char.codePointAt(0), 0) % animals.length]}.png`;
}

function renderMatch() {
  const match = state.match;
  const user = me();
  $("match").hidden = !match;
  $("placeholder").hidden = Boolean(match);
  if (!match) {
    window.PortalMatchLayout?.update(null);
    $("placeholder").textContent = user
      ? I18n.t("ui.portal.placeholder", {}, "Your match will open here. You can also select a match from the sidebar.")
      : I18n.t("ui.portal.sign_in_to_play", {}, "Sign in at the top right, then choose a game above.");
    return;
  }
  const game = gameOf(match.game_id, match.game_version);
  updateMatchCurrency(match, user);
  const rulesText = game?.translations?.[I18n.locale()]?.game_logic_rules || game?.game_logic_rules || "";
  if ($("how-to-play")) {
    $("how-to-play").hidden = !rulesText && !game?.tutorial_html;
    $("game-rules-text").textContent = rulesText;
    const tutorial = $("game-tutorial");
    const tutorialKey = game?.tutorial_html ? JSON.stringify([game.id,game.version,I18n.locale(),game.tutorial_html]) : '';
    if (tutorial && tutorial.dataset.source !== tutorialKey) {
      tutorial.dataset.source = tutorialKey;
      tutorial.replaceChildren();
      if (game?.tutorial_html) {
        const frame = document.createElement("iframe");
        frame.title = I18n.t("ui.portal.tutorial_title", {}, "Game tutorial");
        frame.setAttribute("sandbox", "allow-scripts");
        frame.referrerPolicy = "no-referrer";
        frame.loading = "lazy";
        frame.style.cssText = "width:100%;height:480px;border:0;background:white";
        frame.srcdoc = TutorialFrame.documentSource(game.tutorial_html,
          game.translations?.[I18n.locale()]?.tutorial_strings || {},
          I18n.locale(), I18n.locale()==='ar'?'rtl':'ltr');
        tutorial.append(frame);
      }
    }
  }
  const counts = game ? game.allowed_player_counts : [];
  const ownerName = nameOf(match.owner_user_id);
  $("match-title").textContent =
    I18n.t("ui.match.title", {name: game ? I18n.gameName(game.id, game.name) : "?", version: match.game_version}, `${game ? I18n.gameName(game.id, game.name) : "?"} (version ${match.game_version})`);
  const outcome = matchOutcome(match, user?.id);
  $("match-result").hidden = !outcome;
  $("match-result").textContent = outcome?.label || "";
  $("match-result").className = `match-result result-${outcome?.kind || "neutral"}`;
  $("match-status").textContent = I18n.t(`status.${match.status}`, {}, match.status.replaceAll("_", " "));
  $("match-status").className = `badge ${match.status}`;
  const meta = [
    I18n.t("ui.match.owner", {name: ownerName}, `owner ${ownerName}`),
    I18n.t("ui.match.moves_meta", {count: match.move_count}, `${match.move_count} moves`),
    I18n.t("ui.match.created", {time: formatTime(match.created_at)}, `created ${formatTime(match.created_at)}`),
  ];
  if (match.turn_seconds)
    meta.push(I18n.t("ui.speed.meta", {minutes: match.turn_seconds / 60}, `speed · ${match.turn_seconds / 60} min per move`));
  if (match.end_reason)
    meta.push(
      match.end_reason === "finished"
        ? I18n.t("ui.match.ended_game", {}, "ended by the game")
        : match.end_reason === "timed_out"
          ? I18n.t("ui.speed.ended_meta", {}, "ended because time ran out")
          : match.end_reason === "solo_computers_only"
            ? I18n.t("error.solo_computers_only", {}, "Computer opponents are available in single-player matches only.")
          : I18n.t("ui.match.ended_left", {}, "ended because a player left"),
    );
  if (game && game.deleted) meta.push(I18n.t("ui.match.game_deleted", {}, "this game has been deleted"));
  else if (game?.published === false) meta.push(I18n.t("ui.match.unpublished", {}, "unpublished · existing participants only"));
  $("match-meta").textContent = meta.join(" · ");

  const mySeat = user ? seatOf(match, user.id) : null;
  const turn = match.turn_of_player_indices ?? [];
  $("seats").replaceChildren(
    ...match.players.map((player) =>
      el("span", {
        class: `seat-chip${turn.includes(player.player_index) ? " turn" : ""}`,
      }, el("img", {class: "player-avatar", src: playerPicture(player), alt: "", width: 44, height: 44,
        onerror: event => { event.target.hidden = true; }}), el("span", {textContent:
          `${playerName(player)}${player === mySeat ? " · " + I18n.t("ui.match.seat_you", {}, "You") : ""}` +
          `${turn.includes(player.player_index) ? " — " + I18n.t("ui.match.to_move", {}, "to move") : ""}`,
      }), canRemovePlayer(match, player, user) ? actionButton(
        I18n.t("ui.match.remove_player", {}, "Remove"),
        async () => portalRequest("DELETE", `/matches/${match.id}/players/${player.user_id}`, {user}),
        {danger: true, confirm: I18n.t("ui.match.remove_player_confirm", {name: playerName(player)},
          `Remove ${playerName(player)} from this match? They can't join it again.`)},
      ) : null, canReportPlayer(match, player, user) ? el("button", {
        type: "button", class: "feedback-report", textContent: I18n.t("ui.feedback.report_short", {}, "⚑ Report"),
        title: I18n.t("ui.feedback.report_player", {}, "Report player"),
        "aria-label": I18n.t("ui.feedback.report_player_named", {name: playerName(player)}, `Report player ${playerName(player)}`),
        onclick: () => openFeedback({type: "user", id: player.user_id, name: playerName(player)}, {kind: "problem", chooseKind: false}),
      }) : null),
    ),
  );

  const actions = [];
  const secondaryActions = [];
  if (match.localMode) {
    if (match.status === "ongoing") actions.push(actionButton(I18n.t("ui.match.end_practice", {}, "End practice"), async()=>{offline.endPractice(match.id);state.lastSent=null;}));
    else if (match.resumeTurn) actions.push(actionButton(I18n.t("ui.match.resume_practice", {}, "Resume practice"),async()=>{offline.resumePractice(match.id);state.lastSent=null;}));
    secondaryActions.push(actionButton(I18n.t("ui.match.remove_practice", {}, "Remove practice from list"),async()=>{await portalRequest("DELETE",`/matches/${match.id}`);selectMatch(null);},{danger:true,confirm:I18n.t("ui.match.remove_practice_confirm", {}, "Archive this practice and remove it from your list?")}));
  }
  // Both API versions can practice on-device, without tokens or server writes.
  if (game?.code)
    secondaryActions.push(
      actionButton(I18n.t("ui.match.new_practice", {}, "Start a new practice"), async () => {
        // A local match's new practice mirrors its own mode and size; from a
        // server match it is a pass-and-play game at that match's size.
        const practiceMatch = await offline.practice(game, match.localMode ?? "pass", match.players.length);
        selectMatch(practiceMatch.id);
      }),
    );
  if ($("match-message").dataset.offline === "true") {
    showMessage("");
    delete $("match-message").dataset.offline;
  }
  if (match.pending) {
    showMessage(
      I18n.t("ui.match.pending_sync", {count: match.pending}, `${match.pending} move(s) saved on this device, awaiting sync.`),
    );
    $("match-message").dataset.offline = "true";
  }
  if (match.conflict) {
    showMessage(match.conflict.message, "error");
    $("match-message").dataset.offline = "true";
    actions.push(
      actionButton(
        I18n.t("ui.match.use_server", {}, "Use server version"),
        async () => {
          offline.resolve(match.id);
          state.lastSent = null;
        },
        {
          confirm: I18n.t("ui.match.use_server_confirm", {}, "Archive your offline moves and restore the server version?"),
        },
      ),
    );
    actions.push(
      actionButton(I18n.t("ui.match.download_offline", {}, "Download offline moves"), async () => {
        const blob = new Blob(
          [JSON.stringify(offline.read().queues[match.id], null, 2)],
          { type: "application/json" },
        );
        const url = URL.createObjectURL(blob);
        const a = el("a", { href: url, download: "offline-moves.json" });
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }),
    );
  }
  const isOwner = !match.localMode && user && match.owner_user_id === user.id;
  const latest = state.games.find((item) => item.id === match.game_id);
  const path = `/matches/${match.id}`;
  const call =
    (method, suffix = "", body = undefined) =>
    async () => {
      const result = await portalRequest(method, path + suffix, {user, body});
      if ((method === "POST" && suffix === "/start") ||
          (method === "POST" && suffix === "/join" && result?.status === "ongoing")) {
        invalidatePopularGames();
        invalidateRecentGames();
        invalidateGamePopularity(result?.game_id);
      }
      if (method === "DELETE") selectMatch(null);
      return result;
    };
  if (user && isJoinable(match, user.id)) {
    actions.push(
      actionButton(I18n.t("ui.action.join", {}, "Join"), call("POST", "/join"), { primary: true }),
    );
  }
  if (match.status === "waiting_for_players") {
    if (isOwner) {
      if (latest && latest.version > match.game_version && latest.allowed_player_counts.length === 1 && latest.allowed_player_counts[0] === 1) {
        actions.push(actionButton(I18n.t("ui.match.play_latest_solo", {}, "Play latest solo version"), async () => {
          $("new-game").value = latest.id;
          renderGameSearch();
          updateMatchSetup();
          await createMatch();
        }, {primary: true}));
      }
      const computers = match.players.filter((player) => player.kind === "computer").length;
      const paidMatch = (match.bet_per_player ?? 0) > 0;
      const humanCount = match.players.filter(player => player.kind === "human" && player.active !== false).length;
      if (paidMatch) {
        actions.push(el("p", {class:"paid-lobby-hint", textContent: computers ?
          I18n.t("ui.match.paid_needs_humans", {}, "Paid matches need human opponents. Remove the computer to continue.") :
          I18n.t("ui.match.paid_invite_human", {}, "Invite a human player to join this token match.")}));
        if (computers > 0) actions.push(actionButton(I18n.t("ui.match.remove_computer", {}, "Remove computer"), call("PATCH", "", {num_computer_opponents: computers - 1})));
      } else if (computers > 0) {
        actions.push(actionButton(I18n.t("ui.match.remove_computers", {}, "Remove computers for multiplayer"), call("PATCH", "", {num_computer_opponents: 0})));
      }
      if (computers > 0 && !paidMatch) {
        actions.push(el("p", {class:"paid-lobby-hint", textContent:I18n.t("ui.match.computers_single_player", {}, "With computer opponents this match is single-player: friends can't join it. Remove the computers to play with other people.")}));
      }
      const readyToStart = counts.includes(match.players.length) && (!paidMatch || computers === 0) && (computers === 0 || humanCount === 1);
      actions.push(actionButton(I18n.t("ui.match.start_game", {}, "Start game"), call("POST", "/start"), {primary:true, disabled:!readyToStart}));
      secondaryActions.push(actionButton(I18n.t("ui.match.delete_match", {}, "Delete match"), call("DELETE"), {danger:true, confirm:I18n.t("ui.match.delete_confirm", {}, "Delete this match for everyone?")}));
    } else if (mySeat) {
      actions.push(
        actionButton(I18n.t("ui.action.leave", {}, "Leave"), call("POST", "/leave"), { danger: true }),
      );
      secondaryActions.push(actionButton(I18n.t("ui.match.delete_match", {}, "Delete match"), call("DELETE"), {danger:true, confirm:I18n.t("ui.match.delete_confirm", {}, "Delete this match for everyone?")}));
    }
  } else if (match.status === "ongoing" && mySeat && !match.localMode) {
    if (game && game.server_code) {
      // Leaving a match: the server first previews what leaving
      // would pay back (the game's playerLeft, or the platform's
      // split), and only a confirmed click applies that exact preview
      // — so the amount is always shown, staked match or not.
      actions.push(
        actionButton(I18n.t("ui.action.leave", {}, "Leave"), async () => {
          const preview = await portalRequest("POST", `${path}/maybeLeave`, { user });
          const payout = preview.pending_leave_payout ?? 0;
          const ends = preview.pending_leave_ends_match
            ? " " + I18n.t("ui.match.leave_ends_all", {}, "Leaving ends the match for everyone.")
            : "";
          if (!confirm(I18n.t("ui.match.leave_refund", {payout}, `You will get ${payout} tokens back — leave?`) + ends)) return;
          await portalRequest("POST", `${path}/playerLeft`, { user });
        }, { danger: true }),
      );
    } else {
      const confirm =
        game && game.allows_leave_mid_match
          ? I18n.t("ui.match.leave_confirm_takeover", {}, "Leave? A computer takes over your seat.")
          : I18n.t("ui.match.leave_confirm_ends", {}, "Leave? This game doesn't allow leaving, so the match ends for everyone.");
      actions.push(
        actionButton(I18n.t("ui.action.leave", {}, "Leave"), call("POST", "/leave"), { danger: true, confirm }),
      );
    }
  } else if (match.status === "over") {
    if (mySeat && !match.localMode) {
      const playingSoloWithComputers =
        match.players.filter((player) => player.kind === "human").length === 1 &&
        match.players.some((player) => player.kind === "computer");
      actions.push(actionButton(
        playingSoloWithComputers
          ? I18n.t("ui.match.play_again", {}, "Play again")
          : match.rematch_match_id
            ? I18n.t("ui.match.join_rematch", {}, "Join rematch")
            : I18n.t("ui.match.request_rematch", {}, "Request rematch"),
        async () => {
          const rematch = await portalRequest(
            "POST",
            `/matches/${match.id}/rematch`,
            {user},
          );
          selectMatch(rematch.id);
        },
        {primary:true},
      ));
    }
    if (mySeat && !match.localMode)
      actions.push(actionButton(I18n.t("ui.match.hide_from_list", {}, "Hide from my list"), call("DELETE")));
  }
  if (mySeat && !match.localMode && match.status === "ongoing") {
    secondaryActions.push(
      actionButton(I18n.t("ui.match.delete_match", {}, "Delete match"), call("DELETE"), {
        danger: true,
        confirm: I18n.t("ui.match.delete_ongoing_confirm", {}, "Delete this ongoing match for everyone?"),
      }),
    );
  }
  if (!match.localMode)
    actions.push(
      el("button", {
        type: "button",
        textContent: I18n.t("ui.match.invite_friends", {}, "Invite friends"),
        onclick: async () => {
          let link;
          try {
            // A private match only seats people through an invite token; elsewhere a
            // link with the sender's id as "ref" counts whoever signs up as invited by them.
            link = match.private && mySeat
              ? (await portalRequest("POST", `/matches/${match.id}/invites`, {})).url
              : Auth.current() && Auth.inviteLink
                ? Auth.inviteLink(Auth.current(), `match=${match.id}`)
                : `${location.origin}/portal#match=${match.id}`;
            await navigator.clipboard.writeText(link);
            toast(I18n.t("ui.match.invite_copied", {}, "✓ Invite link copied"));
          } catch (error) {
            showMessage(link || error.message, link ? "" : "error");
          }
        },
      }),
    );
  if (user && !match.localMode) {
    const gameName = game ? I18n.gameName(game.id, game.name) : I18n.t("ui.feedback.a_game", {}, "a game");
    secondaryActions.push(el("button", {type: "button", class: "feedback-action", textContent: I18n.t("ui.feedback.match", {}, "Send feedback about this match"),
      onclick: () => openFeedback({type: "match", id: match.id, name: gameName})}));
    if (game && game.owner_user_id !== user.id)
      secondaryActions.push(el("button", {type: "button", class: "feedback-action", textContent: I18n.t("ui.feedback.game", {}, "Feedback on this game"),
        onclick: () => openFeedback({type: "game", id: match.game_id, name: gameName})}));
  }
  if (secondaryActions.length) {
    const menu = el("details", {class:"match-more", open:state.moreActionsMatch === match.id},
      el("summary", {"aria-label":I18n.t("ui.match.more_actions", {}, "More match actions"), textContent:"⋯"}),
      el("div", {class:"match-more-panel"}, ...secondaryActions));
    menu.addEventListener?.("toggle", () => {
      if (menu.isConnected) {
        const newlyOpened = menu.open && state.moreActionsMatch !== match.id;
        state.moreActionsMatch = menu.open ? match.id : null;
        if (menu.open) {
          const panel = menu.querySelector(".match-more-panel"), rect = menu.getBoundingClientRect();
          const width = panel.getBoundingClientRect().width, height = panel.getBoundingClientRect().height;
          panel.style.left = Math.max(8,Math.min(rect.left,window.innerWidth-width-8))+"px";
          panel.style.top = Math.max(8,Math.min(rect.bottom+8,window.innerHeight-height-8))+"px";
          if (newlyOpened && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            panel.animate?.([{opacity:.3, translate:'0 -5px'}, {opacity:1, translate:'0 0'}],
              {duration:180, easing:'ease-out'});
          }
        }
      }
    });
    actions.push(menu);
  }
  $("actions").replaceChildren(...actions);

  const waiting = match.status === "waiting_for_players";
  $("waiting").hidden = !waiting;
  if (waiting) {
    const allowed = counts.length ? counts.join(", ") : "?";
    const ready = counts.includes(match.players.length);
    const seated = match.players.length;
    if (ready) $("match-status").textContent = I18n.t("ui.match.ready_to_start", {}, "ready to start");
    const ownerStarts = I18n.t("ui.match.owner_starts", {}, "The owner starts the match.");
    $("waiting").textContent = ready
      ? (seated === 1 ? I18n.t("ui.match.ready_one", {}, "Ready to start with 1 player.") : I18n.t("ui.match.ready_many", {count: seated}, `Ready to start with ${seated} players.`)) +
        " " + (isOwner ? I18n.t("ui.match.press_start", {}, "Press Start to play.") : ownerStarts)
      : I18n.t("ui.match.waiting_players_info", {seated, allowed}, `Waiting for players: ${seated} seated, this game plays with ${allowed}.`) +
        " " + (isOwner ? I18n.t("ui.match.wait_then_start", {}, "Invite others to join, then start.") : ownerStarts);
    if (latest && latest.version > match.game_version) {
      $("waiting").textContent += " " + I18n.t("ui.match.newer_version", {match_version: match.game_version, latest_version: latest.version},
        `This match uses version ${match.game_version}; the latest game is version ${latest.version}. Create a new match to use its updated rules.`);
    }
  }
  $("game-box").hidden = waiting;
  window.PortalSpeed?.observe(match);
  updateSpeedClock();
  const speedNotice = window.PortalSpeed?.notice(match, user?.id, nameOf);
  const joinNotice = user && !mySeat && !match.localMode && match.status !== "over" &&
      match.players.some((player) => player.kind === "computer")
    ? I18n.t("ui.match.computers_no_join", {}, "This match has computer opponents, so it can't be joined. A match is played either against computers or against other people.")
    : null;
  window.PortalMatchLayout?.update(
    speedNotice || joinNotice
      ? {...match, ...(speedNotice ? {speedNotice} : {}), ...(joinNotice ? {joinNotice} : {})}
      : match);
}

// The 10-second alert for the player to move (sound, vibration, tab title, notification).
const speedAlerter = window.PortalSpeed?.createAlerter({
  window, document, navigator,
  Notification: typeof Notification === "undefined" ? undefined : Notification,
  AudioContext: window.AudioContext ?? window.webkitAudioContext,
  setInterval: (f, ms) => setInterval(f, ms), clearInterval: (t) => clearInterval(t),
});

/** The speed-match countdown in the toolbar (hidden in regular matches and replays).
 * When the viewer's own time is up, asks the server right away, so the takeover (or
 * the end) shows without waiting for the next poll. */
function updateSpeedClock() {
  const node = $("match-clock");
  const match = state.match;
  const speed = window.PortalSpeed;
  const shown = speed && match && state.replay?.id !== match.id ? speed.clock(match, me()?.id, nameOf) : null;
  node.hidden = !shown;
  if (!shown) {
    speedAlerter?.stop();
    return;
  }
  if (node.textContent !== shown.text) node.textContent = shown.text;
  node.classList.toggle("urgent", shown.urgent);
  speedAlerter?.update(match, me()?.id, gameOf(match.game_id, match.game_version)?.name ?? "");
  const key = `${match.id}@${match.turn_deadline}`;
  if (speed.secondsLeft(match) === 0 && state.speedRefreshFor !== key) {
    state.speedRefreshFor = key;
    refresh();
  }
}

function render() {
  renderLists();
  renderMatch();
  renderHistory();
}

// The game iframe

async function gameCode(match) {
  const key = `${match.game_id}@${match.game_version}`;
  let game = state.gameCache.get(key);
  if (!game?.code) game = await fetchGameVersion(match.game_id, match.game_version);
  return game.code;
}

async function browseHistory(direction) {
  const match = state.match;
  if (!match || !match.move_count) return;
  if (direction === "live") state.replay = null;
  else try {
    if (await StoragePages.enabled() && !match.localMode) {
      const current = state.replay?.id === match.id ? state.replay.index : match.move_count;
      let index = Math.max(0, Math.min(match.move_count, current + direction));
      const data = await portalRequest("GET", `/v2/matches/${match.id}/history?start=${Math.max(0,index-1)}&limit=1`, {user:me()});
      if (state.match?.id !== match.id) return;
      const minimum = data.initial_turn_player_indices === null ? 1 : 0;
      index = Math.max(minimum,index);
      const move = index === 0 ? {new_state:data.initial_state,next_turn_player_indices:data.initial_turn_player_indices} : data.items[0];
      if (move) state.replay = {id:match.id,index,minimum,move};
    } else {
    const data = await portalRequest("GET", `/matches/${match.id}/history`, {user: me()});
    const moves = data.moves;
    const minimum = data.initial_turn_player_indices === null ? 1 : 0;
    if (state.match?.id !== match.id) return;
    const current = state.replay?.id === match.id ? state.replay.index : moves.length;
    const index = Math.max(minimum, Math.min(moves.length, current + direction));
    const move = index === 0 ? {new_state: data.initial_state, next_turn_player_indices: data.initial_turn_player_indices} : moves[index - 1];
    if (!move) return;
    state.replay = {id: match.id, index, minimum, move};
    }
  } catch (error) { showMessage(I18n.t("ui.portal.history_unavailable", {message: error.message}, `History unavailable: ${error.message}`), "error"); return; }
  renderHistory();await syncGame();
}
function renderHistory() {
  const match = state.match, replay = state.replay?.id === match?.id ? state.replay : null;
  const count = match?.move_count || 0;
  $("match-history").hidden = count < 1;
  $("history-position").textContent = replay ? I18n.t("ui.portal.viewing_move", {index: replay.index, count}, `Viewing move ${replay.index} of ${count} · read only`) : I18n.plural("ui.portal.live_moves", count, {}, {one: "Live · 1 move", many: `Live · ${count} moves`});
  $("history-back").disabled = (replay?.index ?? count) <= (replay?.minimum ?? 0);
  $("history-forward").disabled = !replay || replay.index >= count;
  $("history-live").disabled = !replay;
}

// Texts the script built (badges, buttons, lists, the offline line in the sidebar) are redrawn in
// the new language, and the open game is sent its texts in it now, not at the next poll.
function redrawAfterLanguageChange() {
  try {
    renderPortalAccountMenu();
    render();
    renderLibrary();
    updateMatchSetup();
    offlineStatus();
    syncGame().catch((error) => console.warn("Couldn't send the game its new language:", error));
  } catch (error) {
    console.warn("Couldn't redraw after a language change:", error);
  }
}

async function syncGame() {
  const match = state.match;
  if (!match || match.status === "waiting_for_players") {
    if (state.loaded) frame.unload();
    state.loaded = null;
    state.lastSent = null;
    return;
  }
  const key = `${match.id}@${match.game_id}@${match.game_version}`;
  if (state.loaded !== key) {
    const userId = me()?.id;
    const code = await gameCode(match);
    if (state.match?.id !== match.id || me()?.id !== userId) return;
    frame.load(code);
    state.loaded = key;
    state.lastSent = null;
  }
  const user = me();
  const mySeat =
    match.localMode === "pass"
      ? { player_index: match.turn_of_player_indices?.[0] ?? 0 }
      : user
        ? seatOf(match, user.id)
        : null;
  const replay = state.replay?.id === match.id ? state.replay : null;
  const view = replay ? {...match, state: replay.move.new_state, turn_of_player_indices: replay.move.next_turn_player_indices, move_count: replay.index, status: replay.move.next_turn_player_indices === null ? "over" : "ongoing", end_reason: replay.move.next_turn_player_indices === null ? "finished" : null} : match;
  const currentGame = gameOf(match.game_id, match.game_version);
  const message = stateChangedMessage({
    state: view.state,
    // A client renders its viewFor view, which is what [state] holds
    // for a participant; spectators get the game's public view.
    view: view.state ?? null,
    players: match.players.map((player) => ({
      player_index: player.player_index,
      player_id: player.id,
      kind: player.kind,
      name: playerName(player),
      picture_url: playerPicture(player),
    })),
    turn: view.turn_of_player_indices,
    status: view.status,
    // Old game clients understand only finished and player_left.
    endReason: view.end_reason && view.end_reason !== "finished" ? "player_left" : view.end_reason,
    moveCount: view.move_count,
    mySeat: mySeat ? mySeat.player_index : null,
  });
  message.token_pot = view.token_pot ?? 0;
  // Let game UIs distinguish a historical snapshot from a live opponent turn.
  message.replay = replay ? { index: replay.index, total: match.move_count } : null;
  // The viewer's language and, for a game with a string table, its texts in that language.
  Object.assign(message, await I18n.gameText(match.game_id, match.game_version));
  const json = JSON.stringify(message);
  if (json !== state.lastSent) {
    state.lastSent = json;
    frame.send(message);
  }
}

async function onMakeMove(move) {
  if (state.moveInFlight || state.replay?.id === state.match?.id) return;
  const receivedFor = state.match;
  if (!receivedFor || state.loaded !== `${receivedFor.id}@${receivedFor.game_id}@${receivedFor.game_version}`) return;
  state.moveInFlight = true;
  try {
    await portalLock(async () => {
      const match = state.match,
        user = me();
      if (match?.id !== receivedFor.id) return;
      if ("move" in move) {
        // A game sends only its move: the server validates and applies
        // it, so the client checks nothing but whose turn it is.
        if (!canMove(match, user?.id))
          throw new Error(I18n.t("ui.error.not_your_turn", {}, "It isn't your turn."));
        if (match.localMode) {
          const updated = await offline.practiceMove(match, move.move);
          if (state.match?.id === match.id) state.match = updated;
          state.lastSent = null;
          return;
        }
        if (offline.read().queues?.[match.id]?.length) {
          // A move is already waiting to sync. It carries no resulting
          // state, so a second click is a decision on the same stale
          // view — queueing it behind the first could only conflict once
          // the server answers. Drop it and push the pending move
          // instead; the game replays from the synced state.
          await offline.sync({ force: true });
          return;
        }
        state.match = await offline.submitMove(match, {
          move: move.move,
          expected_move_count: match.move_count,
        });
        state.lastSent = null;
        return;
      }
      // Anything else (a client-computed state, a next-turn claim) is
      // not a move: every game runs on the server, so there is nothing
      // to submit. Ignore it.
    });
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    state.moveInFlight = false;
    state.lastSent = null;
    await refresh();
  }
}

function goToLogin() {
  // Everyone plays under an account (a guest account takes seconds), so a
  // logged-out tap on a play action goes to the login page instead of
  // dead-ending on a message — and comes back to this exact page after.
  const back = location.pathname + location.search + location.hash;
  location.assign(`/?next=${encodeURIComponent(back)}`);
}

async function practice() {
  if (state.creating) return;
  const user = me();
  if (!user) {
    goToLogin();
    return;
  }
  let match;
  state.creating = true;
  $("practice").disabled = true;
  try {
    // The game on screen: on a game page (including a #game= link) that is
    // the detail game; elsewhere it is the search selection. A linked game
    // may not be in the loaded catalog yet — fetch its entry on demand
    // rather than refusing.
    let game = state.games.find(
      (g) => g.id === (state.detailGameId || $("new-game").value),
    );
    if (!game && state.detailGameId) {
      try {
        game = await portalRequest(
          "GET",
          `/games/${encodeURIComponent(state.detailGameId)}`,
          { force: true },
        );
        state.games.push(game);
      } catch {
        // The entry could not be loaded; the message below stands.
      }
    }
    if (!game) throw new Error(I18n.t("ui.portal.choose_game_search_first", {}, "Choose a game from the search results first."));
    // Pass-and-play runs the game's code on this device, so the full game
    // must be saved here. When it is not, download it as part of this tap:
    // the forced fetch makes its network attempt even inside the offline
    // layer's retry backoff, which only exists to keep background polls
    // from hammering a dead connection. A game already saved on the device
    // is served from that copy, online or off.
    let full = gameOf(game.id, game.version);
    if (!full?.server_code) {
      $("create-message").textContent = I18n.t("ui.portal.downloading_game", {}, "Downloading the game…");
      $("create-message").className = "message";
      try {
        full = await portalRequest(
          "GET",
          `/games/${game.id}/versions/${game.version}`,
          { force: true },
        );
      } catch (error) {
        if (error.notSaved)
          throw new Error(I18n.t("ui.portal.practice_needs_download", {}, "This game isn't saved on this device yet. Connect to the internet and try again: it downloads once, then plays on this device any time."));
        throw error;
      }
      state.gameCache.set(`${full.id}@${full.version}`, full);
    }
    match = await offline.practice(full, "pass", Number($("practice-player-count").value) || undefined);
    if (navigator.onLine) {
      try {
        await portalRequest(
          "POST",
          `/users/me/recent-games/${encodeURIComponent(game.id)}`,
          {user},
        );
        invalidateRecentGames();
      } catch {
        // Local practice remains playable if account history cannot be saved.
      }
    }
    $("create-message").textContent = "";
    selectMatch(match.id);
  } catch (error) {
    $("create-message").textContent = match
      ? I18n.t("ui.portal.created_not_started_lobby", {message: error.message}, `Match created, but couldn't start automatically: ${error.message}. You can retry Start from the lobby.`)
      : error.message;
    $("create-message").className = "message error";
    if (match) selectMatch(match.id);
  } finally {
    state.creating = false;
    renderLists();
  }
}

// Creating matches

async function createMatch() {
  if (state.creating) return;
  const user = me();
  if (!user) {
    $("create-message").textContent = I18n.t("ui.portal.log_in_first", {}, "Log in first.");
    $("create-message").className = "message error";
    return;
  }
  if (!state.games.some((game) => game.id === $("new-game").value)) {
    $("create-message").textContent = I18n.t("ui.portal.choose_game_search_first", {}, "Choose a game from the search results first.");
    return;
  }
  let match;
  state.creating = true;
  $("create").disabled = true;
  const game = state.games.find((item) => item.id === $("new-game").value);
  try {
    const bet = Number($("match-stake").value);
    if (!Number.isSafeInteger(bet) || bet < 0) throw new Error(I18n.t("ui.portal.invalid_stake", {}, "Invalid token stake"));
    if (bet > 0 && game?.allowed_player_counts?.length === 1 && game.allowed_player_counts[0] === 1) throw new Error(I18n.t("ui.portal.stake_needs_multiplayer", {}, "Token stakes require a multiplayer match"));
    match = await portalRequest("POST", "/matches", {
      user,
      body: {
        game_id: $("new-game").value,
        num_computer_opponents: 0,
        bet_per_player: Number($("match-stake").value),
        ...(window.PortalSpeed?.createFields($("match-speed").value) ?? {}),
      },
    });
    // Solo-only games have no lobby or second seat to wait for. Start the pinned
    // version returned by the server; if the catalog changed, leave Start available.
    if (game && game.version === match.game_version && game.allowed_player_counts.length === 1 && game.allowed_player_counts[0] === 1 && match.players.length === 1) {
      match = await portalRequest("POST", `/matches/${match.id}/start`, {user, body: {first_turn_player_indices: [0]}});
      invalidatePopularGames();
      invalidateRecentGames();
      invalidateGamePopularity(match.game_id);
    }
    $("create-message").textContent = "";
    selectMatch(match.id);
  } catch (error) {
    if (match) selectMatch(match.id);
    $("create-message").textContent = match ? I18n.t("ui.portal.created_not_started", {message: error.message}, `Match created, but couldn't start automatically: ${error.message}. Press Start to retry.`) : error.message;
    $("create-message").className = "message error";
  } finally {
    state.creating = false;
    renderLists();
  }
}

async function playWithAllComputers() {
  if (state.creating) return;
  const user=me();
  const game=state.games.find(item=>item.id===(state.detailGameId || $("new-game").value));
  if (!user) {
    goToLogin();
    return;
  }
  if (!game) {
    $("create-message").textContent=I18n.t("ui.portal.choose_game_first", {}, "Choose a game first.");
    $("create-message").className="message error";
    return;
  }
  const chosenCount=Number($("computer-player-count").value);
  const playerCount=chosenCount>1 && game.allowed_player_counts.includes(chosenCount)
    ? chosenCount
    : Math.max(...game.allowed_player_counts.filter(count=>count>1));
  if (!Number.isFinite(playerCount)) {
    $("create-message").textContent=I18n.t("ui.portal.needs_two_seats", {}, "This game needs at least two player seats.");
    $("create-message").className="message error";
    return;
  }
  let match;
  state.creating=true;
  $("play-computers").disabled=true;
  $("play-computers").textContent=I18n.t("ui.portal.starting_match", {}, "Starting match…");
  $("create-message").textContent=I18n.plural("ui.portal.starting_computers", playerCount-1, {}, {one: "Starting a free match against 1 computer…", many: `Starting a free match against ${playerCount-1} computers…`});
  $("create-message").className="message";
  try {
    const cachedGame=gameOf(game.id,game.version);
    const full=cachedGame?.code ? cachedGame : await fetchGameVersion(game.id,game.version);
    if (!full.server_code) throw new Error(I18n.t("ui.portal.computers_server_only", {}, "Play with computers is available for server-side games."));
    match=await portalRequest("POST","/matches",{user,body:{game_id:game.id,num_computer_opponents:playerCount-1,bet_per_player:0}});
    match=await portalRequest("POST",`/matches/${match.id}/start`,{user,body:{first_turn_player_indices:[0]}});
    invalidatePopularGames();
    invalidateRecentGames();
    invalidateGamePopularity(match.game_id);
    $("create-message").textContent="";
    selectMatch(match.id);
  } catch(error) {
    $("create-message").textContent=match
      ? I18n.t("ui.portal.created_not_started", {message: error.message}, `Match created, but couldn't start automatically: ${error.message}. Press Start to retry.`)
      : error.message;
    $("create-message").className="message error";
    if (match) selectMatch(match.id);
  } finally {
    state.creating=false;
    $("play-computers").textContent=I18n.t("ui.portal.computers_button", {}, "Play with computers ↗");
    renderLists();
  }
}

function selectFromHash() {
  const id = new URLSearchParams(location.hash.slice(1)).get("match");
  if (id && id !== state.selectedId) selectMatch(id);
  openInviteFromHash();
}

// Match invite links (POST /matches/{id}/invites): /portal#invite=<token> shows who
// sent it and the match, and accepting takes the seat, even in a private match. People
// without an account log in or continue as a guest first (a guest created from the
// link credits its sender; see auth.js), then get the dialog again.
let inviteDialog = null;

function closeInviteDialog() {
  inviteDialog?.remove();
  inviteDialog = null;
}

function finishInvite(matchId) {
  state.pendingInvite = null;
  closeInviteDialog();
  if (new URLSearchParams(location.hash.slice(1)).has("invite"))
    history.replaceState(null, "", state.detailGameId ? `#game=${encodeURIComponent(state.detailGameId)}` : "#");
  if (matchId) selectMatch(matchId);
}

async function openInviteFromHash() {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get("invite");
  if (fromHash) state.pendingInvite = fromHash;
  const token = state.pendingInvite;
  if (!token) return;
  let view;
  try {
    view = await apiRequest("GET", `/invites/${encodeURIComponent(token)}`, {user: me()});
  } catch (error) {
    if (state.pendingInvite !== token) return;
    finishInvite(null);
    showPageError(I18n.t("ui.invite.load_failed", {message: error.message}, `Couldn't open the invite: ${error.message}`));
    return;
  }
  if (state.pendingInvite !== token) return;
  const user = me();
  const match = view.match;
  if (user && match.players.some((player) => player.user_id === user.id)) {
    finishInvite(match.id);
    return;
  }
  closeInviteDialog();
  const gameName = I18n.gameName(match.game_id, view.game_name);
  const message = el("div", {class: "message", role: "status"});
  const box = el("div", {class: "auth-dialog", role: "dialog", "aria-modal": "true"},
    el("h2", {textContent: I18n.t("ui.invite.invited_you", {name: view.created_by_display_name, game: gameName},
      `${view.created_by_display_name} invited you to play ${gameName}`)}),
    message);
  const notNow = el("button", {type: "button", textContent: I18n.t("ui.invite.not_now", {}, "Not now"),
    onclick: () => finishInvite(null)});
  if (!view.usable) {
    message.textContent = view.unusable_reason;
    message.className = "message error";
    box.append(el("div", {style: "display:flex;gap:var(--space-sm);flex-wrap:wrap"}, notNow));
  } else {
    if (match.bet_per_player > 0)
      box.append(el("p", {class: "muted", textContent: I18n.t("ui.invite.stake", {tokens: match.bet_per_player},
        `This match stakes ${match.bet_per_player} tokens per player.`)}));
    let primary;
    if (!user) {
      box.append(el("p", {class: "muted", textContent: I18n.t("ui.invite.log_in_first", {}, "Log in or continue as a guest to take your seat.")}));
      primary = el("button", {type: "button", class: "primary", textContent: I18n.t("ui.invite.log_in", {}, "Log in to join"),
        onclick: () => {
          closeInviteDialog();
          Auth.openDialog();
        }});
    } else {
      primary = el("button", {type: "button", class: "primary", textContent: I18n.t("ui.invite.accept", {}, "Join match"),
        onclick: async () => {
          primary.disabled = true;
          try {
            const joined = await apiRequest("POST", `/invites/${encodeURIComponent(token)}/accept`, {user});
            if (joined?.status === "ongoing") {
              invalidatePopularGames();
              invalidateRecentGames();
              invalidateGamePopularity(joined.game_id);
            }
            finishInvite(joined.id);
          } catch (error) {
            message.textContent = error.message;
            message.className = "message error";
            primary.disabled = false;
          }
        }});
    }
    box.append(el("div", {style: "display:flex;gap:var(--space-sm);flex-wrap:wrap"}, primary, notNow));
  }
  inviteDialog = el("div", {class: "auth-dialog-backdrop"}, box);
  inviteDialog.onclick = (event) => {
    if (event.target === inviteDialog) finishInvite(null);
  };
  document.body.append(inviteDialog);
}

function shouldRestoreSavedMatch() {
  return !state.detailGameId && !location.hash;
}

async function main() {
  setupPopularGamesCarousel();
  window.PortalMatchLayout?.init(() => {
    selectMatch(null);
    render();
    syncGame();
    if (!state.detailGameId) $("match-creator").open = true;
    (state.detailGameId ? document.querySelector(".back-to-games") : $("game-search"))?.focus({preventScroll: true});
  });
  renderPortalAccountMenu();
  syncPortalRoutes();
  document.addEventListener("portal-skin-change", () => {
    renderPortalAccountMenu();
    syncPortalRoutes();
  });
  document.addEventListener("portal-layout-change", syncPortalRoutes);
  document.querySelector(".back-to-games")?.addEventListener("click", leaveGamePage);
  $("notify-toggle").addEventListener("click", toggleNotifications);
  document.addEventListener("i18n-changed", redrawAfterLanguageChange);
  document.addEventListener("auth-changed", () => {
    const invitedMatch = new URLSearchParams(location.hash.slice(1)).get("match");
    renderPortalAccountMenu();
    state.armed = null;
    state.lastSent = null;
    state.selectedId = me() && invitedMatch ? invitedMatch : null;
    state.match = null;
    state.myMatches = [];
    state.gameCache.clear();
    state.nameCache.clear();
    state.pictureCache.clear();
    state.recentGames = [];
    state.recentGamesFetchedAt = 0;
    state.recentGamesForceRefresh = true;
    state.recentGamesUserId = null;
    state.recentGamesRequestVersion += 1;
    frame.unload();
    state.loaded = null;
    if (!state.selectedId)
      history.replaceState(null, "", state.detailGameId ? `#game=${encodeURIComponent(state.detailGameId)}` : "#");
    showMessage("");
    refresh();
    setupNotifications();
    openInviteFromHash();
  });
  $("practice").addEventListener("click", practice);
  $("play-computers").addEventListener("click", playWithAllComputers);
  $("retry-sync").addEventListener("click", () => {
    offline.retryAfter = 0;
    state.lastSent = null;
    refresh();
  });
  const storageDetails = async () => {
    try {
      const info = offline.storageInfo();
      const estimate = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
      const kb = bytes => `${(bytes / 1024).toFixed(1)} KiB`;
      const {total, cache, queued, practice, archives} = Object.fromEntries(
        ["total", "cache", "queued", "practice", "archives"].map(key => [key, kb(info[key])]),
      );
      let text = I18n.t("ui.offline.storage_breakdown", {total, cache, queued, practice, archives, entries:info.entries},
        `This account: ${total}; cached responses ${cache} (${info.entries} entries); queued moves ${queued}; practice ${practice}; archives ${archives}.`) +
        (estimate?.quota
          ? I18n.t("ui.offline.storage_origin", {usage:kb(estimate.usage || 0), quota:kb(estimate.quota)}, ` Browser origin: ${kb(estimate.usage || 0)} of ${kb(estimate.quota)} (estimated, includes other site data).`)
          : I18n.t("ui.offline.storage_estimate_unavailable", {}, " Browser-wide estimate unavailable."));
      const list = items => items.map(item => `${item.path || item.key || item.id} (${kb(item.bytes)})`).join(", ");
      if (info.largest?.length)
        text += I18n.t("ui.offline.storage_largest", {list: list(info.largest)}, ` Largest responses: ${list(info.largest)}.`);
      if (info.nextToEvict)
        text += I18n.t("ui.offline.storage_next_evict", {path: info.nextToEvict}, ` Next to evict: ${info.nextToEvict}.`);
      if (info.perMatchQueue?.length)
        text += I18n.t("ui.offline.storage_queues", {list: list(info.perMatchQueue)}, ` Queued moves by match: ${list(info.perMatchQueue)}.`);
      if (info.perPractice?.length)
        text += I18n.t("ui.offline.storage_practice", {list: list(info.perPractice)}, ` Practice by match: ${list(info.perPractice)}.`);
      if (info.accounts?.length)
        text += I18n.t("ui.offline.storage_accounts", {list: list(info.accounts)}, ` All accounts on this device: ${list(info.accounts)}.`);
      if (info.otherKeys?.length)
        text += I18n.t("ui.offline.storage_other", {list: list(info.otherKeys)}, ` Other saved data: ${list(info.otherKeys)}.`);
      try {
        const sw = await offline.swCacheInfo?.();
        if (sw)
          text += I18n.t("ui.offline.storage_sw", {entries: sw.entries, size: kb(sw.bytes)}, ` Service worker cache: ${sw.entries} files, ${kb(sw.bytes)}.`);
      } catch {
        // The worker cache is diagnostics only; the account numbers stand.
      }
      $("storage-details").textContent = text;
    } catch (error) {
      $("storage-details").textContent = I18n.t("ui.offline.storage_inspection_failed", {message:error.message}, `Storage inspection failed: ${error.message}`);
    }
  };
  $("storage-refresh").addEventListener("click", storageDetails);
  $("storage-clear-cache").addEventListener("click", () => portalLock(async () => {
    offline.clearCache();
    await storageDetails();
  }).catch(error => { $("storage-details").textContent = I18n.t("ui.offline.storage_clear_failed", {message:error.message}, `Could not clear cache: ${error.message}`); }));
  document.querySelector(".offline-storage").addEventListener("toggle", event => {
    if (event.currentTarget.open) storageDetails();
  });
  window.addEventListener("online", () => {
    offline.retryAfter = 0;
    refresh();
  });
  window.addEventListener("offline", () => {
    offlineStatus();
    refresh();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
  $("match-creator").addEventListener("toggle", updateMatchSetup);
  window.addEventListener("storage", () => {
    state.lastSent = null;
    refresh();
  });
  $("new-game").addEventListener("change", updateMatchSetup);
  $("game-search").addEventListener("focus", () => {
    if (state.gameSearchOpen) return;
    state.gameSearchOriginal = $("new-game").value;
    state.gameSearchOpen = true;
    state.gameSearchQuery = "";
    state.gameSearchActive = 0;
    $("game-search").select();
    renderGameSearch();
  });
  $("game-search").addEventListener("input", onGameSearchInput);
  $("browse-games").addEventListener("click", browseAllGames);
  $("game-search").addEventListener("keydown", onGameSearchKey);
  $("game-chooser").addEventListener("focusout", (event) => {
    if (!$("game-chooser").contains(event.relatedTarget)) closeGameSearch();
  });
  document.addEventListener("click", (event) => {
    if (!$("game-chooser").contains(event.target)) closeGameSearch();
  });
  $("show-creator").addEventListener("click", () => {
    $("match-creator").open = true;
    $("match-creator").scrollIntoView({behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start"});
    $("game-search").focus({preventScroll: true});
  });
  document.querySelectorAll("[data-game-filter]").forEach(button => button.addEventListener("click", () => {
    state.libraryFilter = button.dataset.gameFilter;
    document.querySelectorAll("[data-game-filter]").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
    renderLibrary();
    revealPortalSection("game-library");
  }));
  document.querySelectorAll("[data-game-view]").forEach(button => button.addEventListener("click", () => {
    state.libraryView = button.dataset.gameView;
    document.querySelectorAll("[data-game-view]").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
    renderLibrary();
    revealPortalSection("game-library");
  }));
  $("reset-games").addEventListener("click", () => {
    state.libraryFilter = "all";
    document.querySelectorAll("[data-game-filter]").forEach(item => item.setAttribute("aria-pressed", String(item.dataset.gameFilter === "all")));
    browseAllGames();
  });
  $("proposal-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = $("proposal-status"),
      button = $("proposal-submit"),
      body = {
        game_name: $("proposal-name").value.trim(),
        description: $("proposal-description").value.trim(),
        rules_url: $("proposal-rules-url").value.trim(),
        proposer_name: $("proposal-proposer").value.trim(),
      };
    if (!body.game_name) return;
    button.disabled = true;
    status.textContent = "";
    try {
      await portalFetch("POST", "/game-proposals", { body });
      event.target.reset();
      status.textContent = I18n.t(
        "ui.proposal.thanks",
        {},
        "Thank you! Our AI agents will review your proposal and create the game within 24 hours.",
      );
    } catch {
      status.textContent = I18n.t(
        "ui.proposal.error",
        {},
        "Sorry, your proposal could not be submitted. Please try again.",
      );
    } finally {
      button.disabled = false;
    }
  });
  $("match-stake").addEventListener("change", updateStakePreview);
  $("create").addEventListener("click", createMatch);
  window.addEventListener("hashchange", selectFromHash);
  if (shouldRestoreSavedMatch() && offline.read().selectedId)
    history.replaceState(null, "", `#match=${offline.read().selectedId}`);
  const cached = offline.read();
  state.selectedId = new URLSearchParams(location.hash.slice(1)).get("match");
  state.games = cached.responses["/games"] || [];
  state.myMatches = [
    ...(cached.responses["/matches"] || []).map((m) => offline.decorate(m)),
    ...Object.values(cached.local),
  ];
  state.openMatches = cached.responses["/matches/open"] || [];
  // Render the catalog sections from the saved responses first, so a warm
  // load shows the game list, popular ranking and recent games immediately;
  // refresh() below re-fetches and re-renders with fresh data.
  state.popularGames = cached.responses["/games/popular?limit=8"] || [];
  state.recentGames = cached.responses["/users/me/recent-games"] || [];
  if (state.popularGames.length) state.popularGamesStatus = "ranked";
  // Tell refreshLocked this cached recent-games list already belongs to the
  // current account, so it does not wipe it before the fresh fetch lands.
  if (me()) state.recentGamesUserId = me().id;
  for (const [path, value] of Object.entries(cached.responses)) {
    const game = /^\/games\/([^/]+)\/versions\/(\d+)$/.exec(path);
    if (game) state.gameCache.set(`${game[1]}@${game[2]}`, value);
    const user = /^\/users\/([^/]+)$/.exec(path);
    if (user) { state.nameCache.set(user[1], value.display_name); state.pictureCache.set(user[1], value.picture_url); }
  }
  state.match =
    cached.local[state.selectedId] ||
    cached.responses[`/matches/${state.selectedId}`] ||
    null;
  if (state.match && !state.match.localMode)
    state.match = offline.decorate(state.match);
  render();
  openInviteFromHash();
  try {
    await syncGame();
  } catch (error) {
    showPageError(error.message);
  }
  // Start push setup first, so its /push/config fetch joins the same /batch
  // call as the catalog refresh below instead of a second one.
  setupNotifications();
  refresh();
  // The speed clock and sounds are only used inside a match view, so they
  // load after the first paint instead of blocking it. Both are already in
  // the service-worker shell cache.
  loadPortalScript("/static/portal-speed.js?v=2").catch(() => {});
  loadPortalScript("/static/portal-feedback.js?v=4").catch(() => {});
  setInterval(() => {
    if (!document.hidden && !state.moveInFlight) refresh();
  }, POLL_MS);
  setInterval(pollActiveMatch, MATCH_POLL_MS);
  setInterval(updateSpeedClock, 250);
  if ("serviceWorker" in navigator && !document.querySelector('meta[name="local-preview"]'))
    navigator.serviceWorker
      // Update checks must never be answered by a cached copy of the
      // worker script, and the page asks for a check itself — on load and
      // whenever the tab is shown again — instead of leaving discovery to
      // the browser's own throttled schedule. A found update then runs the
      // existing chain: skipWaiting, claim, and the shell-updated reload.
      .register("/static/portal-sw.js", { updateViaCache: "none" })
      .then(async (registration) => {
        const checkForUpdate = () =>
          registration.update().catch(() => {});
        checkForUpdate();
        document.addEventListener("visibilitychange", () => {
          if (!document.hidden) checkForUpdate();
        });
        await navigator.serviceWorker.ready;
        shellReady = true;
        offlineStatus();
      })
      .catch((error) =>
        showPageError(I18n.t("ui.offline.setup_failed", {message: error.message}, `Offline setup failed: ${error.message}`)),
      );
}

$("history-back").addEventListener("click", () => browseHistory(-1));
$("history-forward").addEventListener("click", () => browseHistory(1));
$("history-live").addEventListener("click", () => browseHistory("live"));
main();

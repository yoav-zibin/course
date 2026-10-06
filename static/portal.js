// Portal: list your matches, create, join, start, leave and delete them, and play them.
// The selected match's game runs in a sandboxed iframe; the page polls the server and
// sends the game state_changed whenever the match changes.

"use strict";

const $ = (id) => document.getElementById(id);
const POLL_MS = 2000;

const state = {
  allData: { users: [], game_versions: [], matches: [] },
  usersKey: "",
  myMatches: [],
  selectedId: null,
  match: null, // the selected match, from GET /matches/{id}
  armed: null, // an action waiting for a confirming second click
  codeCache: new Map(), // "game_id@version" -> code
  loaded: null, // "match_id@game_id@version" loaded in the iframe
  lastSent: null, // the last state_changed sent, as JSON
  moveInFlight: false,
  refreshing: false,
  refreshAgain: false,
};

const frame = new GameFrame($("game-box"), (move) => onMakeMove(move), (problem) => showMessage(problem, "error"));

// Data

function me() {
  return actingUser($("act-as"), state.allData.users);
}

function names() {
  return userNames(state.allData);
}

function gameVersion(gameId, version) {
  return state.allData.game_versions.find((game) => game.id === gameId && game.version === version) ?? null;
}

function playerName(player) {
  return player.user_id ? names().get(player.user_id) ?? shortId(player.user_id) : `Computer ${player.player_index + 1}`;
}

function seatOf(match, userId) {
  return match.players.find((player) => player.user_id === userId) ?? null;
}

/** The seat this viewer moves for now: their own turn, or a computer's turn if they play. */
function actingFor(match, userId) {
  if (match.status !== "ongoing" || match.turn_of_player_indices === null || !userId) return null;
  const seat = seatOf(match, userId);
  if (!seat) return null;
  const turn = match.turn_of_player_indices;
  if (turn.includes(seat.player_index)) return seat.player_index;
  const computer = turn.map((index) => match.players[index]).find((player) => player && player.kind === "computer");
  return computer ? computer.player_index : null;
}

function isJoinable(match, userId) {
  if (!userId || seatOf(match, userId)) return false;
  const game = gameVersion(match.game_id, match.game_version);
  if (!game) return false;
  const max = Math.max(...game.allowed_player_counts);
  if (match.status === "waiting_for_players") return match.players.length < max;
  if (match.status === "ongoing" && game.allows_join_mid_match) {
    return match.players.some((player) => player.kind === "computer") || match.players.length < max;
  }
  return false;
}

async function refresh() {
  if (state.refreshing) {
    // Refresh again once the current one finishes, so it sees the latest changes.
    state.refreshAgain = true;
    return;
  }
  state.refreshing = true;
  state.refreshAgain = false;
  try {
    state.allData = await fetchAllData();
    const usersKey = JSON.stringify(state.allData.users.map((user) => [user.id, user.display_name]));
    if (usersKey !== state.usersKey) {
      state.usersKey = usersKey;
      setUpActAs($("act-as"), state.allData.users, onUserChanged);
    }
    const user = me();
    state.myMatches = user ? await apiRequest("GET", "/matches", { user }) : [];
    if (state.selectedId) {
      try {
        state.match = await apiRequest("GET", `/matches/${state.selectedId}`);
      } catch (error) {
        if (error.status !== 404) throw error;
        showMessage("This match no longer exists.", "error");
        state.match = null;
      }
    }
    render();
    await syncGame();
    showPageError("");
  } catch (error) {
    showPageError(`Couldn't load data from the server: ${error.message}`);
  } finally {
    state.refreshing = false;
  }
  if (state.refreshAgain) await refresh();
}

function onUserChanged() {
  state.armed = null;
  state.lastSent = null;
  showMessage("");
  refresh();
}

// Lists

function matchItem(match) {
  const game = gameVersion(match.game_id, match.game_version);
  const user = me();
  const yourTurn = user && actingFor(match, user.id) !== null;
  const badges = [el("span", { class: `badge ${match.status}`, textContent: match.status.replaceAll("_", " ") })];
  if (yourTurn) badges.unshift(el("span", { class: "badge turn", textContent: "your move" }));
  return el(
    "button",
    {
      type: "button",
      class: "list-item",
      "aria-selected": String(match.id === state.selectedId),
      onclick: () => selectMatch(match.id),
    },
    el("div", { class: "title" }, game ? game.name : "?", ...badges),
    el("div", {
      class: "sub",
      textContent: `${match.players.map(playerName).join(", ")} · ${match.move_count} moves`,
    }),
  );
}

function renderLists() {
  const user = me();
  const groups = [
    ["Your move", (m) => user && actingFor(m, user.id) !== null],
    ["Ongoing", (m) => m.status === "ongoing"],
    ["Waiting for players", (m) => m.status === "waiting_for_players"],
    ["Over", (m) => m.status === "over"],
  ];
  const shown = new Set();
  const children = [];
  for (const [title, predicate] of groups) {
    const matches = state.myMatches.filter((m) => !shown.has(m.id) && predicate(m));
    matches.forEach((m) => shown.add(m.id));
    children.push(el("div", { class: "section-title", textContent: `${title} (${matches.length})` }));
    if (matches.length) children.push(...matches.map(matchItem));
  }
  if (!user) children.push(el("div", { class: "empty-note", textContent: "Choose a user to see their matches." }));
  $("my-matches").replaceChildren(...children);

  const open = user ? state.allData.matches.filter((m) => isJoinable(m, user.id)) : [];
  $("open-matches").replaceChildren(
    ...(open.length ? open.map(matchItem) : [el("div", { class: "empty-note", textContent: "None right now." })]),
  );

  const games = latestGames(state.allData).filter((game) => !game.deleted);
  const select = $("new-game");
  const previous = select.value;
  const key = JSON.stringify(games.map((game) => [game.id, game.version]));
  if (select.dataset.key !== key) {
    select.dataset.key = key;
    select.replaceChildren(...games.map((game) =>
      el("option", { value: game.id, textContent: `${game.name} (${game.allowed_player_counts.join(", ")} players)` })));
    if (games.some((game) => game.id === previous)) select.value = previous;
  }
  $("create").disabled = !user || games.length === 0;
}

// The selected match

function selectMatch(id) {
  if (id === state.selectedId) return;
  state.selectedId = id;
  state.match = null;
  state.armed = null;
  state.lastSent = null;
  showMessage("");
  history.replaceState(null, "", id ? `#match=${id}` : "#");
  refresh();
}

function showMessage(text, kind = "") {
  $("match-message").textContent = text;
  $("match-message").className = `message ${kind}`;
}

function actionButton(label, run, { primary = false, danger = false, confirm = null, disabled = false } = {}) {
  const armed = confirm && state.armed === label;
  return el("button", {
    type: "button",
    class: primary ? "primary" : danger ? "danger" : "",
    disabled,
    textContent: armed ? `${label}: click again to confirm` : label,
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

function renderMatch() {
  const match = state.match;
  const user = me();
  $("match").hidden = !match;
  $("placeholder").hidden = Boolean(match);
  if (!match) {
    $("placeholder").textContent = user
      ? "Pick a match on the left, or create one."
      : "Choose who to act as at the top right, then pick or create a match.";
    return;
  }
  const game = gameVersion(match.game_id, match.game_version);
  const counts = game ? game.allowed_player_counts : [];
  const ownerName = names().get(match.owner_user_id) ?? shortId(match.owner_user_id);
  $("match-title").textContent = `${game ? game.name : "?"} (version ${match.game_version})`;
  $("match-status").textContent = match.status.replaceAll("_", " ");
  $("match-status").className = `badge ${match.status}`;
  const meta = [`owner ${ownerName}`, `${match.move_count} moves`, `created ${formatTime(match.created_at)}`];
  if (match.end_reason) meta.push(match.end_reason === "finished" ? "ended by the game" : "ended because a player left");
  if (game && game.deleted) meta.push("this game has been deleted");
  $("match-meta").textContent = meta.join(" · ");

  const mySeat = user ? seatOf(match, user.id) : null;
  const turn = match.turn_of_player_indices ?? [];
  $("seats").replaceChildren(...match.players.map((player) =>
    el("span", {
      class: `seat-chip${turn.includes(player.player_index) ? " turn" : ""}`,
      textContent: `${player.player_index}: ${playerName(player)}${player === mySeat ? " (you)" : ""}` +
        `${turn.includes(player.player_index) ? " — to move" : ""}`,
    })));

  const actions = [];
  const isOwner = user && match.owner_user_id === user.id;
  const path = `/matches/${match.id}`;
  const call = (method, suffix = "", body = undefined) => () => apiRequest(method, path + suffix, { user, body });
  if (user && isJoinable(match, user.id)) {
    actions.push(actionButton("Join", call("POST", "/join"), { primary: true }));
  }
  if (match.status === "waiting_for_players") {
    if (isOwner) {
      const computers = match.players.filter((player) => player.kind === "computer").length;
      const max = Math.max(...counts, 0);
      actions.push(
        actionButton("− Computer", call("PATCH", "", { num_computer_opponents: computers - 1 }), { disabled: computers === 0 }),
        actionButton("+ Computer", call("PATCH", "", { num_computer_opponents: computers + 1 }), { disabled: match.players.length >= max }),
        actionButton("Start", call("POST", "/start"), { primary: true, disabled: !counts.includes(match.players.length) }),
        actionButton("Delete", call("DELETE"), { danger: true, confirm: "Delete this match for everyone?" }));
    } else if (mySeat) {
      actions.push(actionButton("Leave", call("POST", "/leave"), { danger: true }));
    }
  } else if (match.status === "ongoing" && mySeat) {
    const confirm = game && game.allows_leave_mid_match
      ? "Leave? A computer takes over your seat."
      : "Leave? This game doesn't allow leaving, so the match ends for everyone.";
    actions.push(actionButton("Leave", call("POST", "/leave"), { danger: true, confirm }));
  } else if (match.status === "over") {
    if (isOwner) actions.push(actionButton("Delete", call("DELETE"), { danger: true, confirm: "Delete this match for everyone?" }));
    else if (mySeat) actions.push(actionButton("Hide from my list", call("DELETE")));
  }
  if (isOwner && match.status === "ongoing") {
    actions.push(actionButton("Delete", call("DELETE"), { danger: true, confirm: "Delete this ongoing match for everyone?" }));
  }
  actions.push(el("button", {
    type: "button",
    textContent: "Copy link",
    onclick: () => navigator.clipboard.writeText(`${location.origin}/portal#match=${match.id}`).then(() => toast("Copied the link")),
  }));
  $("actions").replaceChildren(...actions);

  const waiting = match.status === "waiting_for_players";
  $("waiting").hidden = !waiting;
  if (waiting) {
    const allowed = counts.length ? counts.join(", ") : "?";
    $("waiting").textContent =
      `Waiting for players: ${match.players.length} seated, this game plays with ${allowed}. ` +
      (isOwner ? "Add computers or wait for others to join, then start." : "The owner starts the match.");
  }
  $("game-box").hidden = waiting;
}

function render() {
  renderLists();
  renderMatch();
}

// The game iframe

async function gameCode(match) {
  const key = `${match.game_id}@${match.game_version}`;
  if (!state.codeCache.has(key)) {
    const game = await apiRequest("GET", `/games/${match.game_id}/versions/${match.game_version}`);
    state.codeCache.set(key, game.code);
  }
  return state.codeCache.get(key);
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
    frame.load(await gameCode(match));
    state.loaded = key;
    state.lastSent = null;
  }
  const user = me();
  const mySeat = user ? seatOf(match, user.id) : null;
  const message = stateChangedMessage({
    state: match.state,
    players: match.players.map((player) => ({
      player_index: player.player_index,
      kind: player.kind,
      name: playerName(player),
    })),
    turn: match.turn_of_player_indices,
    status: match.status,
    endReason: match.end_reason,
    moveCount: match.move_count,
    mySeat: mySeat ? mySeat.player_index : null,
    actingFor: user ? actingFor(match, user.id) : null,
  });
  const json = JSON.stringify(message);
  if (json !== state.lastSent) {
    state.lastSent = json;
    frame.send(message);
  }
}

async function onMakeMove(move) {
  const match = state.match;
  const user = me();
  if (!match || state.moveInFlight) return;
  if (!user || actingFor(match, user.id) === null) {
    showMessage("Ignored a move from the game: it isn't your turn.", "error");
    return;
  }
  state.moveInFlight = true;
  try {
    state.match = await apiRequest("POST", `/matches/${match.id}/moves`, {
      user,
      body: { ...move, expected_move_count: match.move_count },
    });
    showMessage("");
  } catch (error) {
    // Another player's client may have submitted a computer's move first.
    if (!(error.status === 409 && error.message.startsWith("expected"))) {
      showMessage(`The server rejected the move: ${error.message}`, "error");
    }
  } finally {
    state.moveInFlight = false;
    state.lastSent = null;
    await refresh();
  }
}

// Creating matches

async function createMatch() {
  const user = me();
  try {
    const match = await apiRequest("POST", "/matches", {
      user,
      body: { game_id: $("new-game").value, num_computer_opponents: Number($("computers").value) || 0 },
    });
    $("create-message").textContent = "";
    selectMatch(match.id);
  } catch (error) {
    $("create-message").textContent = error.message;
    $("create-message").className = "message error";
  }
}

function selectFromHash() {
  const id = new URLSearchParams(location.hash.slice(1)).get("match");
  if (id && id !== state.selectedId) selectMatch(id);
}

async function main() {
  $("create").addEventListener("click", createMatch);
  window.addEventListener("hashchange", selectFromHash);
  selectFromHash();
  await refresh();
  setInterval(refresh, POLL_MS);
}

main();

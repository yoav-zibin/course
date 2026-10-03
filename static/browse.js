// Browse page: shows every user, game (with all versions) and match (with all moves)
// from /debug/all-data.

"use strict";

const AUTO_REFRESH_KEY = "game-platform.browse.auto-refresh";
const AUTO_REFRESH_MS = 2000;

const state = {
  allData: null,
  // Keys of rows whose details are open, kept across refreshes.
  expanded: new Set(),
  loadedAt: null,
};

const $ = (id) => document.getElementById(id);

function json(value) {
  return JSON.stringify(value, null, 2);
}

function tag(text, kind = text) {
  return el("span", { class: `tag ${kind}`, textContent: text });
}

function yesNo(value) {
  return value ? "yes" : "no";
}

/** A table whose rows can be filtered and, if they have [detail], expanded. */
function renderTable(container, countNode, columns, rows) {
  const filter = $("filter").value.trim().toLowerCase();
  const visible = rows.filter((row) => !filter || row.text.toLowerCase().includes(filter));
  countNode.textContent =
    visible.length === rows.length ? `${rows.length}` : `${visible.length} of ${rows.length}`;
  if (!visible.length) {
    const message = rows.length ? `No rows match "${filter}".` : "None yet.";
    container.replaceChildren(el("div", { class: "empty", textContent: message }));
    return;
  }
  const body = el("tbody");
  for (const row of visible) {
    const expandable = Boolean(row.detail);
    const expanded = expandable && state.expanded.has(row.key);
    const tr = el(
      "tr",
      {
        class: [expandable ? "row" : "", expanded ? "expanded" : ""].join(" "),
        onclick: expandable ? () => toggle(row.key) : undefined,
      },
      row.cells.map((cell, index) =>
        el("td", { class: columns[index].class ?? "" }, cell ?? ""),
      ),
    );
    body.append(tr);
    if (expanded) {
      body.append(el("tr", { class: "detail" }, el("td", { colSpan: columns.length }, row.detail())));
    }
  }
  container.replaceChildren(
    el(
      "table",
      {},
      el("thead", {}, el("tr", {}, columns.map((column) => el("th", { class: column.class ?? "", textContent: column.title })))),
      body,
    ),
  );
}

function toggle(key) {
  if (state.expanded.has(key)) state.expanded.delete(key);
  else state.expanded.add(key);
  render();
}

function render() {
  const data = state.allData;
  if (!data) return;
  const names = userNames(data);
  const nameOf = (userId) => names.get(userId) ?? shortId(userId);
  const games = latestGames(data);
  const gamesById = new Map(games.map((game) => [game.id, game]));
  const versionsById = new Map();
  for (const game of data.game_versions) {
    if (!versionsById.has(game.id)) versionsById.set(game.id, []);
    versionsById.get(game.id).push(game);
  }

  renderUsers(data, games);
  renderGames(data, games, versionsById, nameOf);
  renderMatches(data, gamesById, nameOf);
}

function renderUsers(data, games) {
  const columns = [
    { title: "Name" },
    { title: "ID" },
    { title: "Password" },
    { title: "Games owned", class: "num" },
    { title: "Matches", class: "num" },
    { title: "Created", class: "time" },
  ];
  const rows = data.users.map((user) => {
    const ownedGames = games.filter((game) => game.owner_user_id === user.id && !game.deleted);
    const matches = data.matches.filter(
      (match) =>
        match.owner_user_id === user.id ||
        match.players.some((player) => player.user_id === user.id),
    );
    return {
      key: `user:${user.id}`,
      text: `${user.display_name} ${user.id}`,
      cells: [
        user.display_name,
        idChip(user.id),
        copyable(user.password),
        ownedGames.length,
        matches.length,
        formatTime(user.created_at),
      ],
    };
  });
  renderTable($("users"), $("users-count"), columns, rows);
}

function renderGames(data, games, versionsById, nameOf) {
  const columns = [
    { title: "Name" },
    { title: "ID" },
    { title: "Version", class: "num" },
    { title: "Owner" },
    { title: "Player counts" },
    { title: "Leave mid-match" },
    { title: "Join mid-match" },
    { title: "Status" },
    { title: "Matches", class: "num" },
    { title: "Created", class: "time" },
    { title: "Updated", class: "time" },
  ];
  const rows = games.map((game) => {
    const matches = data.matches.filter((match) => match.game_id === game.id);
    return {
      key: `game:${game.id}`,
      text: `${game.name} ${game.id} ${nameOf(game.owner_user_id)} ${game.deleted ? "deleted" : "live"}`,
      cells: [
        game.name,
        idChip(game.id),
        game.version,
        nameOf(game.owner_user_id),
        game.allowed_player_counts.join(", "),
        yesNo(game.allows_leave_mid_match),
        yesNo(game.allows_join_mid_match),
        game.deleted ? tag("deleted") : tag("live"),
        matches.length,
        formatTime(game.created_at),
        formatTime(game.updated_at),
      ],
      detail: () => gameDetail(versionsById.get(game.id), matches),
    };
  });
  renderTable($("games"), $("games-count"), columns, rows);
}

function gameDetail(versions, matches) {
  const versionRows = [...versions].reverse().map((version) => {
    const usedBy = matches.filter((match) => match.game_version === version.version).length;
    return el(
      "tr",
      {},
      el("td", { class: "num", textContent: version.version }),
      el("td", { textContent: version.name }),
      el("td", { class: "wrap", textContent: version.description }),
      el("td", { textContent: version.allowed_player_counts.join(", ") }),
      el("td", { textContent: yesNo(version.allows_leave_mid_match) }),
      el("td", { textContent: yesNo(version.allows_join_mid_match) }),
      el("td", { class: "num", textContent: usedBy }),
      el("td", { class: "time", textContent: formatTime(version.updated_at) }),
      el(
        "td",
        { class: "wrap" },
        el(
          "details",
          {},
          el("summary", { textContent: `${version.code.length} chars` }),
          el("pre", { class: "json", textContent: version.code }),
        ),
      ),
    );
  });
  return el(
    "div",
    {},
    el("div", { class: "detail-title", textContent: "Versions (newest first)" }),
    el(
      "table",
      {},
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          ["Version", "Name", "Description", "Player counts", "Leave", "Join", "Matches", "Saved", "Code"].map(
            (title) => el("th", { textContent: title }),
          ),
        ),
      ),
      el("tbody", {}, versionRows),
    ),
  );
}

function seats(match, nameOf) {
  return el(
    "span",
    {},
    match.players.map((player, index) => [
      index ? ", " : "",
      el("span", {
        class: `seat${player.player_index === match.turn_of_player_index ? " turn" : ""}`,
        title: player.player_index === match.turn_of_player_index ? "Has the turn" : "",
        textContent: `${player.player_index}:${player.user_id ? nameOf(player.user_id) : "computer"}`,
      }),
    ]),
  );
}

function renderMatches(data, gamesById, nameOf) {
  const columns = [
    { title: "ID" },
    { title: "Game" },
    { title: "Owner" },
    { title: "Status" },
    { title: "End reason" },
    { title: "Players (turn underlined)" },
    { title: "Moves", class: "num" },
    { title: "Hidden for" },
    { title: "Created", class: "time" },
    { title: "Updated", class: "time" },
  ];
  const rows = data.matches.map((match) => {
    const game = gamesById.get(match.game_id);
    const gameName = game ? game.name : "?";
    const players = match.players.map((player) => (player.user_id ? nameOf(player.user_id) : "computer"));
    return {
      key: `match:${match.id}`,
      text: [match.id, gameName, nameOf(match.owner_user_id), match.status, match.end_reason ?? "", ...players].join(" "),
      cells: [
        idChip(match.id),
        `${gameName} v${match.game_version}`,
        nameOf(match.owner_user_id),
        tag(match.status),
        match.end_reason ?? "",
        seats(match, nameOf),
        match.move_count,
        match.hidden_for_user_ids.map(nameOf).join(", "),
        formatTime(match.created_at),
        formatTime(match.updated_at),
      ],
      detail: () => matchDetail(match, nameOf),
    };
  });
  renderTable($("matches"), $("matches-count"), columns, rows);
}

function matchDetail(match, nameOf) {
  const consoleLink = `/console#${new URLSearchParams({ op: "GET /matches/{match_id}", match_id: match.id })}`;
  const moveRows = match.moves.map((move) => {
    const seat = match.players.find((player) => player.player_index === move.player_index);
    const seatName = seat && seat.user_id ? nameOf(seat.user_id) : "computer";
    return el(
      "tr",
      {},
      el("td", { class: "num", textContent: move.move_number }),
      el("td", { textContent: `${move.player_index} (${seatName} now)` }),
      el("td", { textContent: nameOf(move.made_by_user_id) }),
      el("td", { class: "time", textContent: formatTime(move.created_at) }),
      el("td", { class: "num", textContent: move.next_turn_player_index ?? "end" }),
      el("td", { class: "wrap" }, el("pre", { textContent: JSON.stringify(move.new_state) })),
    );
  });
  return el(
    "div",
    { class: "detail-grid" },
    el(
      "div",
      {},
      el("div", { class: "detail-title", textContent: "Current state" }),
      el("pre", { class: "json", textContent: json(match.state) }),
      el("p", {}, el("a", { href: consoleLink, textContent: "Open in API console" })),
    ),
    el(
      "div",
      {},
      el("div", { class: "detail-title", textContent: "Moves" }),
      moveRows.length
        ? el(
            "table",
            {},
            el(
              "thead",
              {},
              el(
                "tr",
                {},
                ["#", "Seat", "Submitted by", "At", "Next turn", "New state"].map((title) =>
                  el("th", { textContent: title }),
                ),
              ),
            ),
            el("tbody", {}, moveRows),
          )
        : el("div", { class: "empty", textContent: "No moves yet." }),
    ),
  );
}

async function refresh() {
  try {
    const allData = await fetchAllData();
    state.loadedAt = new Date();
    $("error").textContent = "";
    // Re-rendering resets open code sections and text selections, so only do it when
    // something changed.
    if (JSON.stringify(allData) !== JSON.stringify(state.allData)) {
      state.allData = allData;
      render();
    }
  } catch (error) {
    $("error").textContent = `Couldn't load data: ${error.message}`;
  }
  renderFreshness();
}

function renderFreshness() {
  $("freshness").textContent = state.loadedAt ? `Loaded ${formatTime(state.loadedAt.toISOString())}` : "Loading…";
}

let autoRefreshTimer = null;
function setAutoRefresh(enabled) {
  localStorage.setItem(AUTO_REFRESH_KEY, enabled ? "1" : "");
  clearInterval(autoRefreshTimer);
  autoRefreshTimer = enabled ? setInterval(refresh, AUTO_REFRESH_MS) : null;
}

function main() {
  $("filter").addEventListener("input", render);
  $("refresh").addEventListener("click", refresh);
  const autoRefresh = $("auto-refresh");
  autoRefresh.checked = Boolean(localStorage.getItem(AUTO_REFRESH_KEY));
  autoRefresh.addEventListener("change", () => setAutoRefresh(autoRefresh.checked));
  setAutoRefresh(autoRefresh.checked);
  renderFreshness();
  refresh();
}

main();

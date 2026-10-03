// API console: lists the operations from /openapi.json, builds a form for the selected
// one, sends it with the chosen X-User-Id and X-User-Password headers and shows the
// response. Passwords returned by POST /users are remembered in localStorage.

"use strict";

const USER_STORAGE_KEY = "game-platform.user-id";
const PASSWORDS_STORAGE_KEY = "game-platform.passwords";
const GROUP_ORDER = ["users", "games", "matches"];
const MAX_HISTORY = 50;

const state = {
  spec: null,
  operations: [],
  selected: null,
  // Per-operation form contents, so switching operations doesn't lose edits.
  drafts: new Map(),
  allData: { users: [], game_versions: [], matches: [] },
  history: [],
};

const $ = (id) => document.getElementById(id);

// OpenAPI parsing

function resolveRef(schema) {
  if (schema && schema.$ref) {
    return state.spec.components.schemas[schema.$ref.split("/").pop()];
  }
  return schema;
}

/** For [X | None] schemas, returns the schema of [X]. */
function unwrapOptional(schema) {
  if (schema && schema.anyOf) {
    return schema.anyOf.find((option) => option.type !== "null") ?? schema;
  }
  return schema;
}

function exampleFromSchema(schema) {
  const example = {};
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    if (!(schema.required ?? []).includes(name)) continue;
    const resolved = unwrapOptional(resolveRef(property)) ?? {};
    const byType = { string: "", integer: 0, number: 0, boolean: false, array: [], object: {} };
    example[name] = resolved.default ?? byType[resolved.type] ?? null;
  }
  return example;
}

function parseOperations(spec) {
  const operations = [];
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      const parameters = operation.parameters ?? [];
      const content = operation.requestBody?.content?.["application/json"];
      let body = null;
      if (content) {
        const schema = resolveRef(unwrapOptional(content.schema)) ?? {};
        body = {
          required: operation.requestBody.required === true,
          example: schema.examples?.[0] ?? exampleFromSchema(schema),
        };
      }
      operations.push({
        key: `${method.toUpperCase()} ${path}`,
        method: method.toUpperCase(),
        path,
        group: path.split("/")[1],
        summary: operation.summary ?? "",
        description: operation.description ?? "",
        params: parameters.filter((p) => p.in === "path" || p.in === "query"),
        usesUser: parameters.some(
          (p) => p.in === "header" && p.name.toLowerCase() === "x-user-id",
        ),
        body,
      });
    }
  }
  return operations;
}

// Known entities, for suggestions and defaults

function idKind(paramName) {
  if (paramName === "user_id" || paramName === "owner_user_id") return "user";
  if (paramName === "game_id") return "game";
  if (paramName === "match_id") return "match";
  return null;
}

function byRecentUpdate(items) {
  return [...items].sort((a, b) => a.updated_at.localeCompare(b.updated_at));
}

function latestId(kind) {
  const { allData } = state;
  const items =
    kind === "user"
      ? allData.users
      : kind === "game"
        ? byRecentUpdate(latestGames(allData).filter((game) => !game.deleted))
        : byRecentUpdate(allData.matches);
  return items.length ? items[items.length - 1].id : "";
}

function describeMatch(match, names, gamesById) {
  const game = gamesById.get(match.game_id);
  const players = match.players
    .map((player) => (player.user_id ? names.get(player.user_id) ?? "?" : "computer"))
    .join(", ");
  return `${game ? game.name : "?"} · ${match.status} · ${players}`;
}

function renderDatalists() {
  const { allData } = state;
  const names = userNames(allData);
  const games = latestGames(allData);
  const gamesById = new Map(games.map((game) => [game.id, game]));
  const options = (items, label) =>
    items.map((item) => el("option", { value: item.id, label: label(item) }));
  $("ids-user").replaceChildren(...options(allData.users, (user) => user.display_name));
  $("ids-game").replaceChildren(
    ...options(games, (game) => `${game.name} v${game.version}${game.deleted ? " (deleted)" : ""}`),
  );
  $("ids-match").replaceChildren(
    ...options(allData.matches, (match) => describeMatch(match, names, gamesById)),
  );
}

async function refreshData() {
  try {
    state.allData = await fetchAllData();
  } catch (error) {
    toast(String(error));
    return;
  }
  renderDatalists();
  renderUserSelect();
  // The password of the acting user may only now be known.
  if (currentUserId() && !currentPassword()) {
    $("user-password").value = knownPassword(currentUserId());
    renderAuthNote();
  }
}

// Acting user

function currentUserId() {
  return $("user-id").value.trim();
}

function currentPassword() {
  return $("user-password").value.trim();
}

function savedPasswords() {
  try {
    return JSON.parse(localStorage.getItem(PASSWORDS_STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function savePassword(userId, password) {
  const passwords = savedPasswords();
  if (password) passwords[userId] = password;
  else delete passwords[userId];
  localStorage.setItem(PASSWORDS_STORAGE_KEY, JSON.stringify(passwords));
}

/** The password of [userId] from /debug/all-data or else this browser's memory. */
function knownPassword(userId) {
  const fromData = state.allData.users.find((user) => user.id === userId)?.password;
  return fromData ?? savedPasswords()[userId] ?? "";
}

/** Acts as [userId], with [password] or else its known password. */
function setUserId(userId, password = undefined) {
  $("user-id").value = userId;
  $("user-password").value = password ?? knownPassword(userId);
  localStorage.setItem(USER_STORAGE_KEY, userId);
  renderUserSelect();
  renderAuthNote();
}

/** Remembers the password of a user created through POST /users. */
function rememberNewUser(user) {
  if (!user || typeof user.id !== "string" || typeof user.password !== "string") return;
  savePassword(user.id, user.password);
}

function renderUserSelect() {
  const userId = currentUserId();
  const select = $("user-select");
  const known = state.allData.users.some((user) => user.id === userId);
  select.replaceChildren(
    el("option", { value: "", textContent: userId && !known ? "(other id)" : "(nobody)" }),
    ...state.allData.users.map((user) =>
      el("option", { value: user.id, textContent: `${user.display_name} · ${shortId(user.id)}` }),
    ),
  );
  select.value = known ? userId : "";
}

async function createGuestUser() {
  const name = prompt("Display name of the new guest user", `guest ${state.allData.users.length + 1}`);
  if (!name) return;
  const response = await fetch("/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ display_name: name }),
  });
  const body = await response.json();
  if (!response.ok) {
    toast(`Couldn't create user: ${JSON.stringify(body.detail)}`);
    return;
  }
  rememberNewUser(body);
  await refreshData();
  setUserId(body.id);
  toast(`Now acting as ${body.display_name}`);
}

// Operation list

function renderOperations() {
  const filter = $("operation-filter").value.trim().toLowerCase();
  const matching = state.operations.filter(
    (op) => !filter || `${op.key} ${op.summary}`.toLowerCase().includes(filter),
  );
  const groups = [...new Set(matching.map((op) => op.group))].sort(
    (a, b) => groupRank(a) - groupRank(b),
  );
  const children = [];
  for (const group of groups) {
    children.push(el("div", { class: "group-title", textContent: group }));
    for (const op of matching.filter((candidate) => candidate.group === group)) {
      children.push(
        el(
          "button",
          {
            type: "button",
            class: "operation",
            title: op.summary,
            "aria-selected": String(op === state.selected),
            onclick: () => selectOperation(op),
          },
          el("span", { class: `method method-${op.method}`, textContent: op.method }),
          el("span", { class: "path", textContent: op.path }),
        ),
      );
    }
  }
  if (!children.length) children.push(el("div", { class: "group-title", textContent: "No matches" }));
  $("operations").replaceChildren(...children);
}

function groupRank(group) {
  const index = GROUP_ORDER.indexOf(group);
  return index === -1 ? GROUP_ORDER.length : index;
}

// Request form

function defaultDraft(op) {
  const params = {};
  for (const param of op.params) {
    const kind = idKind(param.name);
    let value = "";
    if (param.in === "path" && kind) {
      // For users, the one you act as is the likeliest target (e.g. PATCH /users/{user_id}).
      value = kind === "user" && currentUserId() ? currentUserId() : latestId(kind);
    }
    params[param.name] = value;
    if (param.name === "version") params.version = "1";
  }
  let body = "";
  if (op.body) {
    const example = structuredClone(op.body.example);
    if (example && typeof example === "object" && example.game_id === "") {
      example.game_id = latestId("game");
    }
    body = JSON.stringify(example, null, 2);
  }
  return { params, body };
}

function draftFor(op) {
  if (!state.drafts.has(op.key)) state.drafts.set(op.key, defaultDraft(op));
  return state.drafts.get(op.key);
}

function selectOperation(op) {
  state.selected = op;
  renderOperations();
  renderRequest();
}

function paramInput(param, draft) {
  const schema = unwrapOptional(param.schema) ?? {};
  const onChange = (event) => {
    draft.params[param.name] = event.target.value;
    renderUrlPreview();
  };
  if (schema.enum) {
    const select = el(
      "select",
      { id: `param-${param.name}`, onchange: onChange },
      el("option", { value: "", textContent: "(any)" }),
      ...schema.enum.map((value) => el("option", { value, textContent: value })),
    );
    select.value = draft.params[param.name] ?? "";
    return select;
  }
  const kind = idKind(param.name);
  return el("input", {
    id: `param-${param.name}`,
    value: draft.params[param.name] ?? "",
    spellcheck: false,
    placeholder: param.required ? "required" : "optional",
    oninput: onChange,
    ...(kind ? { "aria-label": `${param.name} (suggestions: known ${kind}s)` } : {}),
  });
}

function renderRequest() {
  const op = state.selected;
  const form = $("request");
  if (!op) {
    form.replaceChildren(el("div", { class: "muted", textContent: "Choose an operation." }));
    return;
  }
  const draft = draftFor(op);
  const children = [
    el(
      "div",
      { class: "request-title" },
      el("span", { class: `method method-${op.method}`, textContent: op.method }),
      el("span", { textContent: op.path }),
    ),
    el("div", {}, el("strong", { textContent: op.summary }), op.description ? el("div", { class: "muted", textContent: op.description }) : null),
    el("div", { id: "auth-note", class: "auth-note" }),
  ];

  for (const location of ["path", "query"]) {
    const params = op.params.filter((param) => param.in === location);
    if (!params.length) continue;
    children.push(el("div", { class: "section-title", textContent: `${location} parameters` }));
    const fields = el("div", { class: "fields" });
    for (const param of params) {
      const input = paramInput(param, draft);
      const kind = idKind(param.name);
      if (kind && input.tagName === "INPUT") input.setAttribute("list", `ids-${kind}`);
      fields.append(
        el("label", {
          htmlFor: input.id,
          textContent: `${param.name}${param.required ? " *" : ""}`,
        }),
        input,
      );
      if (kind) fields.append(el("div", { class: "hint", textContent: `Suggests known ${kind}s` }));
    }
    children.push(fields);
  }

  if (op.body) {
    children.push(
      el("div", { class: "section-title", textContent: `JSON body${op.body.required ? "" : " (optional)"}` }),
      el("textarea", {
        id: "body",
        value: draft.body,
        spellcheck: false,
        oninput: (event) => (draft.body = event.target.value),
      }),
      el(
        "div",
        { class: "actions" },
        el("button", {
          type: "button",
          textContent: "Reset to example",
          onclick: () => {
            draft.body = defaultDraft(op).body;
            $("body").value = draft.body;
          },
        }),
        el("button", { type: "button", textContent: "Format", onclick: formatBody }),
      ),
    );
  }

  children.push(
    el("div", { id: "url-preview", class: "url-preview mono" }),
    el(
      "div",
      { class: "actions" },
      el("button", { type: "submit", class: "primary", textContent: "Send" }),
      el("button", { type: "button", textContent: "Copy as curl", onclick: copyAsCurl }),
      el("button", {
        type: "button",
        textContent: "Reset form",
        onclick: () => {
          state.drafts.delete(op.key);
          renderRequest();
        },
      }),
    ),
  );
  form.replaceChildren(...children);
  renderUrlPreview();
  renderAuthNote();
}

function formatBody() {
  const draft = draftFor(state.selected);
  try {
    draft.body = JSON.stringify(JSON.parse(draft.body), null, 2);
    $("body").value = draft.body;
  } catch (error) {
    toast(`Body is not valid JSON: ${error.message}`);
  }
}

function renderAuthNote() {
  const note = $("auth-note");
  const op = state.selected;
  if (!note || !op) return;
  const userId = currentUserId();
  const password = currentPassword();
  const name = userNames(state.allData).get(userId);
  note.classList.toggle("missing", op.usesUser && !(userId && password));
  if (!op.usesUser) {
    note.textContent = "Doesn't need X-User-Id.";
  } else if (!userId) {
    note.textContent =
      "Needs X-User-Id and X-User-Password: choose who to act as at the top, or this returns 401.";
  } else if (!password) {
    note.textContent = "Needs X-User-Password: enter the password at the top, or this returns 401.";
  } else {
    note.textContent = `Sends X-User-Id: ${userId}${name ? ` (${name})` : " (unknown user)"} with its password`;
  }
}

/** Throws if a path parameter is missing. */
function buildUrl(op, draft) {
  const path = op.path.replace(/\{(\w+)\}/g, (_, name) => {
    const value = (draft.params[name] ?? "").trim();
    if (!value) throw new Error(`Missing path parameter ${name}`);
    return encodeURIComponent(value);
  });
  const query = new URLSearchParams();
  for (const param of op.params.filter((p) => p.in === "query")) {
    const value = (draft.params[param.name] ?? "").trim();
    if (value) query.set(param.name, value);
  }
  const queryString = query.toString();
  return queryString ? `${path}?${queryString}` : path;
}

function renderUrlPreview() {
  const preview = $("url-preview");
  if (!preview) return;
  try {
    preview.textContent = `${state.selected.method} ${buildUrl(state.selected, draftFor(state.selected))}`;
  } catch (error) {
    preview.textContent = error.message;
  }
}

/** The request to send for the current form, or throws a user-facing error. */
function currentRequest() {
  const op = state.selected;
  const draft = draftFor(op);
  const url = buildUrl(op, draft);
  const headers = {};
  const userId = currentUserId();
  const password = currentPassword();
  if (userId) headers["X-User-Id"] = userId;
  if (password) headers["X-User-Password"] = password;
  let body;
  if (op.body && draft.body.trim()) {
    try {
      JSON.parse(draft.body);
    } catch (error) {
      throw new Error(`Body is not valid JSON: ${error.message}`);
    }
    body = draft.body;
    headers["Content-Type"] = "application/json";
  }
  return { op, draft, url, headers, body, userId, password };
}

function shellQuote(text) {
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function copyAsCurl() {
  let request;
  try {
    request = currentRequest();
  } catch (error) {
    toast(error.message);
    return;
  }
  const parts = ["curl", "-X", request.op.method, shellQuote(location.origin + request.url)];
  for (const [name, value] of Object.entries(request.headers)) {
    parts.push("-H", shellQuote(`${name}: ${value}`));
  }
  if (request.body) parts.push("-d", shellQuote(JSON.stringify(JSON.parse(request.body))));
  navigator.clipboard.writeText(parts.join(" ")).then(() => toast("Copied curl command"));
}

async function send() {
  if (!state.selected) return;
  let request;
  try {
    request = currentRequest();
  } catch (error) {
    showMessage(error.message);
    return;
  }
  const started = performance.now();
  let response;
  let text;
  try {
    response = await fetch(request.url, {
      method: request.op.method,
      headers: request.headers,
      body: request.body,
    });
    text = await response.text();
  } catch (error) {
    showMessage(`Request failed: ${error}`);
    return;
  }
  const entry = {
    opKey: request.op.key,
    draft: structuredClone(request.draft),
    userId: request.userId,
    password: request.password,
    method: request.op.method,
    url: request.url,
    status: response.status,
    statusText: response.statusText,
    elapsedMs: Math.round(performance.now() - started),
    text,
  };
  if (request.op.key === "POST /users" && response.ok) {
    try {
      rememberNewUser(JSON.parse(text));
    } catch {
      // Not JSON; nothing to remember.
    }
  }
  state.history.unshift(entry);
  state.history.length = Math.min(state.history.length, MAX_HISTORY);
  showResponse(entry);
  renderHistory();
  await refreshData();
}

// Response and history

function showMessage(message) {
  $("response-meta").replaceChildren(el("span", { class: "pill error", textContent: "not sent" }));
  const body = $("response-body");
  body.className = "";
  body.textContent = message;
}

function prettyBody(text) {
  if (!text) return "(empty body)";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function showResponse(entry) {
  const name = userNames(state.allData).get(entry.userId);
  $("response-meta").replaceChildren(
    el("span", { class: `pill ${statusClass(entry.status)}`, textContent: entry.status }),
    el("span", { textContent: entry.statusText }),
    el("span", { class: "muted", textContent: `${entry.elapsedMs} ms` }),
    el("span", {
      class: "muted",
      textContent: entry.userId ? `as ${name ?? shortId(entry.userId)}` : "anonymous",
    }),
  );
  const body = $("response-body");
  body.className = "";
  body.textContent = `${entry.method} ${entry.url}\n\n${prettyBody(entry.text)}`;
}

function renderHistory() {
  const names = userNames(state.allData);
  $("history").replaceChildren(
    ...state.history.map((entry) =>
      el(
        "button",
        {
          type: "button",
          class: "history-entry",
          title: "Show this response and restore its request",
          onclick: () => restore(entry),
        },
        el("span", { class: `pill ${statusClass(entry.status)}`, textContent: entry.status }),
        el("span", { class: `method method-${entry.method}`, textContent: entry.method }),
        el("span", { class: "path", textContent: entry.url }),
        el("span", {
          class: "muted",
          textContent: entry.userId ? names.get(entry.userId) ?? shortId(entry.userId) : "anon",
        }),
      ),
    ),
  );
}

function restore(entry) {
  const op = state.operations.find((candidate) => candidate.key === entry.opKey);
  if (!op) return;
  state.drafts.set(op.key, structuredClone(entry.draft));
  setUserId(entry.userId, entry.password);
  selectOperation(op);
  showResponse(entry);
}

// Startup

/** Supports links like /console#op=GET /matches/{match_id}&match_id=... */
function applyHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const op = state.operations.find((candidate) => candidate.key === params.get("op"));
  if (!op) return false;
  const draft = defaultDraft(op);
  for (const [name, value] of params) {
    if (name in draft.params) draft.params[name] = value;
  }
  state.drafts.set(op.key, draft);
  selectOperation(op);
  return true;
}

async function main() {
  setUserId(localStorage.getItem(USER_STORAGE_KEY) ?? "");
  $("user-id").addEventListener("input", () => setUserId(currentUserId()));
  $("user-password").addEventListener("input", () => {
    if (currentUserId()) savePassword(currentUserId(), currentPassword());
    renderAuthNote();
  });
  $("user-select").addEventListener("change", (event) => setUserId(event.target.value));
  $("new-user").addEventListener("click", createGuestUser);
  $("operation-filter").addEventListener("input", renderOperations);
  $("operation-filter").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const first = document.querySelector("#operations .operation");
    if (first) first.click();
  });
  $("request").addEventListener("submit", (event) => {
    event.preventDefault();
    send();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      send();
    }
  });
  window.addEventListener("hashchange", applyHash);

  state.spec = await (await fetch("/openapi.json")).json();
  state.operations = parseOperations(state.spec);
  await refreshData();
  renderOperations();
  if (!applyHash() && state.operations.length) selectOperation(state.operations[0]);
}

main();

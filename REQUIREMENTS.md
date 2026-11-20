# BuildPlay — Platform Requirements

High-level requirements for the game platform at
[buildplay.fun](https://buildplay.fun): what kinds of games it hosts, how
people play them, and the platform features every release must keep. The
feature list in §2 is the course's required-features list (from the
"Columbia gaming course 2026" spreadsheet, "2026 main" tab); the rest of
this document describes how the platform meets it today.

For the game-author contract (how a single game is built and submitted),
see [GAME_DEVELOPMENT_GUIDE.md](GAME_DEVELOPMENT_GUIDE.md).

## 1. Kinds of games

- **Turn-based board and card games.** Each game is a set of rules over an
  opaque JSON state: a move replaces the state, passes the turn to a set of
  players (any of whom may move next), or ends the match. Real-time,
  reflex and continuous-action games are out of scope.
- **Every game has server-side logic** — JavaScript run in a sandbox
  (QuickJS) that owns the rules: creating a match, validating and applying
  moves, computing each player's private view, handling players joining
  and leaving, and providing the computer opponent's moves. Client-only
  games are not supported.
- **1–10 players per game**, from the game's declared list of allowed
  player counts (a human plus a computer is two seats). Solo games
  (1 player) are supported.
- **Hidden information is a first-class concept.** The server state is
  never sent to a client; each player receives only their own view of it,
  and spectators receive a spectator view. Match history likewise returns
  per-caller views, never raw states. Games belong to the platform.
- **Simultaneous turns are allowed in multiplayer** (the turn is a set of
  players). Single-player play (pass-and-play, against the computer)
  requires one player at a time in the turn.
- **Chance is seeded and deterministic.** A match has a server-only seed;
  given the same seed and inputs, game logic must return identical
  results, so any recorded match can be replayed and verified.
- **Games must be verifiable.** Before a game is accepted it passes
  automated checks: hand-written unit cases, JSON-Schema validation of
  states/moves/views, and random walks (up to 1,000 walks of up to 1,000
  moves) with per-call time and memory budgets — plus a recorded,
  server-verified test flow through the `/game-test/*` REST endpoints (see §7).
- **Stakes.** Games may be played for virtual tokens: players stake into
  a pot and the game's payouts divide it. A user's first completed verified
  login (Google, email code or phone code) grants 1,000 tokens once. Guest
  login and playing matches do not grant tokens. A published game's versions are
  kept; a match always finishes on the version it started with.

## 2. Required features (course list)

### Player-facing

- Phone, tablet and laptop layouts
- Logins: Email, Phone, Google, Guest — later: Apple, Facebook
- Multi-lingual, also inside the games
- Animations & sounds
- Usable offline
- Progressive web app (add to Home Screen)
- Single-player modes (a full game can be played offline)
- Multiplayer modes (a move can be made offline and is sent when back online)
- Invite to a match via short link (e.g. buildplay.fun/invite/xkn8d)
- Viewing a match when you are not a player (spectating)
- Random opponents
- Push notifications + in-app notifications
- View match history (the state changes over time)
- Virtual currency and betting in multiplayer matches
- Ad campaigns
- Usable assets for the game builder

### Admin (backoffice)

- Important metrics on usage
- Searching our data
- Health of our system/API
- Invite attribution (invite tree)
- CI/CD

### General

- Use Firestore
- The REST API returns just what the portal needs (the game list returns
  metadata, not game code)
- No branches — work lands on main

## 3. Modes of play

Every match records `match_kind`: `computer`, `pass_and_play`, or `multiplayer`.
See [the match contract](docs/match-kinds.md).

- **Against computers (`computer`):** exactly one human account/seat and computer
  opponents. Only the owner can read or control the match; no sharing or joining.
- **Pass-and-play (`pass_and_play`):** one account owns every human seat, including
  one-seat solo games. The device can be passed between people. No computers,
  sharing or joining; no other account can see the match.
- **Multiplayer (`multiplayer`):** humans only. Share invitations so the other
  players can join; multiplayer turn notifications and alerts apply.
- **Cloud saves and offline play:** all matches save locally first and then to
  the cloud. Single-player means either of the first two kinds: one logged-in
  account controls all turns and can keep playing offline without a turn limit.
  Reconnection uploads all pending progress, including finished matches.
  Multiplayer queues the user's legal move and sends it when connected again.


## 4. Devices and resolutions

- A responsive web app (PWA) that runs on **phones, tablets and laptops**,
  installable to the Home Screen, usable offline once opened online.
- Both **portrait and landscape** orientations.
- Games are tested at five reference resolutions:
  - iPhone 16 Pro Max (phone) — 430×932
  - Samsung Galaxy S25 Ultra (phone) — 412×915
  - iPad Air 11-inch (tablet) — 820×1180
  - Samsung Galaxy Tab S10 (tablet) — 800×1280
  - MacBook Air 13-inch (laptop) — 1440×900
- Delight requirements: animations and sounds, avatars/profile pictures
  for users and computer opponents.

## 5. Languages

- **8 languages:** English, Spanish, French, German, Portuguese, Chinese,
  Hindi and Arabic (Arabic is right-to-left).
- Localization covers the portal **and the inside of every game**: a game
  ships its name, description, rules and UI strings in all 8 locales as
  part of its submission.

## 6. Accounts and identity

- Login options are always all offered — Google, email (one-time codes),
  and guest — with no forced or auto-selected provider; guest play is
  always available. (Phone login is built but parked; Apple/Facebook are
  later additions per §2.)
- Accounts can be linked and merged; a merged-away account keeps working
  and resolves to the surviving one.
- Invite links carry attribution, forming an invite tree (who brought
  whom) that the backoffice can report on.

## 7. Publishing games

- Games are published through **POST /games** (see
  docs/agent-game-import.md): one call carries the server code, declarative UI
  package, schemas, unit cases and all translations. Both POST creation
  routes reject updates. **PATCH /games/{game_id}** is the single content
  update API: provide the game's secret or the master password, and only
  the content fields to change. Only the game's secret hash is stored.
- Publication is gated by the **five-step game-test flow**: store the
  exact payload, pass the server checks, play and record verified
  matches in pass-and-play, against the computer, and online multiplayer
  across the reference resolutions and orientations. The submitted
  payload must match the tested inputs. Updates that change declarative
  presentation require this flow for the combined payload. Server-code,
  unit-test or mechanical-rule changes run the relevant server checks and
  random walks. Text, image and other metadata changes run lightweight
  artifact and translation validation, without gameplay tests.
- **Game proposals:** a player who misses a game can propose it from the
  Portal's game-selection page; AI agents review proposals and create
  the game within 24 hours (see docs/game-proposals.md).

HTML games are retained only in the read-only `/legacy/games` archive for
future migration. The Portal and ordinary APIs expose declarative games only;
HTML matches and their histories are removed, and new ones are rejected.

## 8. Online platform

- **Storage:** Firestore, read through bounded, paginated queries
  (production namespace `production_v3`); the API returns only what the
  calling client needs.
- **Backoffice** (master-password protected): usage metrics, data
  search, system/API health, invite attribution.
- **Delivery:** CI/CD — tests run on every push, and a green main deploys
  itself. No long-lived branches.
- **Notifications:** web push plus in-app notifications (e.g. when it
  becomes your turn).
- **Experiments and ad campaigns** run through the platform's campaign
  system, with results visible in the backoffice.

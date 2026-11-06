# Web portal offline play and three games

## Scope

This contribution changes the existing web portal and adds Dots & Boxes, Reversi,
and Crazy Eights. It does not change backend APIs, builder code, native Android/iOS
projects, configuration, or existing games. The latest builder/solo-game changes
from main `674ae95` are retained, including game deep links and computer limits.

## Published games

Published through buildplay.fun's builder using the student's Google-linked account:

| Game | Players | Published game ID |
| --- | --- | --- |
| Dots & Boxes | 2 | `fc63dfc7-d091-460f-b9f9-5877851d64fa` |
| Reversi | 2 | `5e1786fb-2a04-4cbe-8047-caf129c84a22` |
| Crazy Eights | 2–4 | `22260b8e-cd94-4664-98e6-de8db8173ef9` |

The self-contained sources and metadata are under `games/playroom/`. Each game
supports computer opponents. Crazy Eights deals through a shared initial move,
shows only the viewer's hand, uses wild eights, and draws one card then ends the
turn. If all players are blocked with no drawable cards, lowest points wins.
The course API exposes opaque match state, including all hands. UI concealment
is not server-enforced secrecy; these are casual classroom games, not a secure
competitive card service. No API change is proposed here.

## Offline behavior

- The service worker saves only the portal shell and its explicitly listed assets.
  It does not intercept backend/auth responses, builder pages, or other frontends.
- `/portal` redirects to `/static/portal.html` after the worker is installed.
  This URL is within the existing `/static/` worker scope, requiring no new server
  endpoint or `Service-Worker-Allowed` header. Use this address for offline reopening.
- Match lists, individual matches, exact game versions, and names are saved per
  account on this device. The existing Auth component retains login credentials;
  neither game JavaScript nor the worker receives credentials.
- Local practice starts a separate device-only match against computers or in
  pass-and-play mode. It never creates a cloud match or uploads practice moves.
- Real match moves normally are persisted before submission, with `expected_move_count`.
  Only the user's current turn, or a computer turn they can act for, is available.
  Other remote humans' turns cannot be played offline.
- If a new move cannot be saved because storage is full, the portal can submit it
  directly while online only if the match has no saved queue or conflict. A lost
  acknowledgement is reported as an unknown outcome; refresh the match before
  trying again. A move made offline still needs durable storage and is rejected
  if it cannot be saved. Existing unsynced work is never evicted to make room.
- Reconnection checks authoritative state and move history. A lost acknowledgement
  is matched against the same author's state and turn set, avoiding duplicate moves.
  Conflicts preserve the local branch and require explicit resolution. Download
  queued moves before choosing **Use server version**; an archive also remains
  in device storage.
- Web Locks serialize portal mutations between tabs. Network requests time out
  and queued moves retry with backoff.
- Open **Device storage** in the sidebar for per-account byte sizes
  (UTF-8, not characters), cached-response, queue, practice and archive
  sizes, the five largest cached responses, the eviction order and next
  entry to evict, queued moves and practice broken down per match, totals
  for every account on this device, other saved data on this origin
  (accounts, language, builder), the service-worker shell cache size, and
  the browser's estimated total origin usage and quota when available.
  **Clear recoverable cache** removes only that account's refetchable
  responses; queued-match snapshots, local practice game code, queues and
  archives remain. It does not clear other accounts, service worker assets,
  or other site data. One recoverable response can also be removed
  programmatically (`PortalOffline.deleteCached`); the panel itself has no
  per-entry delete button yet.
- Each account's data is stored per key instead of one JSON value
  (`game-platform.portal.v1.<id>.meta` manifest,
  `.recency` for the single least-recently-used order, `.r.<path>` per
  cached response, `.q.<id>` per queued-match list, `.c.<id>` per conflict,
  `.l.<id>` per local practice match, plus archives, archived matches and
  the selected match). A legacy single-JSON blob migrates once on first
  read and is kept untouched as a backup; a corrupt or missing piece only
  loses that piece, and a manifest whose own write failed is rebuilt by
  scanning the pieces. Unchanged pieces are not rewritten. A failed write
  never deletes durable pieces the manifest still lists, and a response
  dropped to free quota is deleted before the response writes that need
  the room.
- Recoverable responses are evicted least-recently-used first at a
  one-MiB (UTF-8 byte) budget or on quota failure; entries never touched
  evict first. Recency is one ordered record (oldest first, at most 1,000
  entries, monotonic clock), touched on read and merged on write, so
  concurrent tabs no longer keep separate orders. The protected data
  can exceed this limit. The service worker retains at most 50 recently
  used avatars (a hit moves the entry to the newest end) and will return
  successful network responses even if caching fails. Its install now
  installs each shell asset individually, so one failed asset leaves a
  partial shell and a warning instead of no offline shell at all.
- Browsers that deny localStorage entirely no longer brick the portal:
  the boot probe falls back to an in-memory store (and Auth keeps the
  login in memory for the page load), reads return empty state with a
  "Device storage unavailable; online play still works" notice, and
  caching failures never fail the page. If a new move cannot be saved
  because storage is full, the portal submits it directly while online
  only if the match has no saved queue or conflict. Writes that the
  server operation has already survived (recording a conflict, resolving
  one, archiving a deleted match, ending practice) report instead of
  throwing. Browser eviction or clearing site data can still remove all
  local work; offline durability cannot be guaranteed in those
  circumstances. A login kept only in memory does not survive a reload,
  and a corrupt legacy blob cannot be salvaged (its backup is kept for
  inspection). Real Safari private-mode behaviour is still untested.
- The portal alone accepts legacy null end-turn messages, fixing the old
  TicTacToe end-move compatibility issue without altering shared GameFrame code.

Storage is browser-local and finite. Clearing website data removes cached games,
local practice, and unsynced moves. External network dependencies inside third-party
games are not automatically mirrored; these three games use no external assets.
Offline readiness of arbitrary catalog games must be verified individually.

## iPhone demo after deployment

Use a current iOS/Safari version (Web Locks requires Safari 15.4+).

1. Open `https://buildplay.fun/portal` in Safari while online. Confirm it reaches
   `/static/portal.html` and displays **Portal saved for offline**.
2. Use Safari's Share menu → **Add to Home Screen**. Open that shortcut while
   online; if it has a separate session, sign in there too.
3. Open each desired game/match from the shortcut so its exact code and state are
   saved in that browser context. Start a local practice game as well.
4. Enable airplane mode and ensure Wi-Fi is off. Reopen the Home Screen shortcut.
5. Continue local practice; open an ongoing real match where it is your turn and
   make a move. Confirm the pending-move indicator.
6. Reconnect, press **Retry sync**, and confirm pending moves reach zero. Verify
   the same state from a second device/account. Resolve a conflict explicitly
   if another client already moved.

Physical iPhone testing is pending. Desktop testing is not a substitute for it.
Apple references: [Home Screen web apps](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios),
[Safari 15.4 Web Locks support](https://developer.apple.com/documentation/safari-release-notes/safari-15_4-release-notes).

## Validation

Run from the repository root:

```sh
node --test tests/web
python -m pytest -q
```

Browser checks on an isolated backend demonstrated all three game UIs and computer
replies. Reversi reopened while that backend was paused, restored a two-move match,
accepted a human move and a computer reply offline, then synchronized exactly four
moves after resuming the backend. The pending count returned to zero; an independent
server read confirmed four moves. No production server was paused or restarted.

The final JavaScript run passed 51 tests (13 game/offline checks, 27 builder checks, and 11 portal checks).
The portal test harness includes the offline adapter. Python: 206 passed, one existing stale
example-data fixture failure. No backend files differ from upstream main.

The published game code also completed two-user cloud matches: Dots & Boxes
24 moves, Reversi 60 moves, and Crazy Eights 58 moves. The second account read
back each accepted state; all three finished. Only those test matches were
deleted afterward. This is API-client coverage, not two physical phones.

The local tests cover box completion/extra turns, Reversi captures and termination,
100 simulated Crazy Eights matches, reload durability, account isolation, lost
acknowledgements, conflicting remote moves, ordered queue replay, bounded conflict
retries, and storage exhaustion. Shared builder checks are also run unchanged.

## Deployment handoff

Publishing games updates cloud data immediately. Pushing portal code to GitHub
alone does not deploy it: there is no checked-in automatic deployment workflow.

The VM administrator should review the PR and use their established deployment
procedure to update the actual served checkout. The portal-specific static files
are `portal.html`, `portal.js`, `portal-offline.js`, `portal-sw.js`,
`portal.webmanifest`, and `portal-icon.svg`; keep them together with the current
main versions of `common.css`, `common.js`, and `auth.js`.

Preserve production JSON data, configuration, and keys. Do not seed/reset the
backend or substitute example data. These portal changes require no API migration.
Whether a restart is needed depends on the deployment's packaging/process manager;
no guessed service name or restart command is provided.

Check that `/static/portal-sw.js` is served as JavaScript over HTTPS, the manifest
and shell assets return 200, and the iPhone procedure above passes. Increment the
worker cache version whenever shell assets change. The worker has a portal-only
cache prefix and does not delete other students' caches. Rollback must also serve
a worker with a new cache version; merely reverting a cached JavaScript file will
not replace an already installed offline shell.

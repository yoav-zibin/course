# GamePortal iOS — shared backend integration

Open `GamePortal.xcodeproj`, choose GamePortal and an iPhone simulator, then Command-R. Use normal simulator signing: Keychain requires the app's signing entitlements. Do not disable code signing for the online demo. A physical device needs your signing team.

## Online Play

Creates a guest via POST /users and stores its credentials in Keychain. Lists games, your matches and open matches; creates matches with computer opponents; joins waiting matches; starts owner matches; loads the exact game version; renders shared HTML in a sandboxed iframe inside WKWebView; polls the server every two seconds; submits moves with expected_move_count. Match links can be shared with the web portal.

The bridge implements state_changed and make_move from the course README, including turn sets, computer turns, spectator state and game-over state. Game code gets no account credentials. The game frame has an opaque origin, cannot navigate the container, and has network access blocked by CSP. Games depending on external assets may need adaptation.

For a quick demo: Online Play → Tic-tac-toe → 1 computer → Create online match → Start online match → tap a square. For a human opponent, create with 0 computers, have the other player join, then start as owner.

Backend: https://buildplay.fun. No API or backend changes are required. Source belongs in frontends/ios-game-portal in the shared course repository. These local changes have not been pushed.

## Verification on October 9

Xcode 16.3 simulator build passed. On iPhone 16 Pro / iOS 18.4, native guest creation, server match creation/start, downloaded Tic-tac-toe rendering, human move submission and computer response were manually verified. A normally signed build saved the account to Keychain; relaunch restored the identity and server match. The earlier unsigned test created a disposable iOS Demo account whose credentials were not retained. The current persistent demo account is iOS Presentation.

The original offline rules/persistence tests and end-to-end offline UI test passed earlier in the session. Human-to-human joining, every game package, game-over online flows and network-failure recovery have not been exhaustively exercised. Native account linking, leave/delete controls, ongoing-match joining and push notifications remain future work.

## Offline starter reference

# GamePortal · iOS starter

A native SwiftUI portal with a bundled HTML/JavaScript Tic-Tac-Toe game. Two people can play on one phone without a server or account.

## Run

1. Open `GamePortal.xcodeproj` in Xcode.
2. Select the **GamePortal** scheme and an iPhone simulator.
3. Press **⌘R**. If no simulator is available, install an iOS runtime in Xcode → Settings → Components.

Requires Xcode with an iOS SDK; deployment target is iOS 17. No packages, API keys, or paid developer account are needed for the simulator. A physical phone requires your own signing team in Xcode.

## Demo flow

1. Enter your name and choose **Play as guest**.
2. In **Discover**, choose Tic-Tac-Toe → **Choose mode**.
3. Enter two player names and **Start match**.
4. Make a move, pass the phone, then tap the next player's confirmation.
5. Open **My Matches** to resume the same match. Closing and reopening the app preserves the board and pending handoff.
6. Complete a row, column, or diagonal. The game finishes and appears under **Finished**. Draws are also detected.
7. Open a finished match to inspect its board or hide it from this device.

## What each file does

- `GamePortalApp.swift`: entry point and native screens: Welcome, Discover, setup, My Matches, match and handoff.
- `Match.swift`: match data, legal move checks, turn changes, win/draw detection.
- `PortalStore.swift`: guest profile and matches; atomically saves JSON to the app's Documents directory after changes.
- `GameWebView.swift`: restricted WebView and JSON message bridge. Only the bundled page can navigate; no native account credentials are exposed.
- `Game/`: board presentation and move proposals, using HTML/CSS/JavaScript.
- `GamePortalTests/main.swift`: executable tests of moves, handoffs, results, and disk round-trip persistence.

## Interface with the game

The native container sends `state_change` with `state.board`, `turn_of_user`, `my_user`, and `players`. Seats are indexed 0 and 1; `turn_of_user` is null after the match ends.

The game responds with `make_move`, `turn_of_player_index`, and `next_state.board`. **Local assumption:** `turn_of_player_index` identifies the player proposing the move. The slide's illustrative payload does not fully define this field; confirm its meaning with the other workstreams before integration.

The native app compares the proposed board with its saved state, accepts exactly one legal empty-square placement by the current player, computes the result, and saves. Turn handoffs block additional moves until confirmed.

Tic-Tac-Toe validation currently lives in `Match.swift`. Supporting arbitrary game packages will require a shared rules/validation interface; merely replacing the HTML is not sufficient. The WebView is restricted for this bundled sample, but externally generated game packages need a further security review.

## Scope and next handoff

Implemented: local guest identity, one discoverable game, two-player setup, playable embedded board, turn privacy overlay, saved active/finished matches, resume and hide-finished behavior.

Not implemented yet: backend accounts, remote matches, shared lobbies, invitations, spectator mode, computer opponents, push notifications, remote offline queues, localization, or downloaded game packages. The guest identity is local, not server authentication. The handoff overlay demonstrates the portal interaction; Tic-Tac-Toe itself has no secret hands.

For the next iOS presenter:

1. Agree on game-package metadata and JSON message semantics with GameBuilder.
2. Agree on match creation/join/move endpoints and version handling with the backend workstream.
3. Add a network service alongside local storage and complete a move visible on a second client.

## Verification commands

```sh
xcodebuild -project GamePortal.xcodeproj -scheme GamePortal -sdk iphonesimulator -configuration Debug -derivedDataPath /tmp/gameportal-build CODE_SIGNING_ALLOWED=NO build
swiftc -module-cache-path /tmp/gameportal-swift-cache GamePortal/Match.swift GamePortalTests/main.swift -o /tmp/gameportal-tests
/tmp/gameportal-tests
```

For a presentation, distinguish implemented local behavior from planned shared-backend behavior. Explain the files and credit AI assistance accurately.

### Verified October 1, 2026

- Simulator build and UI-test bundle compile successfully with Xcode 26.4.1.
- Rules tests pass for valid/invalid moves, mandatory handoff, all winning lines, draws, completed games, and JSON disk persistence.
- The end-to-end UI test passed on iPhone 17 Pro / iOS 26.4.1: start a match, make a move, restart the app, resume the pending handoff, verify an occupied square is disabled, complete an X win, and find it under Finished.
- The first UI run failed waiting for the initial handoff; a diagnostic rerun and a final run with diagnostics removed both passed without a game-logic change. Treat that initial failure as an intermittent test/runtime issue, not a confirmed fix. Rehearse the flow before presenting.

Run the UI test in Xcode with **⌘U**. The test creates local sample matches. It expects the guest name Juan, so use a fresh simulator installation if you have already entered a different guest name.

## October 9: shared class catalog

The **Class Games** tab reads `https://buildplay.fun/games` using URLSession and displays game names, descriptions and supported player counts. Pull to refresh or tap the refresh button. Loading, empty and failure states are supported. A failed refresh retains any previously loaded catalog.

**Open online portal** opens `https://buildplay.fun/portal` in the system browser. Native local profiles and matches are separate from the web portal's accounts and online matches. This is a read-only catalog integration, not native multiplayer support; it needs no cloud admin credentials and changes no shared API.

The October 8 course email asks students to use a dedicated frontend folder in `yoav-zibin/course`. This app has not yet been contributed there. The bundled offline game's older message bridge still needs adaptation to the current shared `state_changed` / `make_move` protocol before generic shared games can run natively.


## Multiplayer experience upgrade (October 9)

The Online Play match screen now offers a native share sheet, Copy Link, and a QR code for a friend to scan in person. It shows backend-derived match status, a move-count update banner, manual retry, sync errors, and last successful sync time. Polling runs in the foreground every two seconds for the selected match, while list polling is suspended to avoid duplicate timers. The invite link opens the existing web portal; it does not automatically join a player, and the receiving player may need to sign in and choose Join. No server changes.

These changes have been source-integrated but **not compiled or simulator-tested in this environment**; build with Xcode on macOS and verify both players.

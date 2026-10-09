import SwiftUI
import UIKit
import CoreImage.CIFilterBuiltins

@main struct GamePortalApp: App {
    @StateObject private var store = PortalStore()
    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(store).tint(Palette.teal)
                .preferredColorScheme(.light)
                .alert("Storage needs attention", isPresented: Binding(get: { store.storageError != nil }, set: { if !$0 { store.storageError = nil } })) {
                    Button("OK") { store.storageError = nil }
                } message: { Text(store.storageError ?? "") }
        }
    }
}

enum Palette {
    static let ink = Color(red: 0.07, green: 0.16, blue: 0.22)
    static let teal = Color(red: 0.02, green: 0.43, blue: 0.43)
    static let paper = Color(red: 0.96, green: 0.96, blue: 0.93)
    static let orange = Color(red: 0.84, green: 0.30, blue: 0.17)
}

struct PrimaryButton: View {
    let title: String
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title).font(.headline).frame(maxWidth: .infinity).padding(17)
        }.buttonStyle(.plain).foregroundStyle(.white).background(Palette.teal, in: RoundedRectangle(cornerRadius: 18))
    }
}

struct RootView: View {
    @EnvironmentObject var store: PortalStore
    var body: some View {
        if store.guest.isEmpty { WelcomeView() }
        else {
            TabView {
                NavigationStack { DiscoverView() }.tabItem { Label("Discover", systemImage: "square.grid.2x2") }
                NavigationStack { OnlinePortalView() }.tabItem { Label("Online Play", systemImage: "person.2.fill") }
                NavigationStack { ClassGamesView() }.tabItem { Label("Class Games", systemImage: "network") }
                NavigationStack { MatchesView() }.tabItem { Label("My Matches", systemImage: "rectangle.stack") }
            }
        }
    }
}

struct WelcomeView: View {
    @EnvironmentObject var store: PortalStore
    @State private var name = ""
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                Label("GAMEPORTAL", systemImage: "circle.hexagongrid.fill").font(.caption.bold()).tracking(3)
                Spacer(minLength: 35)
                HStack(spacing: 16) {
                    Text("×").foregroundStyle(Palette.teal)
                    Text("○").foregroundStyle(Palette.orange)
                }.font(.system(size: 100, weight: .medium, design: .rounded))
                Text("Good games.\nSame table.").font(.system(size: 46, weight: .bold, design: .rounded))
                Text("A little friendly competition, wherever you are. Pick a game and pass the phone.")
                    .font(.title3).foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 12) {
                    Text("WHAT SHOULD WE CALL YOU?").font(.caption.bold()).tracking(1)
                    TextField("Your name", text: $name).textContentType(.nickname).padding().background(.white, in: RoundedRectangle(cornerRadius: 14))
                        .accessibilityIdentifier("guestName")
                    PrimaryButton(title: "Play as guest  →") {
                        store.guest = name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Player 1" : String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(30))
                        store.save()
                    }
                }
                Label("Local play · No account needed", systemImage: "iphone").font(.footnote).foregroundStyle(.secondary)
            }.padding(28).foregroundStyle(Palette.ink)
        }.background(Palette.paper)
    }
}

struct DiscoverView: View {
    @EnvironmentObject var store: PortalStore
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                HStack {
                    Text("YOUR POCKET GAME ROOM").font(.caption2.bold()).tracking(2)
                    Spacer()
                    Image(systemName: "circle.hexagongrid.fill").font(.title2)
                }.foregroundStyle(Palette.teal)
                Text("Your move,\n\(store.guest).").font(.system(size: 38, weight: .bold, design: .rounded))
                Text("Find a little time to play.").foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 18) {
                    HStack {
                        Label("THE CLASSIC", systemImage: "sparkle").font(.caption.bold()).tracking(1)
                        Spacer()
                        Text("01").font(.system(.title2, design: .monospaced))
                    }
                    HStack {
                        Spacer()
                        Text("×").foregroundStyle(Color(red: 0.62, green: 0.87, blue: 0.75))
                        Text("○").foregroundStyle(Color(red: 1, green: 0.68, blue: 0.48))
                        Spacer()
                    }.font(.system(size: 96, weight: .semibold, design: .rounded)).accessibilityHidden(true)
                    Text("Tic-Tac-Toe").font(.system(.largeTitle, design: .rounded).bold())
                    Text("Two players. Nine squares. One good rivalry.").foregroundStyle(.white.opacity(0.8))
                    HStack { Label("2 players", systemImage: "person.2"); Spacer(); Label("~2 min", systemImage: "clock") }.font(.subheadline)
                    NavigationLink { SetupView() } label: {
                        HStack { Text("Choose mode"); Spacer(); Image(systemName: "arrow.right") }
                            .font(.headline).padding(18).foregroundStyle(Palette.ink).background(Palette.paper, in: RoundedRectangle(cornerRadius: 15))
                    }
                }.padding(24).foregroundStyle(.white).background(Palette.ink, in: RoundedRectangle(cornerRadius: 28))
                Label("Ready offline", systemImage: "checkmark.circle.fill").font(.subheadline.bold()).foregroundStyle(Palette.teal)
                Text("This starter includes one bundled game. Matches stay on this device, ready whenever you are.")
                    .font(.subheadline).foregroundStyle(.secondary)
            }.padding(24)
        }.background(Palette.paper).navigationTitle("Discover").navigationBarTitleDisplayMode(.inline)
    }
}

struct SetupView: View {
    @EnvironmentObject var store: PortalStore
    @State private var first = ""
    @State private var second = "Player 2"
    @State private var created: UUID?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("Make room\nfor two.").font(.system(size: 36, weight: .bold, design: .rounded))
                VStack(alignment: .leading, spacing: 12) {
                    Label("Pass-and-play", systemImage: "iphone.gen3.radiowaves.left.and.right").font(.title3.bold())
                    Text("Share this phone. After each move, pass it to the other player.").foregroundStyle(.secondary)
                    Label("Works offline", systemImage: "checkmark.circle.fill").foregroundStyle(Palette.teal).font(.subheadline)
                }.padding(20).background(.white, in: RoundedRectangle(cornerRadius: 20))
                VStack(alignment: .leading, spacing: 12) {
                    Text("PLAYERS").font(.caption.bold()).tracking(2)
                    TextField("Player 1 · X", text: $first).accessibilityIdentifier("firstPlayer")
                    Divider()
                    TextField("Player 2 · O", text: $second).accessibilityIdentifier("secondPlayer")
                }.padding(20).background(.white, in: RoundedRectangle(cornerRadius: 20))
                PrimaryButton(title: "Start match  →") {
                    created = store.create(first: clean(first, fallback: store.guest), second: clean(second, fallback: "Player 2"))
                }.disabled(created != nil)
                Text("Online matches and invitations will be added when the shared service is connected.").font(.footnote).foregroundStyle(.secondary)
            }.padding(24)
        }.background(Palette.paper).navigationTitle("New match").navigationBarTitleDisplayMode(.inline)
            .onAppear { if first.isEmpty { first = store.guest } }
            .navigationDestination(item: $created) { id in MatchView(id: id) }
    }
    private func clean(_ value: String, fallback: String) -> String {
        let result = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return result.isEmpty ? fallback : String(result.prefix(30))
    }
}

struct MatchesView: View {
    @EnvironmentObject var store: PortalStore
    @State private var filter = "Active"
    private var filtered: [Match] { store.matches.filter { filter == "Finished" ? $0.isOver : !$0.isOver }.sorted { $0.updated > $1.updated } }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Pick up where\nyou left off.").font(.system(size: 34, weight: .bold, design: .rounded))
                Picker("Matches", selection: $filter) { Text("Active").tag("Active"); Text("Finished").tag("Finished") }.pickerStyle(.segmented)
                if filtered.isEmpty {
                    ContentUnavailableView(filter == "Active" ? "Your table is open" : "No finished matches", systemImage: "rectangle.stack", description: Text(filter == "Active" ? "Start a match from Discover. Your progress will be saved here." : "Complete a game to see its result here."))
                }
                ForEach(filtered) { match in
                    NavigationLink { MatchView(id: match.id) } label: {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack { Text("Tic-Tac-Toe").font(.title3.bold()); Spacer(); Image(systemName: "chevron.right") }
                            Text(match.names.joined(separator: " vs. ")).foregroundStyle(.secondary)
                            HStack {
                                Text(match.status).font(.subheadline.bold()).foregroundStyle(Palette.teal)
                                Spacer()
                                Text("LOCAL").font(.caption2.bold()).tracking(1)
                            }
                        }.padding(20).background(.white, in: RoundedRectangle(cornerRadius: 20))
                    }.buttonStyle(.plain)
                }
                NavigationLink { SetupView() } label: { Label("New match", systemImage: "plus.circle.fill").font(.headline).frame(maxWidth: .infinity).padding() }
            }.padding(24)
        }.background(Palette.paper).navigationTitle("My Matches").navigationBarTitleDisplayMode(.inline)
    }
}

struct MatchView: View {
    let id: UUID
    @EnvironmentObject var store: PortalStore
    @Environment(\.dismiss) private var dismiss
    @State private var confirmHide = false
    var body: some View {
        Group {
            if let match = store.matches.first(where: { $0.id == id }) {
                ScrollView {
                    VStack(spacing: 20) {
                        HStack {
                            Label("LOCAL MATCH", systemImage: "iphone").font(.caption.bold())
                            Spacer()
                            Label("On this device", systemImage: "internaldrive").font(.caption)
                        }.foregroundStyle(.secondary)
                        Text(match.status).font(.system(.title, design: .rounded).bold()).multilineTextAlignment(.center)
                        HStack {
                            player(match.names[0], mark: "X", active: !match.isOver && match.turn == 0)
                            Text("vs").font(.caption).foregroundStyle(.secondary)
                            player(match.names[1], mark: "O", active: !match.isOver && match.turn == 1)
                        }
                        if match.awaitingHandoff && !match.isOver {
                            VStack(spacing: 22) {
                                Image(systemName: "hand.raised.fill").font(.system(size: 48)).foregroundStyle(Palette.teal)
                                Text("Pass the phone to\n\(match.names[match.turn])").font(.title2.bold()).multilineTextAlignment(.center)
                                Text("The board is hidden until the next player is ready.").foregroundStyle(.secondary).multilineTextAlignment(.center)
                                PrimaryButton(title: "I’m \(match.names[match.turn]) · Continue") { store.reveal(id: id) }
                            }.padding(24).frame(minHeight: 340).background(.white, in: RoundedRectangle(cornerRadius: 24))
                        } else {
                            GameWebView(match: match) { cell, player in store.move(id: id, cell: cell, player: player) }
                                .frame(height: 350).clipShape(RoundedRectangle(cornerRadius: 24))
                        }
                        if match.isOver {
                            Label(match.winner == nil ? "A well-matched pair." : "Nicely played!", systemImage: "flag.checkered").font(.headline)
                            Button("Hide finished match", role: .destructive) { confirmHide = true }.padding()
                        } else {
                            Text("Three in a row wins. You can leave this screen and resume from My Matches.").font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                        }
                    }.padding(24)
                }
            } else { ContentUnavailableView("Match unavailable", systemImage: "rectangle.stack") }
        }.background(Palette.paper).navigationTitle("Tic-Tac-Toe").navigationBarTitleDisplayMode(.inline)
            .confirmationDialog("Hide this finished match from this device?", isPresented: $confirmHide, titleVisibility: .visible) {
                Button("Hide match", role: .destructive) { store.hide(id: id); dismiss() }
            }
    }
    private func player(_ name: String, mark: String, active: Bool) -> some View {
        VStack(spacing: 6) {
            Text(mark).font(.title2.bold()).foregroundStyle(mark == "X" ? Palette.teal : Palette.orange)
            Text(name).font(.subheadline.bold()).lineLimit(2)
        }.frame(maxWidth: .infinity).padding(12).background(active ? Palette.teal.opacity(0.10) : .white, in: RoundedRectangle(cornerRadius: 16))
    }
}


// Read-only integration with the shared course API. Online play opens the class portal.
private struct ClassGame: Decodable, Identifiable {
    let id: String
    let name: String
    let description: String
    let allowed_player_counts: [Int]
}

struct ClassGamesView: View {
    @State private var games: [ClassGame] = []
    @State private var loading = false
    @State private var error: String?
    @State private var refreshed: Date?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Label("SHARED CLASS PLATFORM", systemImage: "network")
                    .font(.caption.bold()).tracking(2).foregroundStyle(Palette.teal)
                Text("More games.\nOne community.")
                    .font(.system(size: 36, weight: .bold, design: .rounded))
                Text("Explore games from the class server. Online matches open in the shared web portal.")
                    .foregroundStyle(.secondary)
                Link(destination: URL(string: "https://buildplay.fun/portal")!) {
                    Label("Open online portal", systemImage: "arrow.up.right.square")
                        .font(.headline).frame(maxWidth: .infinity).padding(18)
                        .foregroundStyle(.white).background(Palette.teal, in: RoundedRectangle(cornerRadius: 16))
                }
                Text("Your local guest profile and offline matches stay separate from your online account.")
                    .font(.footnote).foregroundStyle(.secondary)
                if loading { ProgressView("Loading class games…").frame(maxWidth: .infinity) }
                if let error {
                    VStack(alignment: .leading, spacing: 10) {
                        Label("Couldn’t refresh the catalog", systemImage: "wifi.exclamationmark").font(.headline)
                        Text(error).font(.subheadline)
                        Button("Try again") { Task { await refresh() } }.disabled(loading)
                    }.padding().background(.white, in: RoundedRectangle(cornerRadius: 16))
                }
                if let refreshed {
                    HStack {
                        Text("\(games.count) games")
                        Spacer()
                        Text("Updated \(refreshed.formatted(date: .omitted, time: .shortened))")
                    }.font(.caption).foregroundStyle(.secondary)
                }
                ForEach(games) { game in
                    VStack(alignment: .leading, spacing: 12) {
                        Text(game.name).font(.title2.bold())
                        Text(game.description).font(.subheadline).foregroundStyle(.secondary)
                        Label(game.allowed_player_counts.map(String.init).joined(separator: ", ") + " players", systemImage: "person.2")
                            .font(.caption.bold()).foregroundStyle(Palette.teal)
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(20)
                        .background(.white, in: RoundedRectangle(cornerRadius: 20))
                }
                if !loading && error == nil && refreshed != nil && games.isEmpty {
                    Text("No games have been published yet.").foregroundStyle(.secondary)
                }
                Text("Source: buildplay.fun · Pull down to refresh")
                    .font(.footnote).foregroundStyle(.secondary)
            }.padding(24)
        }.background(Palette.paper).navigationTitle("Class Games").navigationBarTitleDisplayMode(.inline)
            .task { if refreshed == nil { await refresh() } }
            .refreshable { await refresh() }
            .toolbar {
                Button { Task { await refresh() } } label: { Image(systemName: "arrow.clockwise") }
                    .accessibilityLabel("Refresh class games").disabled(loading)
            }
    }

    @MainActor private func refresh() async {
        guard !loading else { return }
        loading = true
        error = nil
        defer { loading = false }
        do {
            var request = URLRequest(url: URL(string: "https://buildplay.fun/games")!)
            request.timeoutInterval = 15
            request.cachePolicy = .reloadIgnoringLocalCacheData
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw URLError(.badServerResponse)
            }
            games = try JSONDecoder().decode([ClassGame].self, from: data)
                .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            refreshed = Date()
        } catch is CancellationError {
        } catch let failure as URLError where failure.code == .cancelled {
        } catch {
            self.error = "Check your connection and try again. Offline Tic-Tac-Toe is still available in Discover."
        }
    }
}

import WebKit
import Security

private struct OnlineIdentity: Codable { let id: String; let password: String; let display_name: String }
private struct OnlineMatch: Identifiable {
    let json: [String: Any]
    var id: String { json["id"] as? String ?? "" }
    var status: String { json["status"] as? String ?? "" }
    var players: [[String: Any]] { json["players"] as? [[String: Any]] ?? [] }
    var count: Int { json["move_count"] as? Int ?? 0 }
}

@MainActor private final class OnlineStore: ObservableObject {
    @Published var identity: OnlineIdentity?
    @Published var games: [[String: Any]] = []
    @Published var matches: [OnlineMatch] = []
    @Published var open: [OnlineMatch] = []
    @Published var selected: OnlineMatch?
    @Published var code = ""
    @Published var error: String?
    @Published var busy = false
    private var refreshing = false
    private var gameKey = ""
    private let key: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "edu.columbia.gameportal.online", kSecAttrAccount as String: "buildplay.fun"]
    init() {
        var query = key
        query[kSecReturnData as String] = true
        var result: CFTypeRef?
        if SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data {
            identity = try? JSONDecoder().decode(OnlineIdentity.self, from: data)
        }
    }
    func request(_ path: String, _ method: String = "GET", _ body: [String: Any]? = nil) async throws -> Any {
        var r = URLRequest(url: URL(string: "https://buildplay.fun" + path)!)
        r.httpMethod = method; r.timeoutInterval = 15; r.cachePolicy = .reloadIgnoringLocalCacheData
        if let identity {
            r.setValue(identity.id, forHTTPHeaderField: "X-User-Id")
            r.setValue(identity.password, forHTTPHeaderField: "X-User-Password")
        }
        if let body { r.httpBody = try JSONSerialization.data(withJSONObject: body); r.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let (data, response) = try await URLSession.shared.data(for: r)
        let json = (try? JSONSerialization.jsonObject(with: data)) ?? [:]
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw NSError(domain: "Portal", code: (response as? HTTPURLResponse)?.statusCode ?? 0, userInfo: [NSLocalizedDescriptionKey: (json as? [String: Any])?["detail"] as? String ?? "The server rejected this request. Please refresh and try again."])
        }
        return json
    }
    func account(_ name: String) async {
        await act {
            let json = try await self.request("/users", "POST", ["display_name": name])
            let data = try JSONSerialization.data(withJSONObject: json)
            let user = try JSONDecoder().decode(OnlineIdentity.self, from: data)
            self.identity = user
            var item = self.key
            item[kSecValueData as String] = try JSONEncoder().encode(user)
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let status = SecItemAdd(item as CFDictionary, nil)
            guard status == errSecSuccess else { throw NSError(domain: "Keychain", code: Int(status), userInfo: [NSLocalizedDescriptionKey: "Account created, but secure storage failed. Keep the app open for this session."]) }
        }
    }
    func act(_ operation: () async throws -> Void) async {
        guard !busy else { return }; busy = true; error = nil
        do { try await operation() } catch { self.error = error.localizedDescription }
        busy = false
        await refresh()
    }
    func refresh() async {
        guard !refreshing && !busy else { return }; refreshing = true
        defer { refreshing = false }
        do {
            games = try await request("/games") as? [[String: Any]] ?? []
            if identity != nil { matches = (try await request("/matches") as? [[String: Any]] ?? []).map { OnlineMatch(json: $0) } }
            open = (try await request("/matches/open") as? [[String: Any]] ?? []).map { OnlineMatch(json: $0) }
            if let id = selected?.id {
                let json = try await request("/matches/" + id) as? [String: Any] ?? [:]
                if selected?.id == id { selected = OnlineMatch(json: json); try await loadGame() }
            }
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
    // Dedicated refresh for the open match. Errors propagate to the status card.
    func refreshSelected() async throws {
        guard let id = selected?.id else { return }
        let json = try await request("/matches/" + id) as? [String: Any] ?? [:]
        guard selected?.id == id else { return }
        selected = OnlineMatch(json: json)
        try await loadGame()
        error = nil
    }
    func loadGame() async throws {
        guard let match = selected, match.status != "waiting_for_players", let id = match.json["game_id"] as? String, let version = match.json["game_version"] as? Int else { return }
        let key = "\(match.id)/\(id)/\(version)"
        guard key != gameKey else { return }
        let game = try await request("/games/\(id)/versions/\(version)") as? [String: Any]
        guard selected?.id == match.id else { return }
        code = game?["code"] as? String ?? ""; gameKey = key
    }
    func choose(_ match: OnlineMatch) async { selected = match; code = ""; gameKey = ""; await refresh() }
    func create(_ game: String, computers: Int) async {
        await act {
            let json = try await self.request("/matches", "POST", ["game_id": game, "num_computer_opponents": computers]) as? [String: Any] ?? [:]
            self.selected = OnlineMatch(json: json); self.code = ""; self.gameKey = ""
        }
    }
    func action(_ name: String) async {
        guard let id = selected?.id else { return }
        await act { let json = try await self.request("/matches/\(id)/\(name)", "POST", [:]) as? [String: Any] ?? [:]; self.selected = OnlineMatch(json: json) }
    }
    var mySeat: Int? { selected?.players.first { $0["user_id"] as? String == identity?.id }?["player_index"] as? Int }
    var acting: Int? {
        guard let match = selected, match.status == "ongoing", let seat = mySeat else { return nil }
        let turns = match.json["turn_of_player_indices"] as? [Int] ?? []
        if turns.contains(seat) { return seat }
        return turns.first { i in match.players.contains { ($0["player_index"] as? Int) == i && ($0["kind"] as? String) == "computer" } }
    }
    var payload: [String: Any] {
        guard let m = selected else { return [:] }
        return ["type": "state_changed", "state": m.json["state"] ?? NSNull(), "players": m.players.map { p -> [String: Any] in
            var p = p; p["name"] = (p["kind"] as? String == "computer") ? "Computer" : ((p["user_id"] as? String == identity?.id) ? identity?.display_name ?? "You" : "Player \((p["player_index"] as? Int ?? 0) + 1)"); return p
        }, "turn_of_player_indices": m.json["turn_of_player_indices"] ?? NSNull(), "turn_of_player_index": (m.json["turn_of_player_indices"] as? [Int])?.first as Any? ?? NSNull(), "status": m.status, "end_reason": m.json["end_reason"] ?? NSNull(), "move_count": m.count, "my_player_index": mySeat as Any? ?? NSNull(), "acting_for_player_index": acting as Any? ?? NSNull()]
    }
    func move(_ message: [String: Any], matchID: String, count: Int) async {
        guard let m = selected, m.id == matchID, m.count == count, acting != nil, message["type"] as? String == "make_move", let state = message["new_state"] else { return }
        let turns: Any = message["next_turn_player_indices"] ?? (message["next_turn_player_index"] as? Int).map { [$0] } as Any? ?? NSNull()
        await act { _ = try await self.request("/matches/\(m.id)/moves", "POST", ["new_state": state, "next_turn_player_indices": turns, "expected_move_count": count]) }
    }
    func title(_ m: OnlineMatch) -> String { games.first { $0["id"] as? String == m.json["game_id"] as? String }?["name"] as? String ?? "Game" }
}

struct OnlinePortalView: View {
    @StateObject private var store = OnlineStore()
    @State private var name = ""
    @State private var game = ""
    @State private var computers = 1
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if let error = store.error { Text(error).foregroundStyle(.red).font(.footnote); Button("Dismiss") { store.error = nil } }
                if let user = store.identity {
                    Label("Online as \(user.display_name)", systemImage: "person.crop.circle.badge.checkmark").font(.headline)
                    if let match = store.selected {
                        Button("← All online matches") { store.selected = nil; store.code = "" }
                        Text(store.title(match)).font(.largeTitle.bold())
                        Text(match.status.replacingOccurrences(of: "_", with: " ") + " · \(match.count) moves").foregroundStyle(.secondary)
                        OnlineMatchControls(
                            matchURL: URL(string: "https://buildplay.fun/portal#match=\(match.id)")!,
                            refresh: { try await store.refreshSelected() },
                            phase: matchPhase(match),
                            moveCount: match.count
                        )
                        if match.status == "waiting_for_players" {
                            Text("\(match.players.count) players seated")
                            if store.mySeat == nil { Button("Join match") { Task { await store.action("join") } }.buttonStyle(.borderedProminent) }
                            if match.json["owner_user_id"] as? String == user.id { Button("Start online match") { Task { await store.action("start") } }.buttonStyle(.borderedProminent) }
                        } else if !store.code.isEmpty {
                            Text(match.status == "over" ? "Match finished" : store.acting != nil ? "Your turn (or your computer’s turn)" : "Waiting for another player…").font(.subheadline)
                            SharedGameView(code: store.code, payload: store.payload) { message in
                                Task { await store.move(message, matchID: match.id, count: match.count) }
                            }.id(match.id).frame(height: 520)
                        } else { ProgressView("Loading game…") }
                    } else {
                        Text("Play together.").font(.largeTitle.bold())
                        Picker("Game", selection: $game) {
                            Text("Choose a game").tag("")
                            ForEach(store.games.compactMap { $0["id"] as? String }, id: \.self) { id in Text(store.games.first { $0["id"] as? String == id }?["name"] as? String ?? id).tag(id) }
                        }
                        Stepper("Computer opponents: \(computers)", value: $computers, in: 0...9)
                        Text("Use 0 to invite another person. Choose a game’s supported player count before starting.").font(.caption).foregroundStyle(.secondary)
                        Button("Create online match") { Task { await store.create(game, computers: computers) } }.buttonStyle(.borderedProminent).disabled(game.isEmpty)
                        Text("My online matches").font(.title2.bold())
                        if store.matches.isEmpty { Text("No online matches yet.") }
                        ForEach(store.matches) { match in matchButton(match) }
                        Text("Open matches").font(.title2.bold())
                        ForEach(store.open.filter { m in !m.players.contains { $0["user_id"] as? String == user.id } }) { match in matchButton(match) }
                    }
                } else {
                    Text("Join the class.").font(.largeTitle.bold())
                    Text("Create an online guest account on buildplay.fun. Your credentials are saved securely on this device.")
                    TextField("Online display name", text: $name).textFieldStyle(.roundedBorder).accessibilityIdentifier("onlineName")
                    Button("Create online account") { Task { await store.account(name.trimmingCharacters(in: .whitespacesAndNewlines)) } }.buttonStyle(.borderedProminent).disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                if store.busy { ProgressView() }
            }.frame(maxWidth: .infinity, alignment: .leading).padding(24).disabled(store.busy)
        }.background(Palette.paper).navigationTitle("Online Play")
            .task(id: store.selected?.id) {
                if store.selected != nil { return } // Open matches use OnlineMatchControls polling.
                while !Task.isCancelled {
                    await store.refresh()
                    do { try await Task.sleep(nanoseconds: 2_000_000_000) } catch { break }
                }
            }
            .refreshable { await store.refresh() }
    }
    private func matchPhase(_ match: OnlineMatch) -> OnlineMatchPhase {
        if match.status == "waiting_for_players" { return .waitingForOpponent }
        if match.status == "over" || match.status == "finished" { return .finished }
        if store.mySeat == nil { return .spectator }
        if let seat = store.mySeat,
           (match.json["turn_of_player_indices"] as? [Int] ?? []).contains(seat) { return .yourTurn }
        return .opponentsTurn
    }
    private func matchButton(_ m: OnlineMatch) -> some View {
        Button { Task { await store.choose(m) } } label: {
            VStack(alignment: .leading) { Text(store.title(m)).bold(); Text(m.status.replacingOccurrences(of: "_", with: " ") + " · \(m.count) moves").font(.caption) }.frame(maxWidth: .infinity, alignment: .leading).padding().background(.white, in: RoundedRectangle(cornerRadius: 12))
        }
    }
}

// Untrusted shared game HTML is isolated in an opaque-origin iframe with no network access.
private struct SharedGameView: UIViewRepresentable {
    let code: String
    let payload: [String: Any]
    let onMove: ([String: Any]) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.userContentController.add(context.coordinator, name: "sharedMove")
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        let encoded = Data(code.utf8).base64EncodedString()
        view.loadHTMLString("""
        <html><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; frame-src about:"></head><body style="margin:0"><iframe id="game" sandbox="allow-scripts" style="border:0;width:100%;height:100vh"></iframe><script>
        const f=document.getElementById('game'); let latest=null,armed=false;
        window.receiveNative=(p)=>{latest=p;armed=true;f.contentWindow.postMessage(p,'*')};
        f.onload=()=>{if(latest)f.contentWindow.postMessage(latest,'*')};
        window.addEventListener('message',e=>{if(e.source===f.contentWindow&&armed&&e.data&&e.data.type==='make_move'){armed=false;window.webkit.messageHandlers.sharedMove.postMessage(e.data)}});
        f.srcdoc=new TextDecoder().decode(Uint8Array.from(atob('\(encoded)'),c=>c.charCodeAt(0)));
        </script></body></html>
        """, baseURL: nil)
        return view
    }
    func updateUIView(_ view: WKWebView, context: Context) { context.coordinator.parent = self; context.coordinator.send(view) }
    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) { view.configuration.userContentController.removeScriptMessageHandler(forName: "sharedMove"); view.navigationDelegate = nil }
    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        var parent: SharedGameView
        var ready = false
        var sent: Data?
        init(_ parent: SharedGameView) { self.parent = parent }
        func webView(_ view: WKWebView, didFinish navigation: WKNavigation!) { ready = true; send(view) }
        func send(_ view: WKWebView) {
            guard ready, let data = try? JSONSerialization.data(withJSONObject: parent.payload, options: [.sortedKeys]), data != sent else { return }
            sent = data
            view.callAsyncJavaScript("window.receiveNative(payload)", arguments: ["payload": parent.payload], in: nil, in: .page) { _ in }
        }
        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.frameInfo.isMainFrame, let json = message.body as? [String: Any] else { return }
            sent = nil
            parent.onMove(json)
        }
        func webView(_ view: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            decisionHandler(action.request.url?.scheme == "about" ? .allow : .cancel)
        }
    }
}

// MARK: - Multiplayer invite and live-sync controls

/// State comes from the backend's current match response; the controls never
/// guess whose turn it is based on a timer or a local move counter.
enum OnlineMatchPhase: Equatable {
    case waitingForOpponent
    case yourTurn
    case opponentsTurn
    case finished
    case spectator

    var label: String {
        switch self {
        case .waitingForOpponent: return "Waiting for another player"
        case .yourTurn: return "Your turn"
        case .opponentsTurn: return "Opponent's turn"
        case .finished: return "Match finished"
        case .spectator: return "Watching match"
        }
    }

    var symbol: String {
        switch self {
        case .waitingForOpponent: return "person.crop.circle.badge.clock"
        case .yourTurn: return "hand.point.up.left.fill"
        case .opponentsTurn: return "hourglass"
        case .finished: return "flag.checkered"
        case .spectator: return "eye"
        }
    }
}

/// Usability controls for an existing server-backed match screen.
/// Requirements: iOS 16+, SwiftUI, an actual share URL, and a refresh closure.
/// IMPORTANT: Disable any other automatic polling for this match when using
/// autoRefreshEnabled=true. Do not include authentication tokens in share URLs.
struct OnlineMatchControls: View {
    let matchURL: URL
    let refresh: () async throws -> Void
    var phase: OnlineMatchPhase = .waitingForOpponent
    /// Pass the server's move count to indicate when a remote move appears.
    var moveCount: Int? = nil
    var autoRefreshEnabled: Bool = true
    var refreshIntervalSeconds: Double = 2

    @Environment(\.scenePhase) private var scenePhase
    @State private var isRefreshing = false
    @State private var lastError: String?
    @State private var lastUpdated: Date?
    @State private var didCopy = false
    @State private var showQRCode = false
    @State private var showNewMove = false
    @State private var previousMoveCount: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: phase.symbol)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(phase.label).font(.headline)
                    Text(statusDescription)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                if isRefreshing {
                    ProgressView().controlSize(.small)
                        .accessibilityLabel("Synchronizing match")
                } else {
                    Image(systemName: lastError == nil ? "checkmark.icloud" : "wifi.slash")
                        .foregroundStyle(lastError == nil ? .green : .orange)
                        .accessibilityLabel(lastError == nil ? "Connection available" : "Connection error")
                }
            }

            if showNewMove {
                Label("New move received!", systemImage: "sparkles")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.blue)
                    .accessibilityAddTraits(.updatesFrequently)
            }

            if phase == .waitingForOpponent {
                Text("Invite a friend to join this match. They'll open the link in the class portal.")
                    .font(.subheadline)
            }

            HStack(spacing: 8) {
                ShareLink(item: matchURL) {
                    Label("Share", systemImage: "square.and.arrow.up")
                }
                Button {
                    UIPasteboard.general.url = matchURL
                    didCopy = true
                } label: {
                    Label(didCopy ? "Copied" : "Copy", systemImage: "link")
                }
                Button {
                    showQRCode = true
                } label: {
                    Label("QR Code", systemImage: "qrcode")
                }
                Spacer(minLength: 0)
                Button {
                    Task { await refreshOnce() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .accessibilityLabel("Refresh match")
                .disabled(isRefreshing)
            }
            .buttonStyle(.bordered)

            if let lastError {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Unable to sync", systemImage: "wifi.exclamationmark")
                        .font(.subheadline.weight(.semibold))
                    Text(lastError).font(.caption)
                    Button("Try Again") {
                        Task { await refreshOnce() }
                    }
                    .disabled(isRefreshing)
                }
                .foregroundStyle(.orange)
            } else if let lastUpdated {
                Text("Synced at \(lastUpdated.formatted(date: .omitted, time: .standard))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(12)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
        .sheet(isPresented: $showQRCode) {
            NavigationStack {
                VStack(spacing: 16) {
                    Text("Scan to join")
                        .font(.title2.bold())
                    if let image = qrCodeImage {
                        Image(uiImage: image)
                            .interpolation(.none)
                            .resizable()
                            .scaledToFit()
                            .frame(width: 250, height: 250)
                            .accessibilityLabel("QR code for match invitation")
                    } else {
                        Text("Couldn't generate QR code. Use Share or Copy instead.")
                    }
                    Text("The person scanning will open the match in the class web portal.")
                        .font(.subheadline)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                }
                .padding()
                .navigationTitle("Invite player")
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { showQRCode = false }
                    }
                }
            }
            .presentationDetents([.medium, .large])
        }
        .onAppear {
            previousMoveCount = moveCount
        }
        .onChange(of: moveCount) { newValue in
            defer { previousMoveCount = newValue }
            guard let newValue, let oldValue = previousMoveCount,
                  newValue > oldValue else { return }
            // A server-side counter advance is not necessarily an opponent move:
            // show this neutral indicator, including for computer turns.
            showNewMove = true
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            await refreshOnce()
            guard autoRefreshEnabled else { return }
            while !Task.isCancelled {
                do {
                    try await Task.sleep(nanoseconds: UInt64(max(1, refreshIntervalSeconds) * 1_000_000_000))
                } catch { break }
                guard !Task.isCancelled else { break }
                await refreshOnce()
            }
        }
    }

    private var statusDescription: String {
        switch phase {
        case .waitingForOpponent: return "Invite someone to get started"
        case .yourTurn: return "Make your move in the game below"
        case .opponentsTurn: return "Updates automatically while you wait"
        case .finished: return "You can still share or review the result"
        case .spectator: return "Watching updates live"
        }
    }

    private var qrCodeImage: UIImage? {
        let context = CIContext()
        let generator = CIFilter.qrCodeGenerator()
        generator.message = Data(matchURL.absoluteString.utf8)
        generator.correctionLevel = "M"
        guard let output = generator.outputImage,
              let image = context.createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: image)
    }

    @MainActor
    private func refreshOnce() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            try await refresh()
            guard !Task.isCancelled else { return }
            lastUpdated = Date()
            lastError = nil
        } catch is CancellationError {
            // Backgrounding or leaving the screen is not a network error.
        } catch {
            lastError = error.localizedDescription
        }
    }
}

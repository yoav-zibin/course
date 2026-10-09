import SwiftUI

@MainActor final class PortalStore: ObservableObject {
    @Published var guest = ""
    @Published var matches: [Match] = []
    @Published var storageError: String?
    private let file: URL

    init() {
        file = URL.documentsDirectory.appending(path: "portal.json")
        guard FileManager.default.fileExists(atPath: file.path) else { return }
        do {
            let saved = try JSONDecoder().decode(SavedPortal.self, from: Data(contentsOf: file))
            guard saved.matches.allSatisfy({ $0.names.count == 2 && $0.board.count == 9 && (0...1).contains($0.turn) && $0.board.allSatisfy { $0 == nil || $0 == "X" || $0 == "O" } }) else {
                throw CocoaError(.fileReadCorruptFile)
            }
            guest = saved.guest
            matches = saved.matches
        } catch { storageError = "Saved matches could not be loaded. The existing file has been kept. \(error.localizedDescription)" }
    }
    func save() {
        do {
            let data = try JSONEncoder().encode(SavedPortal(guest: guest, matches: matches))
            try data.write(to: file, options: .atomic)
        } catch { storageError = "Your latest change could not be saved. \(error.localizedDescription)" }
    }
    func create(first: String, second: String) -> UUID {
        let match = Match(names: [first, second])
        matches.insert(match, at: 0)
        save()
        return match.id
    }
    func move(id: UUID, cell: Int, player: Int) {
        guard let i = matches.firstIndex(where: { $0.id == id }), matches[i].play(cell: cell, player: player) else { return }
        save()
    }
    func reveal(id: UUID) {
        guard let i = matches.firstIndex(where: { $0.id == id }) else { return }
        matches[i].awaitingHandoff = false
        save()
    }
    func hide(id: UUID) {
        matches.removeAll { $0.id == id && $0.isOver }
        save()
    }
}

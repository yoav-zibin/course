import Foundation

func expect(_ value: @autoclosure () -> Bool, _ message: String) {
    precondition(value(), message)
}
var match = Match(names: ["Juan", "Kelly"])
expect(!match.play(cell: -1, player: 0), "Reject invalid cell")
expect(!match.play(cell: 0, player: 1), "Reject wrong player")
expect(match.play(cell: 0, player: 0), "Accept opening move")
expect(!match.play(cell: 1, player: 1), "Require handoff")
match.awaitingHandoff = false
expect(!match.play(cell: 0, player: 1), "Reject occupied cell")
for cell in [3, 1, 4, 2] {
    expect(match.play(cell: cell, player: match.turn), "Accept legal move")
    if !match.isOver { match.awaitingHandoff = false }
}
expect(match.winner == 0 && match.isOver, "Recognize X win")
expect(!match.play(cell: 8, player: match.turn), "Reject moves after win")
var draw = Match(names: ["A", "B"])
for cell in [0,1,2,4,3,5,7,6,8] {
    expect(draw.play(cell: cell, player: draw.turn), "Accept draw sequence")
    if !draw.isOver { draw.awaitingHandoff = false }
}
expect(draw.isOver && draw.winner == nil, "Recognize draw")
for line in [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]] {
    for mark in ["X", "O"] {
        var won = Match(names: ["A", "B"])
        for cell in line { won.board[cell] = mark }
        expect(won.winner == (mark == "X" ? 0 : 1), "Recognize every winning line")
    }
}
var handoff = Match(names: ["A", "B"])
expect(handoff.play(cell: 4, player: 0), "Accept move before persistence")
let saved = SavedPortal(guest: "Juan", matches: [match, draw, handoff])
let data = try JSONEncoder().encode(saved)
let url = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(UUID().uuidString)
try data.write(to: url, options: .atomic)
defer { try? FileManager.default.removeItem(at: url) }
let restored = try JSONDecoder().decode(SavedPortal.self, from: Data(contentsOf: url))
expect(restored.matches == saved.matches && restored.guest == "Juan", "Persist full state, including pending handoff")
print("PASS: legal moves, invalid moves, handoff, all winning lines, draw, game over, disk persistence")

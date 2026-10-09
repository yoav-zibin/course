import Foundation

struct Match: Codable, Identifiable, Equatable {
    var id = UUID()
    var names: [String]
    var board: [String?] = Array(repeating: nil, count: 9)
    var turn = 0
    var awaitingHandoff = false
    var updated = Date()
    var winner: Int? {
        for line in [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]] {
            if let mark = board[line[0]], line.allSatisfy({ board[$0] == mark }) {
                return mark == "X" ? 0 : 1
            }
        }
        return nil
    }
    var isOver: Bool { winner != nil || board.allSatisfy { $0 != nil } }
    var status: String {
        if let winner { return "\(names[winner]) won" }
        return isOver ? "Draw game" : "\(names[turn])’s turn"
    }
    mutating func play(cell: Int, player: Int) -> Bool {
        guard !isOver, !awaitingHandoff, player == turn, board.indices.contains(cell), board[cell] == nil else { return false }
        board[cell] = turn == 0 ? "X" : "O"
        if !isOver { turn = 1 - turn; awaitingHandoff = true }
        updated = Date()
        return true
    }
}

struct SavedPortal: Codable {
    var guest: String
    var matches: [Match]
}

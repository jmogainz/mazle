import Foundation

struct LocalHistoryEntry: Codable, Equatable, Identifiable, Sendable {
    let date: String
    let puzzleNumber: Int
    let completed: Bool
    let won: Bool
    let timeSeconds: Int?
    let attemptsUsed: Int
    let totalMoves: Int

    var id: String { date }
}

@MainActor
enum LocalHistoryStore {
    private static let key = "mazle.localHistory.v1"
    private static let encoder = JSONEncoder()
    private static let decoder = JSONDecoder()

    static func entries() -> [LocalHistoryEntry] {
        guard let data = UserDefaults.standard.data(forKey: key),
              let decoded = try? decoder.decode([LocalHistoryEntry].self, from: data) else {
            return []
        }
        return decoded.sorted { $0.date < $1.date }
    }

    static func record(_ entry: LocalHistoryEntry) {
        var current = entries()
        current.removeAll { $0.date == entry.date }
        current.append(entry)
        if let data = try? encoder.encode(current.sorted { $0.date < $1.date }) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }
}

import Foundation

@MainActor
enum LocalCache {
    private static let defaults = UserDefaults.standard
    private static let encoder = JSONEncoder()
    private static let decoder = JSONDecoder()

    static func savePuzzle(_ puzzle: Puzzle, date: String) {
        guard let data = try? encoder.encode(puzzle) else { return }
        defaults.set(data, forKey: puzzleKey(date))
    }

    static func loadPuzzle(date: String) -> Puzzle? {
        guard let data = defaults.data(forKey: puzzleKey(date)) else { return nil }
        return try? decoder.decode(Puzzle.self, from: data)
    }

    static func saveSnapshot(_ snapshot: GameSnapshot) {
        guard let data = try? encoder.encode(snapshot) else { return }
        defaults.set(data, forKey: snapshotKey(snapshot.date))
    }

    static func loadSnapshot(date: String) -> GameSnapshot? {
        guard let data = defaults.data(forKey: snapshotKey(date)) else { return nil }
        return try? decoder.decode(GameSnapshot.self, from: data)
    }

    static func removeSnapshot(date: String) {
        defaults.removeObject(forKey: snapshotKey(date))
    }

    private static func puzzleKey(_ date: String) -> String { "mazle.puzzle.\(date)" }
    private static func snapshotKey(_ date: String) -> String { "mazle.snapshot.\(date)" }
}

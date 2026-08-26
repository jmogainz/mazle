import Foundation

enum ResultShareMapKind: Equatable, Sendable {
    case ice
    case ground

    var emoji: String {
        switch self {
        case .ice: return "🧊"
        case .ground: return "🟤"
        }
    }
}

enum ResultShareFormatter {
    static func text(
        puzzleNumber: Int,
        formattedTime: String,
        optimalMoves: Int,
        attempts: [AttemptRecord],
        won: Bool,
        mapKind: ResultShareMapKind?,
        maxLives: Int
    ) -> String {
        let safeOptimalMoves = max(1, optimalMoves)
        let safeMaxLives = max(1, maxLives)
        let mapSuffix = mapKind.map { " \($0.emoji)" } ?? ""
        let title = "Mazle #\(puzzleNumber)\(mapSuffix)"

        let attemptRows = attempts.map { attempt in
            let filledBlocks = min(
                max(0, attempt.moveCount),
                max(0, safeOptimalMoves - 1)
            )
            let remainingBlocks = max(0, safeOptimalMoves - filledBlocks - 1)
            return String(repeating: "🟥", count: filledBlocks)
                + "❌"
                + String(repeating: "⬜", count: remainingBlocks)
        }

        var rows = attemptRows
        if won {
            rows.append(String(repeating: "🟩", count: safeOptimalMoves) + "🏆")
        }

        let scoreText: String
        if won {
            let attemptsUsed = min(safeMaxLives, max(1, attempts.count + 1))
            scoreText = "\(attemptsUsed)/\(safeMaxLives)"
        } else {
            scoreText = "X/\(safeMaxLives)"
        }

        return "\(title)\n\n\(rows.joined(separator: "\n"))\n\n\(formattedTime) • \(scoreText)\nmazle.io"
    }
}

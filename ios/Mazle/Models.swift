import Foundation

/// Tile IDs are intentionally identical to the Rust/TypeScript Mazle contract.
enum TileType: Int, Codable, CaseIterable, Sendable {
    case ground = 0
    case wall = 1
    case start = 2
    case goal = 3
    case ice = 4
    case ledgeUp = 5
    case ledgeDown = 6
    case ledgeLeft = 7
    case ledgeRight = 8
    case boulder = 9

    var isBlocking: Bool { self == .wall }
    var isSliding: Bool { self == .ice }
}

struct GridPosition: Codable, Hashable, Equatable, Sendable {
    let x: Int
    let y: Int
}

enum Direction: String, Codable, CaseIterable, Sendable {
    case up
    case down
    case left
    case right

    var delta: GridPosition {
        switch self {
        case .up: return GridPosition(x: 0, y: -1)
        case .down: return GridPosition(x: 0, y: 1)
        case .left: return GridPosition(x: -1, y: 0)
        case .right: return GridPosition(x: 1, y: 0)
        }
    }

    var systemImage: String {
        switch self {
        case .up: return "chevron.up"
        case .down: return "chevron.down"
        case .left: return "chevron.left"
        case .right: return "chevron.right"
        }
    }
}

struct Puzzle: Codable, Equatable, Sendable {
    let width: Int
    let height: Int
    let tiles: [[TileType]]
    let start: GridPosition
    let goal: GridPosition
    let optimalMoves: Int
    let solutionPath: [GridPosition]?
    let difficultyScore: Int?

    init(
        width: Int,
        height: Int,
        tiles: [[TileType]],
        start: GridPosition,
        goal: GridPosition,
        optimalMoves: Int,
        solutionPath: [GridPosition]?,
        difficultyScore: Int? = nil
    ) {
        self.width = width
        self.height = height
        self.tiles = tiles
        self.start = start
        self.goal = goal
        self.optimalMoves = optimalMoves
        self.solutionPath = solutionPath
        self.difficultyScore = difficultyScore
    }

    private enum CodingKeys: String, CodingKey {
        case width
        case height
        case tiles
        case start
        case goal
        case optimalMoves
        case solutionPath
        case difficultyScore
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        width = try container.decode(Int.self, forKey: .width)
        height = try container.decode(Int.self, forKey: .height)
        start = try container.decode(GridPosition.self, forKey: .start)
        goal = try container.decode(GridPosition.self, forKey: .goal)
        optimalMoves = try container.decode(Int.self, forKey: .optimalMoves)
        solutionPath = try container.decodeIfPresent([GridPosition].self, forKey: .solutionPath)
        difficultyScore = try container.decodeIfPresent(Int.self, forKey: .difficultyScore)

        let rawTiles = try container.decode([[Int]].self, forKey: .tiles)
        var decodedTiles: [[TileType]] = []
        decodedTiles.reserveCapacity(rawTiles.count)
        for row in rawTiles {
            var decodedRow: [TileType] = []
            decodedRow.reserveCapacity(row.count)
            for rawValue in row {
                guard let tile = TileType(rawValue: rawValue) else {
                    throw PuzzleDecodeError.unknownTile(rawValue)
                }
                decodedRow.append(tile)
            }
            decodedTiles.append(decodedRow)
        }
        tiles = decodedTiles
    }
}

enum PuzzleDecodeError: Error, Equatable {
    case unknownTile(Int)
}

struct DailyPuzzleResponse: Decodable, Sendable {
    let puzzle: Puzzle?
    let puzzleNumber: Int?
    let date: String
    let seed: String?
    let source: String?
}

struct AttemptRecord: Codable, Equatable, Sendable {
    let moveCount: Int
    let path: [GridPosition]
    let failedAt: GridPosition
}

struct GameSnapshot: Codable, Equatable, Sendable {
    let date: String
    let position: GridPosition
    let totalMoves: Int
    let currentAttemptMoves: Int
    let lives: Int
    let penaltySeconds: Int
    let startedAt: Date?
    let completed: Bool
    let won: Bool
    let attempts: [AttemptRecord]
    let currentAttemptPath: [GridPosition]?
}

struct MoveResult: Equatable, Sendable {
    let position: GridPosition
    let valid: Bool
    let path: [GridPosition]
}

import Foundation

enum MazeEngine {
    private static let maxSlideDistance = 100

    static func simulateMove(from start: GridPosition, direction: Direction, in puzzle: Puzzle) -> MoveResult {
        let delta = direction.delta
        var x = start.x + delta.x
        var y = start.y + delta.y

        guard isValid(x: x, y: y, puzzle: puzzle) else {
            return MoveResult(position: start, valid: false, path: [])
        }

        let targetTile = puzzle.tiles[y][x]
        guard !targetTile.isBlocking else {
            return MoveResult(position: start, valid: false, path: [])
        }
        guard canEnter(tile: targetTile, direction: direction) else {
            return MoveResult(position: start, valid: false, path: [])
        }

        var path = [GridPosition(x: x, y: y)]

        if targetTile.isSliding {
            var steps = 0
            while steps < maxSlideDistance {
                steps += 1
                let nextX = x + delta.x
                let nextY = y + delta.y

                guard isValid(x: nextX, y: nextY, puzzle: puzzle) else { break }

                let nextTile = puzzle.tiles[nextY][nextX]
                if nextTile.isBlocking { break }

                if isLedge(nextTile) {
                    guard canEnter(tile: nextTile, direction: direction) else { break }
                    x = nextX
                    y = nextY
                    path.append(GridPosition(x: x, y: y))
                    break
                }

                x = nextX
                y = nextY
                path.append(GridPosition(x: x, y: y))

                if !nextTile.isSliding { break }
            }
        }

        return MoveResult(position: GridPosition(x: x, y: y), valid: true, path: path)
    }

    private static func isValid(x: Int, y: Int, puzzle: Puzzle) -> Bool {
        x >= 0 && x < puzzle.width && y >= 0 && y < puzzle.height &&
            y < puzzle.tiles.count && x < puzzle.tiles[y].count
    }

    private static func isLedge(_ tile: TileType) -> Bool {
        switch tile {
        case .ledgeUp, .ledgeDown, .ledgeLeft, .ledgeRight: return true
        default: return false
        }
    }

    /// Matches createLedgeRules() in src/game/movement/types.ts.
    private static func canEnter(tile: TileType, direction: Direction) -> Bool {
        switch tile {
        case .ledgeUp: return direction == .down
        case .ledgeDown: return direction == .up
        case .ledgeLeft: return direction == .left
        case .ledgeRight: return direction == .right
        default: return true
        }
    }
}

import XCTest
@testable import Mazle

final class MazleEngineTests: XCTestCase {
    func testIceMoveSlidesAcrossIceAndStopsBeforeWall() throws {
        let puzzle = Puzzle(
            width: 5,
            height: 3,
            tiles: [
                [.wall, .wall, .wall, .wall, .wall],
                [.wall, .start, .ice, .ice, .wall],
                [.wall, .wall, .wall, .wall, .wall],
            ],
            start: GridPosition(x: 1, y: 1),
            goal: GridPosition(x: 3, y: 1),
            optimalMoves: 1,
            solutionPath: nil
        )

        let result = MazeEngine.simulateMove(from: puzzle.start, direction: .right, in: puzzle)

        XCTAssertTrue(result.valid)
        XCTAssertEqual(result.position, GridPosition(x: 3, y: 1))
        XCTAssertEqual(result.path, [GridPosition(x: 2, y: 1), GridPosition(x: 3, y: 1)])
    }

    func testWrongLedgeEntryIsRejected() throws {
        let puzzle = Puzzle(
            width: 4,
            height: 3,
            tiles: [
                [.wall, .wall, .wall, .wall],
                [.wall, .ground, .ledgeDown, .wall],
                [.wall, .wall, .wall, .wall],
            ],
            start: GridPosition(x: 1, y: 1),
            goal: GridPosition(x: 2, y: 1),
            optimalMoves: 1,
            solutionPath: nil
        )

        let result = MazeEngine.simulateMove(from: puzzle.start, direction: .right, in: puzzle)

        XCTAssertFalse(result.valid)
        XCTAssertEqual(result.position, puzzle.start)
    }

    func testDailyPuzzleNumberUsesNewYorkLaunchDate() {
        XCTAssertEqual(DailyDate.puzzleNumber(for: "2025-12-04"), 1)
        XCTAssertEqual(DailyDate.puzzleNumber(for: "2025-12-05"), 2)
    }
}

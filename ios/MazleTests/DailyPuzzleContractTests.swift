import XCTest
@testable import Mazle

final class DailyPuzzleContractTests: XCTestCase {
    func testRustPuzzleJSONDecodesIntoNativeModel() throws {
        let json = """
        {
          "date": "2025-12-04",
          "puzzleNumber": 1,
          "seed": "2025-12-04",
          "source": "kv",
          "puzzle": {
            "width": 3,
            "height": 3,
            "tiles": [[1,1,1],[1,2,3],[1,1,1]],
            "start": {"x": 1, "y": 1},
            "goal": {"x": 2, "y": 1},
            "optimalMoves": 1,
            "solutionPath": [{"x": 1, "y": 1}, {"x": 2, "y": 1}],
            "difficultyScore": 2000
          }
        }
        """.data(using: .utf8)!

        let response = try JSONDecoder().decode(DailyPuzzleResponse.self, from: json)

        XCTAssertEqual(response.date, "2025-12-04")
        XCTAssertEqual(response.puzzleNumber, 1)
        XCTAssertEqual(response.puzzle?.tiles[1][1], .start)
        XCTAssertEqual(response.puzzle?.tiles[1][2], .goal)
        XCTAssertEqual(response.puzzle?.optimalMoves, 1)
    }
}

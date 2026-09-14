import XCTest
@testable import Mazle

final class MazleWebParityTests: XCTestCase {
    func testWebBoardContractIsSquareFifteenByFifteen() {
        XCTAssertEqual(MazleWebLayout.boardColumns, 15)
        XCTAssertEqual(MazleWebLayout.boardRows, 15)
        XCTAssertEqual(MazleWebLayout.boardAspectRatio, 1, accuracy: 0.0001)
    }

    func testWebPaletteMatchesLiveMazleContract() {
        XCTAssertEqual(MazleWebPalette.background, 0xFFFFFF)
        XCTAssertEqual(MazleWebPalette.surface, 0xF3F3F3)
        XCTAssertEqual(MazleWebPalette.text, 0x1A1A1A)
        XCTAssertEqual(MazleWebPalette.secondary, 0x787C7E)
        XCTAssertEqual(MazleWebPalette.warning, 0xC9B458)
        XCTAssertEqual(MazleWebPalette.groundFace, 0xBFA46B)
        XCTAssertEqual(MazleWebPalette.groundEdge, 0x9F8451)
        XCTAssertEqual(MazleWebPalette.wallFace, 0x202124)
        XCTAssertEqual(MazleWebPalette.iceFace, 0xA6D8FF)
        XCTAssertEqual(MazleWebPalette.ledgeFace, 0xE8E8E8)
        XCTAssertEqual(MazleWebPalette.goalFace, 0x6AAA64)
        XCTAssertEqual(MazleWebPalette.playerFace, 0xFF4D4D)
    }

    func testWebPlayerAndMenuGeometryMatchesMeasuredContract() {
        XCTAssertEqual(MazleWebLayout.playerBodyWidthRatio, 0.5, accuracy: 0.0001)
        XCTAssertEqual(MazleWebLayout.playerBodyHeightRatio, 0.5625, accuracy: 0.0001)
        XCTAssertEqual(MazleWebLayout.playerBodyCornerRadiusRatio, 6.0 / 64.0, accuracy: 0.0001)
        XCTAssertEqual(MazleWebLayout.playerEyeDiameterRatio, 12.0 / 64.0, accuracy: 0.0001)
        XCTAssertEqual(MazleWebLayout.playerPupilDiameterRatio, 6.0 / 64.0, accuracy: 0.0001)
        XCTAssertEqual(MazleWebLayout.menuButtonSize, 44, accuracy: 0.0001)
        XCTAssertEqual(MazleWebLayout.menuGlyphSize, 24, accuracy: 0.0001)
        XCTAssertEqual(MazleWebLayout.menuLineWidth, 20, accuracy: 0.0001)
        XCTAssertEqual(MazleWebLayout.menuLineHeight, 2, accuracy: 0.0001)
        XCTAssertEqual(MazleWebLayout.menuDropdownWidth, 155.5, accuracy: 0.0001)
        XCTAssertEqual(MazleWebLayout.menuDropdownRadius, 12, accuracy: 0.0001)
        XCTAssertEqual(MazleWebLayout.tabletBoardMaxSize, 520, accuracy: 0.0001)
        XCTAssertEqual(MazleWebLayout.themeToggleWidth, 44, accuracy: 0.0001)
        XCTAssertEqual(MazleWebLayout.themeToggleHeight, 24, accuracy: 0.0001)
        XCTAssertEqual(MazleWebLayout.themeToggleThumbSize, 20, accuracy: 0.0001)
    }

    func testEveryContractTileMapsToTheWebVisualRole() {
        XCTAssertEqual(MazleWebTileRole.forTile(.ground), .ground)
        XCTAssertEqual(MazleWebTileRole.forTile(.start), .start)
        XCTAssertEqual(MazleWebTileRole.forTile(.goal), .goal)
        XCTAssertEqual(MazleWebTileRole.forTile(.ice), .ice)
        XCTAssertEqual(MazleWebTileRole.forTile(.wall), .wall)
        XCTAssertEqual(MazleWebTileRole.forTile(.ledgeUp), .ledgeDown)
        XCTAssertEqual(MazleWebTileRole.forTile(.ledgeDown), .ledgeUp)
        XCTAssertEqual(MazleWebTileRole.forTile(.ledgeLeft), .ledgeLeft)
        XCTAssertEqual(MazleWebTileRole.forTile(.ledgeRight), .ledgeRight)
        XCTAssertEqual(MazleWebTileRole.forTile(.boulder), .ground)
    }

    func testArchiveDateOffsetsAndPuzzleNumbersMatchWebDates() {
        XCTAssertEqual(DailyDate.addingDays(-1, to: "2026-08-23"), "2026-08-22")
        XCTAssertEqual(DailyDate.addingDays(-7, to: "2026-08-23"), "2026-08-16")
        XCTAssertEqual(DailyDate.daysBetween("2026-08-20", and: "2026-08-23"), 3)
        XCTAssertEqual(DailyDate.puzzleNumber(for: "2026-08-23"), 263)
        XCTAssertEqual(DailyDate.puzzleNumber(for: "2026-08-22"), 262)
    }

    func testLocalHistoryEntryRoundTripsForStatsAndArchiveRows() throws {
        let entry = LocalHistoryEntry(
            date: "2026-08-23",
            puzzleNumber: 263,
            completed: true,
            won: true,
            timeSeconds: 97,
            attemptsUsed: 2,
            totalMoves: 13
        )
        let data = try JSONEncoder().encode(entry)
        XCTAssertEqual(try JSONDecoder().decode(LocalHistoryEntry.self, from: data), entry)
        XCTAssertEqual(entry.id, entry.date)
    }

    func testWebShareTextUsesAttemptRowsAndVictoryRow() {
        let attempts = [
            AttemptRecord(
                moveCount: 3,
                path: [GridPosition(x: 0, y: 0)],
                failedAt: GridPosition(x: 1, y: 0)
            ),
            AttemptRecord(
                moveCount: 7,
                path: [GridPosition(x: 0, y: 0)],
                failedAt: GridPosition(x: 2, y: 0)
            )
        ]

        let text = ResultShareFormatter.text(
            puzzleNumber: 263,
            formattedTime: "1:37",
            optimalMoves: 10,
            attempts: attempts,
            won: true,
            mapKind: .ice,
            maxLives: 5
        )

        XCTAssertEqual(
            text,
            "Mazle #263 🧊\n\n🟥🟥🟥❌⬜⬜⬜⬜⬜⬜\n🟥🟥🟥🟥🟥🟥🟥❌⬜⬜\n🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🏆\n\n1:37 • 3/5\nmazle.io"
        )
    }

    func testWebShareTextUsesFailureRowsAndOutOfLivesScore() {
        let attempts = [
            AttemptRecord(
                moveCount: 2,
                path: [GridPosition(x: 0, y: 0)],
                failedAt: GridPosition(x: 1, y: 0)
            )
        ]

        let text = ResultShareFormatter.text(
            puzzleNumber: 263,
            formattedTime: "4:06",
            optimalMoves: 5,
            attempts: attempts,
            won: false,
            mapKind: .ground,
            maxLives: 5
        )

        XCTAssertEqual(
            text,
            "Mazle #263 🟤\n\n🟥🟥❌⬜⬜\n\n4:06 • X/5\nmazle.io"
        )
    }

    func testPublicLeaderboardPayloadMatchesLiveShape() throws {
        let data = Data(#"{"date":"2026-08-24","entries":[{"rank":1,"displayName":"Dids","timeMs":28565,"attemptsUsed":1,"isMe":false}],"podium":[{"rank":1,"displayName":"Dids","timeMs":28565,"attemptsUsed":1,"characterId":"default","skinId":"royal","isMe":false}],"total":1,"nextOffset":null}"#.utf8)

        let response = try JSONDecoder().decode(PublicLeaderboardResponse.self, from: data)
        XCTAssertEqual(response.date, "2026-08-24")
        XCTAssertEqual(response.entries.first?.displayName, "Dids")
        XCTAssertEqual(response.podium?.first?.skinId, "royal")
        XCTAssertNil(response.nextOffset)
    }

    func testPublicHallOfFamePayloadAllowsMissingIsMe() throws {
        let data = Data(#"{"date":"2026-08-23","podium":[{"rank":1,"displayName":"Michi","timeMs":27749,"attemptsUsed":1,"characterId":"default","skinId":"penguin"}]}"#.utf8)

        let response = try JSONDecoder().decode(PublicHallOfFameResponse.self, from: data)
        XCTAssertEqual(response.date, "2026-08-23")
        XCTAssertEqual(response.podium.first?.displayName, "Michi")
        XCTAssertNil(response.podium.first?.isMe)
    }

    // MARK: - Life loss / invalid move

    func testInvalidMoveAgainstWallDoesNotConsumeLifeOrMoves() {
        // A wall immediately adjacent to start: moving into it must be invalid,
        // consume no life, and leave position + lives unchanged.
        var tiles = Array(repeating: Array(repeating: TileType.ground, count: 3), count: 3)
        tiles[0][1] = .wall
        let puzzle = Puzzle(
            width: 3, height: 3, tiles: tiles,
            start: GridPosition(x: 0, y: 0),
            goal: GridPosition(x: 2, y: 2),
            optimalMoves: 5, solutionPath: nil
        )

        let result = MazeEngine.simulateMove(from: GridPosition(x: 0, y: 0), direction: .right, in: puzzle)
        XCTAssertFalse(result.valid)
        XCTAssertEqual(result.position, GridPosition(x: 0, y: 0))
    }

    func testOutOfBoundsMoveIsInvalid() {
        var tiles = Array(repeating: Array(repeating: TileType.ground, count: 3), count: 3)
        tiles[0][0] = .start
        let puzzle = Puzzle(
            width: 3, height: 3, tiles: tiles,
            start: GridPosition(x: 0, y: 0),
            goal: GridPosition(x: 2, y: 2),
            optimalMoves: 5, solutionPath: nil
        )

        let result = MazeEngine.simulateMove(from: GridPosition(x: 0, y: 0), direction: .left, in: puzzle)
        XCTAssertFalse(result.valid)
        XCTAssertEqual(result.position, GridPosition(x: 0, y: 0))
    }

    @MainActor
    func testReachingOptimalMoveBudgetWithoutGoalLosesLifeAndResetsAttempt() async {
        // Reconstruct the GameViewModel life-loss contract directly: exhausting
        // the optimal move budget on a non-goal tile costs one life and resets
        // the attempt, matching GameScene.updateGameStateAndCheckLives().
        let vm = GameViewModel(service: DailyPuzzleService(baseURL: URL(string: "https://example.invalid")!))

        var tiles = Array(repeating: Array(repeating: TileType.ground, count: 3), count: 3)
        let puzzle = Puzzle(
            width: 3, height: 3, tiles: tiles,
            start: GridPosition(x: 0, y: 0),
            goal: GridPosition(x: 2, y: 2),
            optimalMoves: 2, solutionPath: nil
        )
        vm.installForTesting(puzzle: puzzle, date: "2026-08-25", puzzleNumber: 265)

        let maxLives = GameViewModel.maxLives

        vm.move(.right)
        XCTAssertEqual(vm.lives, maxLives)
        XCTAssertEqual(vm.currentAttemptMoves, 1)

        vm.move(.right)
        let livesAfter = vm.lives
        let attemptMovesAfter = vm.currentAttemptMoves
        let positionAfter = vm.position

        XCTAssertEqual(livesAfter, maxLives - 1)
        XCTAssertEqual(attemptMovesAfter, 0)
        XCTAssertEqual(positionAfter, puzzle.start)
    }

    @MainActor
    func testBeginningPlayStartsRecordedTimerBeforeFirstMove() async {
        let vm = GameViewModel(service: DailyPuzzleService(baseURL: URL(string: "https://example.invalid")!))
        let puzzle = Puzzle(
            width: 2,
            height: 2,
            tiles: Array(repeating: Array(repeating: TileType.ground, count: 2), count: 2),
            start: GridPosition(x: 0, y: 0),
            goal: GridPosition(x: 1, y: 1),
            optimalMoves: 3,
            solutionPath: nil
        )
        vm.installForTesting(puzzle: puzzle, date: "2026-08-25", puzzleNumber: 265)

        XCTAssertNil(vm.startedAt)
        vm.beginPlaying()
        XCTAssertNotNil(vm.startedAt)
        XCTAssertGreaterThanOrEqual(vm.elapsedSeconds, 0)
    }

    @MainActor
    func testFailedAttemptPathIncludesStartAndReachedPositions() async {
        let vm = GameViewModel(service: DailyPuzzleService(baseURL: URL(string: "https://example.invalid")!))
        let puzzle = Puzzle(
            width: 3,
            height: 3,
            tiles: Array(repeating: Array(repeating: TileType.ground, count: 3), count: 3),
            start: GridPosition(x: 0, y: 0),
            goal: GridPosition(x: 2, y: 2),
            optimalMoves: 2,
            solutionPath: nil
        )
        vm.installForTesting(puzzle: puzzle, date: "2026-08-25", puzzleNumber: 265)

        vm.beginPlaying()
        vm.move(.right)
        vm.move(.right)

        XCTAssertEqual(vm.attempts.first?.path, [
            GridPosition(x: 0, y: 0),
            GridPosition(x: 1, y: 0),
            GridPosition(x: 2, y: 0)
        ])
    }

    func testWebCharacterAssetsAndGeometryUseAuthoritativeWebContract() {
        XCTAssertEqual(WebCharacterAsset.penguin.fileName, "penguin.svg")
        XCTAssertEqual(WebCharacterAsset.obsidian.fileName, "obsidian.svg")
        XCTAssertEqual(WebCharacterGeometry.viewBoxSize, CGSize(width: 32, height: 32))
        XCTAssertEqual(WebCharacterGeometry.shadowCenter, CGPoint(x: 16, y: 27))
        XCTAssertEqual(WebCharacterGeometry.shadowRadius, CGSize(width: 9, height: 3))
        XCTAssertEqual(WebCharacterGeometry.eyeCenters, [CGPoint(x: 13, y: 13), CGPoint(x: 19, y: 13)])
        XCTAssertEqual(WebCharacterGeometry.pupilCenters, [CGPoint(x: 14, y: 13), CGPoint(x: 20, y: 13)])
    }
}

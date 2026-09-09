import XCTest

// Always launch in a separate, resettable local progress scope with API and
// purchase access disabled. These tests must also run without network access.
@MainActor
final class AdventureUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUp() async throws {
        await MainActor.run {
            continueAfterFailure = false
            app = XCUIApplication()
            app.launchArguments = ["-Adventure", "-MazleOfflinePreview", "-MazleResetAdventurePreview"]
            XCUIDevice.shared.orientation = .portrait
        }
    }

    override func tearDown() async throws {
        await MainActor.run {
            app?.terminate()
            app = nil
            XCUIDevice.shared.orientation = .portrait
        }
    }

    func testMapSettingsAndLevelPreview() {
        app.launch()
        XCTAssertTrue(app.buttons["adventure-settings"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["adventure-level-1"].exists)
        // SwiftUI can retain hidden views in the automation hierarchy. The
        // covered Daily action must not be interactive through Adventure.
        XCTAssertFalse(app.buttons["TRY AGAIN"].isHittable)
        capture("01-map")
        app.buttons["adventure-settings"].tap()
        XCTAssertTrue(app.switches["adventure-settings-sound"].waitForExistence(timeout: 3))
        let sound = app.switches["adventure-settings-sound"]
        let oldValue = sound.value as? String
        // SwiftUI exposes the whole labeled row as a switch. Tap the actual
        // trailing control, not the inert gap between its label and thumb.
        sound.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
        expectation(for: NSPredicate(format: "value != %@", oldValue ?? ""), evaluatedWith: sound)
        waitForExpectations(timeout: 3)
        capture("02-settings")
        app.buttons["Done"].tap()
        app.buttons["adventure-level-1"].tap()
        XCTAssertTrue(app.buttons["adventure-play-level"].waitForExistence(timeout: 3))
        capture("03-level-preview")
    }

    func testSwipeWinReplayAndNextLevel() {
        startLevelOne()
        capture("04-play")
        swipe(.up, remaining: 6)
        swipe(.up, remaining: 5)
        swipe(.left, remaining: 4)
        swipe(.left)
        XCTAssertTrue(app.otherElements["adventure-win"].waitForExistence(timeout: 5))
        capture("05-win")
        app.buttons["adventure-replay"].tap()
        waitForMoves(7)
        // Solve again to prove the board and game state both reset on replay.
        swipe(.up, remaining: 6)
        swipe(.up, remaining: 5)
        swipe(.left, remaining: 4)
        swipe(.left)
        XCTAssertTrue(app.otherElements["adventure-win"].waitForExistence(timeout: 5))
        app.buttons["adventure-next"].tap()
        XCTAssertTrue(app.staticTexts["LEVEL 2"].waitForExistence(timeout: 5))
        capture("06-next-level")
    }

    func testMoveLimitFailureAndFastRetry() {
        startLevelOne()
        let route: [SwipeDirection] = [.down, .down, .left, .right, .left, .right, .left]
        for (index, direction) in route.enumerated() {
            swipe(direction, remaining: index < 6 ? 6 - index : nil)
        }
        XCTAssertTrue(app.otherElements["adventure-failure"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["No heart was used."].exists)
        capture("07-protected-failure")
        app.buttons["adventure-retry"].tap()
        waitForMoves(7)
        swipe(.up, remaining: 6)
        capture("08-retry")
    }

    func testTabletMapAndGameplaySurviveRotation() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "Tablet layout coverage")
        app.launch()
        XCTAssertTrue(app.buttons["adventure-level-1"].waitForExistence(timeout: 10))
        capture("09-tablet-map-portrait")
        XCUIDevice.shared.orientation = .landscapeLeft
        expectation(for: NSPredicate { _, _ in self.app.frame.width > self.app.frame.height }, evaluatedWith: app)
        waitForExpectations(timeout: 5)
        capture("10-tablet-map-landscape")
        app.buttons["adventure-level-1"].tap()
        XCTAssertTrue(app.buttons["adventure-play-level"].waitForExistence(timeout: 3))
        app.buttons["adventure-play-level"].tap()
        waitForMoves(7)
        let board = app.otherElements["adventure-board"]
        XCTAssertTrue(board.isHittable)
        XCTAssertTrue(app.frame.contains(board.frame))
        capture("11-tablet-play-landscape")
        swipe(.up, remaining: 6)
        XCUIDevice.shared.orientation = .portrait
        expectation(for: NSPredicate { _, _ in self.app.frame.height > self.app.frame.width }, evaluatedWith: app)
        waitForExpectations(timeout: 5)
        waitForMoves(6)
        XCTAssertTrue(app.frame.contains(board.frame))
        capture("12-tablet-play-portrait")
        swipe(.up, remaining: 5)
        swipe(.left, remaining: 4)
        swipe(.left)
        XCTAssertTrue(app.otherElements["adventure-win"].waitForExistence(timeout: 5))
        capture("13-tablet-win")
    }

    private func startLevelOne() {
        app.launchArguments += ["-AdventureLevel", "1"]
        app.launch()
        XCTAssertTrue(app.otherElements["adventure-board"].waitForExistence(timeout: 10))
        waitForMoves(7)
    }

    private func waitForMoves(_ count: Int) {
        let moves = app.staticTexts["adventure-moves-remaining"]
        let match = NSPredicate(format: "label == %@", String(count))
        expectation(for: match, evaluatedWith: moves)
        waitForExpectations(timeout: 5)
    }

    private enum SwipeDirection { case up, down, left, right }

    private func swipe(_ direction: SwipeDirection, remaining: Int? = nil) {
        let board = app.otherElements["adventure-board"]
        switch direction {
        case .up: board.swipeUp(velocity: .slow)
        case .down: board.swipeDown(velocity: .slow)
        case .left: board.swipeLeft(velocity: .slow)
        case .right: board.swipeRight(velocity: .slow)
        }
        if let remaining { waitForMoves(remaining) }
    }

    private func capture(_ name: String) {
        // Capture the display, not an app-window crop: window screenshots can
        // apply portrait bounds to a landscape surface during simulator rotation.
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

import XCTest
@testable import Mazle

final class MazleRuntimeConfigurationTests: XCTestCase {
    @MainActor
    func testHostedDebugTestsCannotDefaultToProductionServices() {
        #if DEBUG
        XCTAssertTrue(MazleRuntimeConfiguration.isOfflineMode)
        let session = MazleAuthSession(accessToken: "local-test-token", provider: nil, expiresAt: nil)
        let urls = [
            DailyPuzzleService.live.baseURL,
            PublicMazleService.live.baseURL,
            AuthenticatedMazleService(session: session).baseURL,
            AdventureService(session: session).baseURL,
            MazleAuthManager().baseURL,
        ]
        for url in urls {
            XCTAssertEqual(url.scheme, "offline")
            XCTAssertNotEqual(url.absoluteString, "https://mazle.io")
        }
        #endif
    }

    func testTestFlightOfflineCompilationContract() {
        #if MAZLE_OFFLINE_TESTFLIGHT
        XCTAssertTrue(MazleRuntimeConfiguration.isOfflineTestFlight)
        XCTAssertTrue(MazleRuntimeConfiguration.isOfflineMode)
        XCTAssertEqual(MazleRuntimeConfiguration.apiBaseURL.scheme, "offline")
        #else
        XCTAssertFalse(MazleRuntimeConfiguration.isOfflineTestFlight)
        #endif
    }
}

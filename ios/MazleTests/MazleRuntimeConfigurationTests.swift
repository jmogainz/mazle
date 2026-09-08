import XCTest
@testable import Mazle

final class MazleRuntimeConfigurationTests: XCTestCase {
    @MainActor
    func testHostedDebugTestsCannotDefaultToProductionServices() {
        #if DEBUG
        XCTAssertTrue(MazleRuntimeConfiguration.isOfflinePreview)
        let session = MazleAuthSession(accessToken: "local-test-token", provider: nil, expiresAt: nil)
        let urls = [
            DailyPuzzleService.live.baseURL,
            PublicMazleService.live.baseURL,
            AuthenticatedMazleService(session: session).baseURL,
            AdventureService(session: session).baseURL,
            MazleAuthManager().baseURL,
        ]
        for url in urls {
            XCTAssertEqual(url.host, "127.0.0.1")
            XCTAssertEqual(url.port, 9)
        }
        #endif
    }
}

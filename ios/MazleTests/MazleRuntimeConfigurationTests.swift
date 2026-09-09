import XCTest
@testable import Mazle

final class MazleRuntimeConfigurationTests: XCTestCase {
    @MainActor
    func testHostedDebugTestsCannotDefaultToProductionServices() {
        #if OFFLINE_TESTFLIGHT
        XCTAssertTrue(MazleRuntimeConfiguration.isOfflineTestFlight)
        XCTAssertTrue(MazleRuntimeConfiguration.isOfflineBuild)
        XCTAssertEqual(MazleRuntimeConfiguration.apiBaseURL.scheme, "offline")
        #elseif DEBUG
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

    @MainActor
    func testOfflineBuildUsesNonNetworkPolicy() {
        #if OFFLINE_TESTFLIGHT
        XCTAssertFalse(MazleRuntimeConfiguration.apiBaseURL.host?.contains("mazle.io") ?? false)
        #endif
    }

    @MainActor
    func testOfflineBuildLoadsBundledGameplayAndRejectsNetworkService() async throws {
        #if OFFLINE_TESTFLIGHT
        let response = try await DailyPuzzleService.live.fetch(date: "2026-09-08")
        XCTAssertEqual(response.source, "offline-testflight")
        XCTAssertEqual(response.puzzleNumber, 1)
        XCTAssertNotNil(response.puzzle)

        do {
            _ = try await PublicMazleService.live.me()
            XCTFail("Offline TestFlight must reject public API requests before URLSession.")
        } catch {
            XCTAssertEqual(error.localizedDescription, MazleRuntimeError.offlineOnlyBuild.localizedDescription)
        }

        let session = MazleAuthSession(accessToken: "offline-test-token", provider: nil, expiresAt: nil)
        do {
            _ = try await AuthenticatedMazleService(session: session).me()
            XCTFail("Offline TestFlight must reject authenticated API requests before URLSession.")
        } catch {
            XCTAssertEqual(error.localizedDescription, MazleRuntimeError.offlineOnlyBuild.localizedDescription)
        }
        #endif
    }
}

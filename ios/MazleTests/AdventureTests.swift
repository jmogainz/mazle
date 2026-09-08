import XCTest
@testable import Mazle

final class AdventureTests: XCTestCase {
    func testCatalogContainsFiftyValidatedLevelsAcrossFiveChapters() throws {
        let catalog = try AdventureCatalogLoader.load(bundle: Bundle(for: AdventureProgressStore.self))

        XCTAssertEqual(catalog.schemaVersion, 1)
        XCTAssertEqual(catalog.contentVersion, "1.0.0")
        XCTAssertEqual(catalog.chapters.count, 5)
        XCTAssertEqual(catalog.levels.count, 50)
        XCTAssertEqual(catalog.levels.map(\.id), Array(1...50))
        XCTAssertNoThrow(try AdventureCatalogValidator.validate(catalog))
    }

    func testEveryCanonicalSolutionReachesItsGoalInExactlyOptimalMoves() throws {
        let catalog = try AdventureCatalogLoader.load(bundle: Bundle(for: AdventureProgressStore.self))

        for level in catalog.levels {
            XCTAssertEqual(level.solutionStops.first, level.start)
            XCTAssertEqual(level.solutionStops.count, level.optimalMoves + 1)
            var position = level.start
            for direction in level.solution {
                let result = MazeEngine.simulateMove(from: position, direction: direction, in: level.puzzle)
                XCTAssertTrue(result.valid, "Level \(level.id) contains an invalid canonical move")
                position = result.position
            }
            XCTAssertEqual(position, level.goal, "Level \(level.id) does not reach its goal")
            XCTAssertEqual(level.solution.count, level.optimalMoves)
        }
    }

    func testEnergyConsumesAndRegeneratesAtThirtyMinuteIntervals() {
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        var energy = AdventureEnergy.full

        XCTAssertTrue(energy.consume(at: start))
        XCTAssertEqual(energy.hearts, 2)
        XCTAssertEqual(energy.nextHeartAt, start.addingTimeInterval(30 * 60))

        energy.refresh(at: start.addingTimeInterval(29 * 60 + 59))
        XCTAssertEqual(energy.hearts, 2)

        energy.refresh(at: start.addingTimeInterval(30 * 60))
        XCTAssertEqual(energy.hearts, 3)
        XCTAssertNil(energy.nextHeartAt)
    }

    func testEnergyCatchesUpMultipleHeartsAndCapsAtThree() {
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        var energy = AdventureEnergy(hearts: 0, nextHeartAt: start, refillTickets: 0)

        energy.refresh(at: start.addingTimeInterval(90 * 60))

        XCTAssertEqual(energy.hearts, 3)
        XCTAssertNil(energy.nextHeartAt)
    }

    func testServerMaximumHeartCapacityIsPreserved() {
        var energy = AdventureEnergy(hearts: 5, maximumHearts: 5, nextHeartAt: nil, refillTickets: 1)

        XCTAssertEqual(energy.maximumHearts, 5)
        XCTAssertTrue(energy.consume(at: Date()))
        XCTAssertEqual(energy.hearts, 4)
        XCTAssertTrue(energy.useRefillTicket())
        XCTAssertEqual(energy.hearts, 5)
    }

    func testRefillTicketRestoresAllHeartsAndNeverGoesNegative() {
        var energy = AdventureEnergy(hearts: 1, nextHeartAt: Date(), refillTickets: 1)

        XCTAssertTrue(energy.useRefillTicket())
        XCTAssertEqual(energy.hearts, 3)
        XCTAssertEqual(energy.refillTickets, 0)
        XCTAssertNil(energy.nextHeartAt)
        XCTAssertFalse(energy.useRefillTicket())
    }

    func testProgressMergeFavorsPlayerBestResults() {
        let earlier = Date(timeIntervalSince1970: 100)
        let later = Date(timeIntervalSince1970: 200)
        var progress = AdventureProgress.fresh(catalogVersion: "1.0.0")
        progress.record(
            AdventureLevelResult(levelId: 1, stars: 2, bestMoves: 6, bestTimeMs: 8_000, completedAt: earlier),
            maximumLevel: 50
        )
        progress.record(
            AdventureLevelResult(levelId: 1, stars: 3, bestMoves: 4, bestTimeMs: 9_000, completedAt: later),
            maximumLevel: 50
        )

        XCTAssertEqual(progress.highestUnlockedLevel, 2)
        XCTAssertEqual(progress.levelResults[1]?.stars, 3)
        XCTAssertEqual(progress.levelResults[1]?.bestMoves, 4)
        XCTAssertEqual(progress.levelResults[1]?.bestTimeMs, 8_000)
        XCTAssertEqual(progress.levelResults[1]?.completedAt, earlier)
    }

    func testStoreKitRefillProductMapping() {
        XCTAssertEqual(StoreKitManager.ProductID.refillCount(for: "com.mazle.adventure.refill.1"), 1)
        XCTAssertEqual(StoreKitManager.ProductID.refillCount(for: "com.mazle.adventure.refill.5"), 5)
        XCTAssertEqual(StoreKitManager.ProductID.refillCount(for: "com.mazle.adventure.refill.12"), 12)
        XCTAssertNil(StoreKitManager.ProductID.refillCount(for: "com.mazle.archive.lifetime"))
    }

    func testStoreKitRefillUsesAuthenticatedUserUUIDAsAccountToken() {
        let userId = UUID()
        let session = MazleAuthSession(
            accessToken: "token",
            provider: "apple",
            expiresAt: Date().addingTimeInterval(600),
            userId: userId.uuidString
        )
        XCTAssertEqual(StoreKitManager.refillAccountToken(for: session), userId)

        let legacySession = MazleAuthSession(
            accessToken: "token",
            provider: nil,
            expiresAt: nil
        )
        XCTAssertNil(StoreKitManager.refillAccountToken(for: legacySession))
    }

    @MainActor
    func testAppleRefillStaysUnavailableAndQueuedDurablyUntilServerVerification() throws {
        let suiteName = "AdventureTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let catalog = try AdventureCatalogLoader.load(bundle: Bundle(for: AdventureProgressStore.self))
        let store = AdventureProgressStore(
            catalog: catalog,
            defaults: defaults,
            observeSession: false
        )

        XCTAssertTrue(
            store.recordPurchasedRefillLocally(
                count: 5,
                transactionId: 42,
                signedTransaction: "signed-jws"
            )
        )
        XCTAssertEqual(store.energy.refillTickets, 0)
        XCTAssertEqual(store.pendingAppleGrantCount, 1)
        XCTAssertFalse(
            store.recordPurchasedRefillLocally(
                count: 5,
                transactionId: 42,
                signedTransaction: "signed-jws"
            )
        )
        XCTAssertEqual(store.energy.refillTickets, 0)

        let restored = AdventureProgressStore(
            catalog: catalog,
            defaults: defaults,
            observeSession: false
        )
        XCTAssertEqual(restored.energy.refillTickets, 0)
        XCTAssertEqual(restored.pendingAppleGrantCount, 1)
    }

    func testServerErrorContractAndOfflineStartPolicy() throws {
        let body = try JSONDecoder().decode(
            AdventureServerErrorBody.self,
            from: Data(#"{"errorCode":"OUT_OF_ENERGY","message":"Wait for another heart."}"#.utf8)
        )
        XCTAssertEqual(body.errorCode, "OUT_OF_ENERGY")
        XCTAssertEqual(body.message, "Wait for another heart.")

        XCTAssertFalse(
            AdventureProgressStore.permitsOfflineStart(
                after: AdventureServiceError.httpStatus(
                    status: 409,
                    code: "OUT_OF_ENERGY",
                    message: "Wait for another heart."
                )
            )
        )
        XCTAssertFalse(
            AdventureProgressStore.permitsOfflineStart(
                after: AdventureServiceError.httpStatus(
                    status: 429,
                    code: "RATE_LIMITED",
                    message: nil
                )
            )
        )
        XCTAssertTrue(
            AdventureProgressStore.permitsOfflineStart(
                after: AdventureServiceError.httpStatus(
                    status: 503,
                    code: "UNAVAILABLE",
                    message: nil
                )
            )
        )
        XCTAssertTrue(
            AdventureProgressStore.permitsOfflineStart(
                after: URLError(.notConnectedToInternet)
            )
        )
        XCTAssertFalse(AdventureProgressStore.permitsOfflineStart(after: AdventureServiceError.decoding))

        XCTAssertTrue(
            AdventureServiceError.httpStatus(
                status: 400,
                code: "APPLE_TRANSACTION_INVALID",
                message: nil
            ).isTerminalAppleClaimFailure
        )
        XCTAssertTrue(
            AdventureServiceError.httpStatus(
                status: 409,
                code: "APPLE_ACCOUNT_MISMATCH",
                message: nil
            ).isTerminalAppleClaimFailure
        )
        XCTAssertFalse(
            AdventureServiceError.httpStatus(
                status: 401,
                code: "AUTH_REQUIRED",
                message: nil
            ).isTerminalAppleClaimFailure
        )
        XCTAssertFalse(
            AdventureServiceError.httpStatus(
                status: 429,
                code: "RATE_LIMITED",
                message: nil
            ).isTerminalAppleClaimFailure
        )
        XCTAssertFalse(
            AdventureServiceError.httpStatus(
                status: 503,
                code: "UNAVAILABLE",
                message: nil
            ).isTerminalAppleClaimFailure
        )

        XCTAssertTrue(AdventureAppleRefillDisposition.granted.shouldFinishStoreTransaction)
        XCTAssertTrue(AdventureAppleRefillDisposition.rejected("invalid").shouldFinishStoreTransaction)
        XCTAssertFalse(AdventureAppleRefillDisposition.pending.shouldFinishStoreTransaction)
    }

    @MainActor
    func testAccountSwitchKeepsProgressEnergyAndPurchaseQueuesIsolated() async throws {
        let suiteName = "AdventureTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let catalog = try AdventureCatalogLoader.load(bundle: Bundle(for: AdventureProgressStore.self))

        let userAScope = AdventureStorageScope.user("account-a")
        let userAState = AdventureLocalState(
            progress: .fresh(catalogVersion: catalog.contentVersion),
            energy: AdventureEnergy(
                hearts: 1,
                maximumHearts: 5,
                nextHeartAt: Date.distantFuture,
                refillTickets: 4
            ),
            activeAttempt: nil,
            processedStoreTransactionIDs: [777],
            pendingCompletions: [],
            pendingAppleGrants: [
                AdventurePendingAppleGrant(id: 200, signedTransaction: "account-a-jws"),
            ]
        )
        defaults.set(try JSONEncoder().encode(userAState), forKey: userAScope.storageKey)

        let store = AdventureProgressStore(
            catalog: catalog,
            defaults: defaults,
            observeSession: false,
            initialStorageScope: .guest
        )
        let firstLevel = try XCTUnwrap(catalog.level(id: 1))
        _ = try await store.begin(firstLevel)
        _ = await store.complete(
            level: firstLevel,
            moves: firstLevel.optimalMoves,
            timeMs: 2_000
        )
        XCTAssertTrue(
            store.recordPurchasedRefillLocally(
                count: 1,
                transactionId: 100,
                signedTransaction: "guest-jws"
            )
        )

        XCTAssertTrue(store.transitionStorageScope(to: userAScope))
        XCTAssertEqual(store.completedLevels, 1, "Guest progress should merge into the first signed-in account")
        XCTAssertEqual(store.energy.maximumHearts, 5)
        XCTAssertEqual(store.energy.refillTickets, 4, "Guest energy and tickets must not merge")
        XCTAssertEqual(store.pendingAppleGrantCount, 1, "Only Account A's pending grant should load")
        XCTAssertFalse(
            store.recordPurchasedRefillLocally(
                count: 1,
                transactionId: 777,
                signedTransaction: "already-processed"
            ),
            "Account A's processed transaction IDs should remain deduplicated"
        )

        XCTAssertTrue(store.transitionStorageScope(to: .guest))
        XCTAssertEqual(store.completedLevels, 1)
        XCTAssertEqual(store.pendingAppleGrantCount, 1, "The guest queue should be restored independently")

        let userBScope = AdventureStorageScope.user("account-b")
        XCTAssertTrue(store.transitionStorageScope(to: userBScope))
        XCTAssertEqual(store.completedLevels, 0, "Claimed guest progress must not be imported into Account B")
        XCTAssertEqual(store.energy.refillTickets, 0)
        XCTAssertEqual(store.pendingAppleGrantCount, 0)
        XCTAssertTrue(
            store.recordPurchasedRefillLocally(
                count: 1,
                transactionId: 777,
                signedTransaction: "account-b-jws"
            ),
            "Account A's processed transaction IDs must not leak into Account B"
        )

        XCTAssertTrue(store.transitionStorageScope(to: userAScope))
        XCTAssertEqual(store.completedLevels, 1)
        XCTAssertEqual(store.energy.maximumHearts, 5)
        XCTAssertEqual(store.energy.refillTickets, 4)
        XCTAssertEqual(store.pendingAppleGrantCount, 1)
    }
}

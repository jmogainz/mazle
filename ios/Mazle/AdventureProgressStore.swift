import Combine
import Foundation

enum AdventureProgressError: LocalizedError, Equatable {
    case catalogUnavailable
    case lockedLevel
    case noEnergy
    case noRefillAvailable
    case accountChanged

    var errorDescription: String? {
        switch self {
        case .catalogUnavailable: return "Adventure is not available in this build."
        case .lockedLevel: return "Complete the previous level to unlock this one."
        case .noEnergy: return "You are out of hearts. A new heart is already on the way."
        case .noRefillAvailable: return "There is no refill available to use right now."
        case .accountChanged: return "Your Mazle account changed. Please try again."
        }
    }
}

enum AdventureStorageScope: Equatable, Sendable {
    case guest
    case user(String)

    static let storageKeyPrefix = "mazle.adventure.state.v1"

    init(session: MazleAuthSession?) {
        guard let session else {
            self = .guest
            return
        }
        let userId = session.userId?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let userId, !userId.isEmpty {
            self = .user(userId)
        } else {
            // Older Keychain sessions predate the userId callback. A stable token
            // fingerprint keeps those accounts isolated without storing the token.
            self = .user("legacy-\(Self.fingerprint(session.accessToken))")
        }
    }

    var identifier: String {
        switch self {
        case .guest: return "guest"
        case .user(let userId): return "user:\(userId)"
        }
    }

    var storageKey: String { "\(Self.storageKeyPrefix).\(identifier)" }

    private static func fingerprint(_ value: String) -> String {
        var hash: UInt64 = 14_695_981_039_346_656_037
        for byte in value.utf8 {
            hash ^= UInt64(byte)
            hash &*= 1_099_511_628_211
        }
        return String(hash, radix: 16)
    }
}

enum AdventureAppleRefillDisposition: Equatable, Sendable {
    case granted
    case pending
    case rejected(String)

    var shouldFinishStoreTransaction: Bool {
        switch self {
        case .granted, .rejected: return true
        case .pending: return false
        }
    }
}

@MainActor
final class AdventureProgressStore: ObservableObject {
    static let shared = AdventureProgressStore(defaults: MazleRuntimeConfiguration.adventureDefaults)

    @Published private(set) var catalog: AdventureCatalog?
    @Published private(set) var progress: AdventureProgress
    @Published private(set) var energy: AdventureEnergy
    @Published private(set) var activeAttempt: AdventureAttemptSnapshot?
    @Published private(set) var isSyncing = false
    @Published private(set) var dailyRefillAvailable = false
    @Published var statusMessage: String?
    @Published var errorMessage: String?

    private let defaults: UserDefaults
    private let sessionStore: MazleSessionStore
    private let now: () -> Date
    private let legacyStorageKey = AdventureStorageScope.storageKeyPrefix
    private let guestClaimedByKey = "mazle.adventure.guest-claimed-by.v1"
    private(set) var currentStorageScope: AdventureStorageScope
    private var processedStoreTransactionIDs = Set<UInt64>()
    private var rejectedStoreTransactionIDs = Set<UInt64>()
    private var pendingCompletions: [AdventurePendingCompletion] = []
    private var pendingAppleGrants: [AdventurePendingAppleGrant] = []
    private var sessionCancellable: AnyCancellable?
    private var syncingScope: AdventureStorageScope?

    init(
        catalog suppliedCatalog: AdventureCatalog? = nil,
        defaults: UserDefaults = .standard,
        sessionStore: MazleSessionStore = .shared,
        now: @escaping () -> Date = Date.init,
        observeSession: Bool = true,
        initialStorageScope: AdventureStorageScope? = nil
    ) {
        self.defaults = defaults
        self.sessionStore = sessionStore
        self.now = now
        currentStorageScope = initialStorageScope ?? AdventureStorageScope(session: sessionStore.session)

        let loadedCatalog: AdventureCatalog?
        if let suppliedCatalog {
            loadedCatalog = suppliedCatalog
        } else {
            do {
                loadedCatalog = try AdventureCatalogLoader.load()
            } catch {
                loadedCatalog = nil
            }
        }
        catalog = loadedCatalog
        progress = .fresh(catalogVersion: loadedCatalog?.contentVersion ?? "adventure-v1")
        energy = .full
        activeAttempt = nil

        restoreLocalState(for: currentStorageScope)
        refreshEnergy()

        if loadedCatalog == nil {
            errorMessage = AdventureCatalogError.missingResource.localizedDescription
        }

        if observeSession {
            sessionCancellable = sessionStore.$session
                .dropFirst()
                .sink { [weak self] session in
                    Task { @MainActor [weak self] in
                        await self?.handleSessionChange(session)
                    }
                }
        }
    }

    var totalStars: Int { progress.totalStars }
    var completedLevels: Int { progress.completedLevels }
    var pendingAppleGrantCount: Int { pendingAppleGrants.count }
    var currentStorageScopeIdentifier: String { currentStorageScope.identifier }

    func result(for levelId: Int) -> AdventureLevelResult? {
        progress.levelResults[levelId]
    }

    func isUnlocked(_ level: AdventureLevel) -> Bool {
        level.id <= progress.highestUnlockedLevel
    }

    func canStart(_ level: AdventureLevel) -> Bool {
        refreshEnergy()
        return isUnlocked(level) && (level.isProtectedFromEnergyLoss || energy.hearts > 0)
    }

    func refreshEnergy(at date: Date? = nil) {
        var refreshed = energy
        refreshed.refresh(at: date ?? now())
        if refreshed != energy {
            energy = refreshed
            persist()
        }
    }

    func countdownString(at date: Date = Date()) -> String? {
        guard energy.hearts < energy.maximumHearts,
              let nextHeartAt = energy.nextHeartAt else { return nil }
        let remaining = max(0, Int(ceil(nextHeartAt.timeIntervalSince(date))))
        return String(format: "%02d:%02d", remaining / 60, remaining % 60)
    }

    func begin(_ level: AdventureLevel) async throws -> AdventureAttemptSnapshot {
        guard let catalog else { throw AdventureProgressError.catalogUnavailable }
        guard isUnlocked(level) else { throw AdventureProgressError.lockedLevel }
        refreshEnergy()
        guard level.isProtectedFromEnergyLoss || energy.hearts > 0 else {
            throw AdventureProgressError.noEnergy
        }

        if let activeAttempt,
           activeAttempt.levelId == level.id,
           activeAttempt.catalogVersion == catalog.contentVersion {
            return activeAttempt
        }
        if activeAttempt != nil {
            await abandonActiveAttempt()
        }

        let idempotencyKey = UUID()
        var attemptId = idempotencyKey
        var startedAt = now()
        var serverAuthorized = false
        let requestScope = currentStorageScope

        if let session = validSession {
            do {
                let response = try await AdventureService(session: session).start(
                    levelId: level.id,
                    catalogVersion: catalog.contentVersion,
                    idempotencyKey: idempotencyKey
                )
                guard currentStorageScope == requestScope else {
                    throw AdventureProgressError.accountChanged
                }
                attemptId = response.attempt.attemptId
                startedAt = response.attempt.startedAt
                serverAuthorized = true
                apply(response.energy)
            } catch {
                guard currentStorageScope == requestScope else {
                    throw AdventureProgressError.accountChanged
                }
                guard Self.permitsOfflineStart(after: error) else {
                    errorMessage = error.localizedDescription
                    throw error
                }
                statusMessage = "Playing offline — progress will sync when you reconnect."
            }
        }

        let snapshot = AdventureAttemptSnapshot(
            attemptId: attemptId,
            catalogVersion: catalog.contentVersion,
            levelId: level.id,
            position: level.start,
            moves: 0,
            startedAt: startedAt,
            serverAuthorized: serverAuthorized
        )
        activeAttempt = snapshot
        persist()
        return snapshot
    }

    nonisolated static func permitsOfflineStart(after error: Error) -> Bool {
        if error is URLError { return true }
        return (error as? AdventureServiceError)?.permitsOfflineStart == true
    }

    func updateActiveAttempt(position: GridPosition, moves: Int) {
        guard let activeAttempt else { return }
        self.activeAttempt = AdventureAttemptSnapshot(
            attemptId: activeAttempt.attemptId,
            catalogVersion: activeAttempt.catalogVersion,
            levelId: activeAttempt.levelId,
            position: position,
            moves: moves,
            startedAt: activeAttempt.startedAt,
            serverAuthorized: activeAttempt.serverAuthorized
        )
        persist()
    }

    func complete(level: AdventureLevel, moves: Int, timeMs: Int) async -> AdventureLevelResult {
        let snapshot = activeAttempt
        let result = AdventureLevelResult(
            levelId: level.id,
            stars: level.thresholds.stars(for: moves),
            bestMoves: moves,
            bestTimeMs: timeMs,
            completedAt: now()
        )
        progress.record(result, maximumLevel: catalog?.levels.count ?? 50)
        activeAttempt = nil

        let pending = AdventurePendingCompletion(
            id: UUID(),
            levelId: level.id,
            attemptId: snapshot?.attemptId ?? UUID(),
            moves: moves,
            timeMs: timeMs,
            won: true,
            stars: result.stars,
            catalogVersion: progress.catalogVersion,
            completedAt: result.completedAt
        )
        pendingCompletions.append(pending)
        persist()

        if let session = validSession, snapshot?.serverAuthorized == true, let snapshot {
            let requestScope = currentStorageScope
            do {
                let response = try await AdventureService(session: session).complete(
                    attemptId: snapshot.attemptId,
                    moves: moves,
                    timeMs: timeMs,
                    catalogVersion: snapshot.catalogVersion,
                    idempotencyKey: pending.id
                )
                guard currentStorageScope == requestScope else {
                    return result
                }
                apply(response.progress)
                apply(response.energy)
                pendingCompletions.removeAll { $0.id == pending.id }
                persist()
                statusMessage = "Adventure progress synced."
                // The overlay is for this attempt. The progress response carries
                // the account's best result and would make a replay celebrate an
                // older, faster run instead of the solve just completed.
                return result
            } catch {
                if currentStorageScope == requestScope {
                    statusMessage = "Level saved locally; account sync will retry."
                }
            }
        }
        return result
    }

    @discardableResult
    func failActiveAttempt(level: AdventureLevel, moves: Int, timeMs: Int, outcome: AdventureAttemptOutcome) async -> Bool {
        // A settled attempt must be idempotent. In particular, an interrupted
        // movement and a view dismissal can both race to abandon the same run.
        guard let snapshot = activeAttempt, snapshot.levelId == level.id else {
            return false
        }
        var consumed = false
        if !level.isProtectedFromEnergyLoss, moves > 0 {
            consumed = energy.consume(at: now())
        }
        activeAttempt = nil
        persist()

        if let session = validSession, snapshot.serverAuthorized {
            let requestScope = currentStorageScope
            do {
                let response = try await AdventureService(session: session).fail(
                    attemptId: snapshot.attemptId,
                    moves: moves,
                    timeMs: timeMs,
                    outcome: outcome,
                    idempotencyKey: UUID()
                )
                guard currentStorageScope == requestScope else { return consumed }
                apply(response.energy)
            } catch {
                if currentStorageScope == requestScope {
                    statusMessage = "Energy is saved locally and will reconcile when connected."
                }
            }
        }
        return consumed
    }

    func abandonActiveAttempt() async {
        guard let activeAttempt,
              let level = catalog?.level(id: activeAttempt.levelId) else {
            self.activeAttempt = nil
            persist()
            return
        }
        let elapsed = max(0, Int(now().timeIntervalSince(activeAttempt.startedAt) * 1000))
        _ = await failActiveAttempt(
            level: level,
            moves: activeAttempt.moves,
            timeMs: elapsed,
            outcome: .abandoned
        )
    }

    func useRefillTicket() async throws {
        refreshEnergy()
        guard energy.refillTickets > 0,
              energy.hearts < energy.maximumHearts,
              let session = validSession else {
            throw AdventureProgressError.noRefillAvailable
        }

        let requestScope = currentStorageScope
        let response = try await AdventureService(session: session).useRefill(
            source: .ticket,
            idempotencyKey: UUID()
        )
        guard currentStorageScope == requestScope else {
            throw AdventureProgressError.accountChanged
        }
        apply(response.energy)
        AdventureFeedback.shared.play(.win)
    }

    func useDailyRefill() async throws {
        guard dailyRefillAvailable, let session = validSession else {
            throw AdventureProgressError.noRefillAvailable
        }
        let requestScope = currentStorageScope
        let response = try await AdventureService(session: session).useRefill(
            source: .daily,
            idempotencyKey: UUID()
        )
        guard currentStorageScope == requestScope else {
            throw AdventureProgressError.accountChanged
        }
        apply(response.energy)
        dailyRefillAvailable = false
        AdventureFeedback.shared.play(.win)
    }

    @discardableResult
    func applyPurchasedRefill(
        count: Int,
        transactionId: UInt64,
        signedTransaction: String
    ) async -> AdventureAppleRefillDisposition {
        guard validSession != nil else {
            statusMessage = "Sign in to verify this refill purchase. No charge will be lost."
            return .pending
        }
        if processedStoreTransactionIDs.contains(transactionId) {
            return .granted
        }
        if rejectedStoreTransactionIDs.contains(transactionId) {
            return .rejected("Mazle previously rejected this App Store transaction.")
        }
        let alreadyRecorded = pendingAppleGrants.contains { $0.id == transactionId }
        if !alreadyRecorded {
            guard recordPurchasedRefillLocally(
                count: count,
                transactionId: transactionId,
                signedTransaction: signedTransaction
            ) else { return .pending }
        }
        statusMessage = "Purchase saved securely. Tickets appear after Mazle verifies it."
        guard let grant = pendingAppleGrants.first(where: { $0.id == transactionId }),
              let session = validSession else { return .pending }
        return await verifyPendingAppleGrant(
            grant,
            session: session,
            requestScope: currentStorageScope
        )
    }

    @discardableResult
    func recordPurchasedRefillLocally(
        count: Int,
        transactionId: UInt64,
        signedTransaction: String
    ) -> Bool {
        guard count > 0,
              !signedTransaction.isEmpty,
              !processedStoreTransactionIDs.contains(transactionId),
              !rejectedStoreTransactionIDs.contains(transactionId),
              !pendingAppleGrants.contains(where: { $0.id == transactionId }) else {
            return false
        }
        pendingAppleGrants.append(
            AdventurePendingAppleGrant(id: transactionId, signedTransaction: signedTransaction)
        )
        guard persist() else {
            pendingAppleGrants.removeAll { $0.id == transactionId }
            return false
        }
        return true
    }

    func syncAccount() async {
        let requestScope = currentStorageScope
        guard syncingScope != requestScope, let session = validSession else { return }
        syncingScope = requestScope
        isSyncing = true
        defer {
            if syncingScope == requestScope {
                syncingScope = nil
                isSyncing = false
            }
        }

        do {
            let response = try await AdventureService(session: session).sync(
                progress: progress,
                idempotencyKey: UUID()
            )
            guard currentStorageScope == requestScope else { return }
            apply(response.progress)
            apply(response.energy)
            dailyRefillAvailable = response.energy.dailyRefillAvailable
            pendingCompletions.removeAll()
            persist()
            await flushPendingAppleGrants()
            statusMessage = "Adventure progress is synced to your account."
        } catch {
            if currentStorageScope == requestScope {
                statusMessage = "Adventure is available offline. Account sync will retry."
            }
        }
    }

    private var validSession: MazleAuthSession? {
        guard !MazleRuntimeConfiguration.isOfflineBuild,
              let session = sessionStore.session,
              !session.isExpired,
              AdventureStorageScope(session: session) == currentStorageScope else { return nil }
        return session
    }

    private func apply(_ remoteProgress: AdventureRemoteProgress) {
        let local = remoteProgress.local(maximumLevel: catalog?.levels.count ?? 50)
        progress = local
    }

    private func apply(_ remoteEnergy: AdventureRemoteEnergy) {
        energy = remoteEnergy.local
        dailyRefillAvailable = remoteEnergy.dailyRefillAvailable
        persist()
    }

    private func flushPendingAppleGrants() async {
        guard let session = validSession else { return }
        let requestScope = currentStorageScope
        for grant in pendingAppleGrants {
            let disposition = await verifyPendingAppleGrant(
                grant,
                session: session,
                requestScope: requestScope
            )
            if disposition == .pending {
                return
            }
        }
    }

    private func verifyPendingAppleGrant(
        _ grant: AdventurePendingAppleGrant,
        session: MazleAuthSession,
        requestScope: AdventureStorageScope
    ) async -> AdventureAppleRefillDisposition {
        do {
            let response = try await AdventureService(session: session)
                .grantAppleRefill(signedTransaction: grant.signedTransaction)
            guard currentStorageScope == requestScope else { return .pending }
            apply(response.energy)
            pendingAppleGrants.removeAll { $0.id == grant.id }
            processedStoreTransactionIDs.insert(grant.id)
            persist()
            statusMessage = "Refill tickets added to your account."
            return .granted
        } catch {
            guard currentStorageScope == requestScope else { return .pending }
            if (error as? AdventureServiceError)?.isTerminalAppleClaimFailure == true {
                pendingAppleGrants.removeAll { $0.id == grant.id }
                rejectedStoreTransactionIDs.insert(grant.id)
                persist()
                let message = error.localizedDescription
                statusMessage = "Mazle could not accept this refill: \(message)"
                return .rejected(message)
            }
            statusMessage = "Purchase saved securely. Tickets appear after Mazle verifies it."
            return .pending
        }
    }

    private func handleSessionChange(_ session: MazleAuthSession?) async {
        transitionStorageScope(to: AdventureStorageScope(session: session))
        guard session?.isExpired == false else { return }
        await syncAccount()
    }

    @discardableResult
    func transitionStorageScope(to newScope: AdventureStorageScope) -> Bool {
        guard newScope != currentStorageScope else { return false }

        persist()
        let previousScope = currentStorageScope
        let guestProgress = previousScope == .guest ? progress : nil
        if syncingScope != newScope {
            syncingScope = nil
            isSyncing = false
        }
        currentStorageScope = newScope
        restoreLocalState(for: newScope)

        if let guestProgress,
           case .user = newScope,
           shouldMergeGuestProgress(into: newScope) {
            progress.merge(guestProgress, maximumLevel: catalog?.levels.count ?? 50)
            defaults.set(newScope.identifier, forKey: guestClaimedByKey)
            persist()
        }
        refreshEnergy()
        return true
    }

    private func shouldMergeGuestProgress(into userScope: AdventureStorageScope) -> Bool {
        guard case .user = userScope else { return false }
        guard let claimedBy = defaults.string(forKey: guestClaimedByKey) else { return true }
        return claimedBy == userScope.identifier
    }

    private func resetLocalState() {
        progress = .fresh(catalogVersion: catalog?.contentVersion ?? "adventure-v1")
        energy = .full
        activeAttempt = nil
        processedStoreTransactionIDs.removeAll()
        rejectedStoreTransactionIDs.removeAll()
        pendingCompletions.removeAll()
        pendingAppleGrants.removeAll()
        dailyRefillAvailable = false
    }

    private func restoreLocalState(for scope: AdventureStorageScope) {
        resetLocalState()
        var data = defaults.data(forKey: scope.storageKey)
        var migratedLegacyGuest = false
        if data == nil, scope == .guest {
            data = defaults.data(forKey: legacyStorageKey)
            migratedLegacyGuest = data != nil
        }
        guard let data,
              var saved = try? JSONDecoder().decode(AdventureLocalState.self, from: data) else {
            return
        }

        if let catalog, saved.progress.catalogVersion != catalog.contentVersion {
            saved.progress.catalogVersion = catalog.contentVersion
            saved.activeAttempt = nil
        }
        progress = saved.progress
        energy = saved.energy
        activeAttempt = saved.activeAttempt
        processedStoreTransactionIDs = saved.processedStoreTransactionIDs
        rejectedStoreTransactionIDs = saved.rejectedStoreTransactionIDs
        pendingCompletions = saved.pendingCompletions
        pendingAppleGrants = saved.pendingAppleGrants
        if migratedLegacyGuest {
            persist()
        }
    }

    @discardableResult
    private func persist() -> Bool {
        let state = AdventureLocalState(
            progress: progress,
            energy: energy,
            activeAttempt: activeAttempt,
            processedStoreTransactionIDs: processedStoreTransactionIDs,
            rejectedStoreTransactionIDs: rejectedStoreTransactionIDs,
            pendingCompletions: pendingCompletions,
            pendingAppleGrants: pendingAppleGrants
        )
        guard let data = try? JSONEncoder().encode(state) else { return false }
        defaults.set(data, forKey: currentStorageScope.storageKey)
        return true
    }
}

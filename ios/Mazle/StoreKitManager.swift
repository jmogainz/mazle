import Combine
import StoreKit

@MainActor
final class StoreKitManager: ObservableObject {
    enum ProductID {
        static let archiveLifetime = "com.mazle.archive.lifetime"
        static let archiveMonthly = "com.mazle.archive.monthly"
        static let adventureRefill1 = "com.mazle.adventure.refill.1"
        static let adventureRefill5 = "com.mazle.adventure.refill.5"
        static let adventureRefill12 = "com.mazle.adventure.refill.12"
        static let adventureRefills = [adventureRefill1, adventureRefill5, adventureRefill12]
        static let all = [archiveLifetime, archiveMonthly] + adventureRefills

        static func refillCount(for productID: String) -> Int? {
            switch productID {
            case adventureRefill1: return 1
            case adventureRefill5: return 5
            case adventureRefill12: return 12
            default: return nil
            }
        }
    }

    @Published private(set) var products: [Product] = []
    @Published private(set) var purchasedProductIDs = Set<String>()
    @Published private(set) var isLoading = false
    @Published private(set) var isRestoring = false
    @Published private(set) var purchasingProductIDs = Set<String>()
    @Published private(set) var lastEntitlementRefresh: Date?
    @Published private(set) var serverEntitlement: AppleEntitlementSyncResponse?
    @Published var errorMessage: String?

    private var updatesTask: Task<Void, Never>?

    init() {
        updatesTask = observeTransactions()
    }

    deinit {
        updatesTask?.cancel()
    }

    nonisolated static func refillAccountToken(for session: MazleAuthSession?) -> UUID? {
        guard let session,
              !session.isExpired,
              let userId = session.userId else { return nil }
        return UUID(uuidString: userId)
    }

    func prepare() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }

        do {
            products = try await Product.products(for: ProductID.all)
                .sorted { $0.price < $1.price }
            await retryUnfinishedTransactions()
            await refreshEntitlements()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func purchase(_ product: Product) async {
        let refillAccountToken: UUID?
        if ProductID.refillCount(for: product.id) != nil {
            guard MazleSessionStore.shared.isSignedIn else {
                errorMessage = "Sign in before buying refill tickets so they stay with your Mazle account."
                return
            }
            guard let accountToken = Self.refillAccountToken(for: MazleSessionStore.shared.session) else {
                errorMessage = "Sign out and sign in again before buying refill tickets."
                return
            }
            refillAccountToken = accountToken
        } else {
            refillAccountToken = nil
        }
        guard !purchasingProductIDs.contains(product.id) else { return }
        purchasingProductIDs.insert(product.id)
        defer { purchasingProductIDs.remove(product.id) }
        errorMessage = nil
        do {
            let result: Product.PurchaseResult
            if let refillAccountToken {
                result = try await product.purchase(options: [.appAccountToken(refillAccountToken)])
            } else {
                result = try await product.purchase()
            }
            switch result {
            case .success(let verification):
                await handle(verification, finish: true)
            case .userCancelled:
                break
            case .pending:
                errorMessage = "The purchase is pending App Store approval."
            @unknown default:
                errorMessage = "The App Store returned an unknown purchase state."
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func restorePurchases() async {
        guard !isRestoring else { return }
        isRestoring = true
        errorMessage = nil
        defer { isRestoring = false }

        do {
            try await AppStore.sync()
            await refreshEntitlements()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    var hasArchiveAccess: Bool {
        purchasedProductIDs.contains(ProductID.archiveLifetime) ||
            purchasedProductIDs.contains(ProductID.archiveMonthly)
    }

    private func observeTransactions() -> Task<Void, Never> {
        Task { [weak self] in
            for await result in Transaction.updates {
                guard !Task.isCancelled else { return }
                await self?.handle(result, finish: true)
            }
        }
    }

    private func refreshEntitlements() async {
        purchasedProductIDs.removeAll()
        for await result in Transaction.currentEntitlements {
            await handle(result, finish: false)
        }
        lastEntitlementRefresh = Date()
    }

    private func retryUnfinishedTransactions() async {
        for await result in Transaction.unfinished {
            await handle(result, finish: true)
        }
    }

    private func handle(_ result: VerificationResult<Transaction>, finish: Bool) async {
        switch result {
        case .verified(let transaction):
            if let refillCount = ProductID.refillCount(for: transaction.productID) {
                guard let expectedAccountToken = Self.refillAccountToken(for: MazleSessionStore.shared.session),
                      transaction.appAccountToken == expectedAccountToken else {
                    errorMessage = "This refill belongs to another Mazle account. Sign in to that account to finish it."
                    return
                }
                let disposition = await AdventureProgressStore.shared.applyPurchasedRefill(
                    count: refillCount,
                    transactionId: transaction.id,
                    signedTransaction: result.jwsRepresentation
                )
                if finish, disposition.shouldFinishStoreTransaction {
                    await transaction.finish()
                }
                if case .rejected(let message) = disposition {
                    errorMessage = "Mazle rejected this refill purchase: \(message)"
                } else if finish, disposition == .pending {
                    errorMessage = "Purchase verified by Apple. Mazle verification will retry automatically."
                }
                return
            }

            let active = transaction.revocationDate == nil &&
                (transaction.expirationDate == nil || transaction.expirationDate! > Date())
            if active {
                purchasedProductIDs.insert(transaction.productID)
            } else {
                purchasedProductIDs.remove(transaction.productID)
            }
            if finish {
                await transaction.finish()
            }
            await syncServer(jwsRepresentation: result.jwsRepresentation)
        case .unverified:
            errorMessage = "The App Store could not verify this transaction."
        }
    }

    private func syncServer(jwsRepresentation: String) async {
        guard let session = MazleSessionStore.shared.session, !session.isExpired else { return }
        do {
            serverEntitlement = try await AuthenticatedMazleService(session: session)
                .syncAppleTransaction(jwsRepresentation: jwsRepresentation)
        } catch {
            if serverEntitlement == nil {
                errorMessage = "Purchase verified on this device; account entitlement sync is pending."
            }
        }
    }
}

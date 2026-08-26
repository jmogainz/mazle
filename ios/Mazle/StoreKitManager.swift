import Combine
import StoreKit

@MainActor
final class StoreKitManager: ObservableObject {
    enum ProductID {
        static let archiveLifetime = "com.mazle.archive.lifetime"
        static let archiveMonthly = "com.mazle.archive.monthly"
        static let all = [archiveLifetime, archiveMonthly]
    }

    @Published private(set) var products: [Product] = []
    @Published private(set) var purchasedProductIDs = Set<String>()
    @Published private(set) var isLoading = false
    @Published private(set) var isRestoring = false
    @Published private(set) var lastEntitlementRefresh: Date?
    @Published var errorMessage: String?

    private var updatesTask: Task<Void, Never>?

    init() {
        updatesTask = observeTransactions()
    }

    deinit {
        updatesTask?.cancel()
    }

    func prepare() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }

        do {
            products = try await Product.products(for: ProductID.all)
                .sorted { $0.price < $1.price }
            await refreshEntitlements()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func purchase(_ product: Product) async {
        errorMessage = nil
        do {
            switch try await product.purchase() {
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

    private func handle(_ result: VerificationResult<Transaction>, finish: Bool) async {
        switch result {
        case .verified(let transaction):
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
        case .unverified:
            errorMessage = "The App Store could not verify this transaction."
        }
    }
}

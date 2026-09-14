import StoreKitTest
import XCTest

final class StoreKitConfigurationTests: XCTestCase {
    func testLocalStoreKitConfigurationLoads() throws {
        let session = try SKTestSession(configurationFileNamed: "Mazle")
        session.disableDialogs = true
        session.clearTransactions()
    }
}

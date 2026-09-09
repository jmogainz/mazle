import SwiftUI
import CoreText

// Debug previews and the first TestFlight build never inherit a real account or
// production endpoint. Release builds use the live Mazle configuration only when
// they are not compiled with OFFLINE_TESTFLIGHT.
enum MazleRuntimeConfiguration {
    static var isOfflineTestFlight: Bool {
        #if OFFLINE_TESTFLIGHT
        return true
        #else
        return false
        #endif
    }

    static var isOfflinePreview: Bool {
        #if DEBUG
        let process = ProcessInfo.processInfo
        return process.arguments.contains("-MazleOfflinePreview")
            || process.environment["MAZLE_OFFLINE_PREVIEW"] == "1"
            || process.environment["XCTestConfigurationFilePath"] != nil
        #else
        return false
        #endif
    }

    static var isOfflineBuild: Bool {
        isOfflineTestFlight || isOfflinePreview
    }

    static var apiBaseURL: URL {
        if isOfflineTestFlight {
            return URL(string: "offline://mazle-testflight")!
        }
        return URL(string: isOfflinePreview ? "http://127.0.0.1:9" : "https://mazle.io")!
    }

    static var adventureDefaults: UserDefaults {
        guard isOfflineBuild else { return .standard }
        let suite = isOfflineTestFlight
            ? "com.mazle.adventure.testflight"
            : "com.mazle.adventure.preview"
        let defaults = UserDefaults(suiteName: suite)!
        if ProcessInfo.processInfo.arguments.contains("-MazleResetAdventurePreview") {
            defaults.removePersistentDomain(forName: suite)
        }
        return defaults
    }
}

enum MazleRuntimeError: LocalizedError, Sendable {
    case offlineOnlyBuild

    var errorDescription: String? {
        switch self {
        case .offlineOnlyBuild:
            return "Networking is disabled in this offline Mazle build."
        }
    }
}

private enum MazleFontRegistrar {
    static func registerBundledFonts() {
        let fontNames = [
            "Nunito-Regular",
            "Nunito-SemiBold",
            "Nunito-Bold",
            "Nunito-ExtraBold",
            "Nunito-Black",
        ]

        for fontName in fontNames {
            guard let url = Bundle.main.url(forResource: fontName, withExtension: "ttf") else {
                continue
            }
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }
}

@main
struct MazleApp: App {
    @StateObject private var game = GameViewModel()
    @StateObject private var storeKit = StoreKitManager()
    @StateObject private var adventure = AdventureProgressStore.shared

    init() {
        MazleFontRegistrar.registerBundledFonts()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(game)
                .environmentObject(storeKit)
                .environmentObject(adventure)
        }
    }
}

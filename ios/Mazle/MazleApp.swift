import SwiftUI
import CoreText

// Debug previews and the first TestFlight development build never inherit a
// real account or API endpoint. The TestFlight flag is a compile-time Release
// contract, not a launch argument that can be omitted from an uploaded build.
enum MazleRuntimeConfiguration {
    static var isOfflineTestFlight: Bool {
        #if MAZLE_OFFLINE_TESTFLIGHT
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

    static var isOfflineMode: Bool {
        isOfflineTestFlight || isOfflinePreview
    }

    static var apiBaseURL: URL {
        // Offline builds use a non-network URL as a defense-in-depth marker.
        // Runtime service guards below fail before URLSession can be reached.
        URL(string: isOfflineMode ? "offline://mazle.local" : "https://mazle.io")!
    }

    static var adventureDefaults: UserDefaults {
        let suite: String
        if isOfflineTestFlight {
            suite = "com.mazle.adventure.testflight"
        } else if isOfflinePreview {
            suite = "com.mazle.adventure.preview"
        } else {
            return .standard
        }

        let defaults = UserDefaults(suiteName: suite)!
        if ProcessInfo.processInfo.arguments.contains("-MazleResetAdventurePreview") {
            defaults.removePersistentDomain(forName: suite)
        }
        return defaults
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

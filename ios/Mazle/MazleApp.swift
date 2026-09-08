import SwiftUI
import CoreText

// Debug previews and hosted tests never inherit a real account or API endpoint.
// Release builds always use the normal production configuration.
enum MazleRuntimeConfiguration {
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

    static var apiBaseURL: URL {
        URL(string: isOfflinePreview ? "http://127.0.0.1:9" : "https://mazle.io")!
    }

    static var adventureDefaults: UserDefaults {
        guard isOfflinePreview else { return .standard }
        let suite = "com.mazle.adventure.preview"
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

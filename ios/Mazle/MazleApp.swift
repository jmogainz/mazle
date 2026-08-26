import SwiftUI
import CoreText

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

    init() {
        MazleFontRegistrar.registerBundledFonts()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(game)
                .environmentObject(storeKit)
        }
    }
}

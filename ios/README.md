# Mazle iOS

Native SwiftUI implementation of Mazle's daily puzzle.

## Current slice

- Native SwiftUI board and app shell; no `WKWebView` or Phaser dependency.
- Rust/TypeScript tile IDs and movement semantics ported to `MazeEngine.swift`.
- Daily puzzle loading from `https://mazle.io/api/daily`, with today's `/api/archive/<date>` fallback.
- Cached puzzle and in-progress state through `UserDefaults` for offline resume.
- Native swipe input, accessible directional controls, haptics, share sheet, and daily notification reminder.
- StoreKit 2 manager and a local `Mazle.storekit` configuration with the lifetime archive product ID.

## Generate and test

Requires Xcode 26.6, iOS 17+, Swift 6, and XcodeGen.

```bash
cd ios
xcodegen generate
xcodebuild \
  -project Mazle.xcodeproj \
  -scheme Mazle \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  test CODE_SIGNING_ALLOWED=NO
```

`project.yml` is the source of truth for the generated project. The generated scheme maps `Mazle.storekit` into the Xcode Run action; launching with `simctl` does not apply Xcode's Run-action StoreKit session configuration.

## Before TestFlight/App Store submission

1. Register the final bundle ID and signing team.
2. Create the StoreKit products in App Store Connect using the IDs in `StoreKitManager.ProductID`.
3. Connect verified StoreKit transactions to server-side Mazle entitlements. The existing Stripe website flow should remain separate; digital iOS unlocks should use Apple IAP.
4. Add native authentication/deep-link handling and result/leaderboard submission against the existing API.
5. Run device/TestFlight checks for notifications, haptics, OAuth, purchase restoration, and offline/online transitions.

### Local StoreKit note

The scheme and `Mazle.storekit` are wired, and `SKTestSession` can load the configuration. On the installed iOS 26.5 simulator/Xcode 26.6 combination, StoreKit product queries currently return an empty list with `SKInternalErrorDomain Code=3`; this is an Apple/Xcode StoreKit test-session limitation observed during verification, not treated as a passing purchase test. Re-run the product/purchase check on a newer Xcode/runtime or in App Store sandbox before release.

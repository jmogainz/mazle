# Mazle development handoff

## Branch and release boundary

- Canonical repository: `jmogainz/mazle`.
- Development integration branch: `integration/adventure-web-ios`.
- This branch includes the native app, shared 50-level Adventure catalog/API,
  and web Adventure. It is a development checkpoint, not a production release.
- Do not merge into `main` or change `.github/workflows/deploy.yml` during setup.
  That existing workflow deploys web production on pushes to `main`.
- `vercel.json` currently disables Git deployments. Its build configuration uses
  production defaults; do not copy those blindly into a development deployment.
- Add iOS CI through a separate PR targeting this integration branch. Start with
  manual dispatch only, an explicit allowed-branch check excluding `main`, and a
  protected `testflight-development` GitHub environment requiring approval.
- No TestFlight workflow, Apple credentials, app registration or tester group has
  been configured as part of this handoff. No production migrations were run.

## Native project

- Project: `ios/Mazle.xcodeproj`; app/unit-test scheme: `Mazle`.
- UI-test scheme: `MazleUI`.
- Project source: `ios/project.yml`; regenerate with XcodeGen when changing it.
- Current bundle ID: `com.mazle.game` (confirm/register before distribution).
- Current marketing version: `0.1`; build number: `1`. CI should allocate unique
  increasing build numbers, using the existing Semreh approach as a reference.
- Swift 6, iOS 17+; locally tested with Xcode 26.6 / iOS Simulator 26.5.
- Confirm Apple team, App Store Connect app record, active agreements, signing,
  privacy declarations and export compliance before upload. Do not assume the
  current source tree constitutes completed App Store submission metadata.
- Semreh's pipeline is a read-only reference, not permission to change Semreh.
  Its Apple team/credentials may be reused only with the owner's authorization.

## Backend isolation is a required gate

Native Release currently defaults to `https://mazle.io`. Before development
TestFlight, implement an explicit development configuration targeting an isolated
backend, or a deliberate offline-only build. Do not upload the current Release
configuration assuming it is isolated. Debug preview switches are Debug-only.

For local simulator QA, launch with `-Adventure -MazleOfflinePreview`; optionally
add `-MazleResetAdventurePreview`. This blocks real API/Keychain/StoreKit access and
uses a separate preview-progress suite. It is not a TestFlight configuration.

For a test website, configure a separate database, authentication callbacks,
secrets and sandbox payment credentials. Apply migrations only to the disposable
test database. Never invoke `ENV=prod` or allow production migration commands.
API and energy/payment release caveats are in `docs/adventure-mode.md`.

## Credentials and testers

The owner should enter these directly into the new GitHub environment, never chat:

- `APP_STORE_CONNECT_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_PRIVATE_KEY`

Validate the API key's app/signing permissions. Secret values cannot be read back
from Semreh's GitHub environment. Do not extract unrelated local credentials.

Obtain the intended testers' Apple Account emails privately. Use an internal
TestFlight group for eligible App Store Connect users. For people who should not
have App Store Connect access, use external testing and its applicable review
process instead of granting unnecessary account privileges. Confirm intended
recipients before invitations; an upload alone does not enroll testers.

## Verification and remaining work

- Web smoke: 13 checks passed after the final scoreboard change (real swipes,
  win/failure, persistence, account isolation, compact/landscape layouts).
- Native focused regression: 25 tests passed.
- iPhone gameplay, retry, map/settings and preview passed in separate runs.
- iPad UI: four tests passed, including rotation during a solve; a subsequent
  full-display screenshot/rotation test also passed. Final landscape screenshot
  review remains pending; interaction tests alone do not prove visual polish.
- Catalog: six tests passed; server energy/request: 13 tests passed.
- Physical sound/haptic quality, difficulty tuning and complete device visual
  parity still require human QA. Payment foundations are not production-ready.
- Unrelated unfinished Daily statistics edits in `ContentView.swift` remain local
  and are intentionally not included in this branch's commits.

Focused reproducible commands and content/release caveats are documented in
`docs/adventure-mode.md`; polish decisions are in `docs/adventure-polish.md`.

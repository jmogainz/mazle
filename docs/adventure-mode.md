# Mazle Adventure

Adventure is a separate, evergreen campaign mode. It uses Mazle's existing step, ice-slide, and one-way-ledge movement rules; the campaign map, sequential levels, stars, energy, and refill shop are the Candy Crush-adjacent parts. It is not a match-three game.

## Launch content

- 50 deterministic levels in five chapters of ten.
- One shared catalog: `src/adventure/content/adventure-levels-v1.json`.
- Sequential unlocks. Completing level N unlocks N+1.
- Three stars are awarded at the optimal route, two within the chapter's efficiency allowance, and one within the move limit.
- The checked-in solver proves every level is solvable and has exactly one shortest route.
- Difficulty rises by chapter. Ice begins after the ground tutorial; ledges begin in chapter 3.

The web app reads the catalog directly. Xcode bundles that same JSON file as a resource, so web and iOS cannot silently drift onto different level data.

## Energy contract

- Base capacity: 3 hearts.
- Mazle Plus capacity: 5 hearts, plus one complimentary refill per UTC day.
- Regeneration: one heart every 30 minutes.
- Levels 1–5 are training levels and never cost a heart.
- Starting a later level reserves a heart without changing the displayed count.
- A win or leaving before the first move returns the reservation.
- A failed level or leaving after a move consumes one heart.
- A refill ticket restores all hearts and never expires.

The server owns signed-in energy and purchased tickets. Attempt and refill endpoints are idempotent, and only one active server attempt is allowed per player. Stale attempts and server-driven level switches refund reservations because the server has no evidence that a move occurred.

## Progress and identity

Guest play remains local-first. Signed-in progress is stored in PostgreSQL and reconciled on web/iOS. Device caches use separate `guest` and `user:<UUID>` namespaces; account changes invalidate in-flight responses before they can update the next account. Only level results may be claimed from guest into the first signed-in account—energy, purchases, attempts, transaction IDs, and pending grants never cross identities.

The web bootstrap asks the Adventure state endpoint for its authoritative storage scope before uploading cached progress. It allows only same-account synchronization or the one-time guest-to-account claim, never user A to user B/guest.

## HTTP surface

All endpoints are under `/api/adventure`:

- `GET /state` — progress, energy, active attempt, and authoritative storage scope.
- `POST /start` — validate unlock/energy and create or resume an attempt.
- `POST /complete` — finish a winning attempt and update best stars/moves/time.
- `POST /fail` — fail or abandon an attempt and settle its heart reservation.
- `POST /sync` — merge contiguous local level results into a signed-in account.
- `GET /refills/offer` — configured Stripe packs with live display prices.
- `POST /refills/checkout` — authenticated, same-origin Stripe Checkout creation.
- `POST /refills/use` — use a purchased ticket or Plus daily refill.
- `POST /refills/apple` — verify a StoreKit JWS and grant its pack once.

Migration `000008_adventure_mode.sql` adds Adventure players, progress, attempts, energy operations, purchase allocations, and provider-revocation records. It intentionally follows the already-shipped Apple migration at version 7, so both fresh installs and existing version-7 databases receive the Adventure schema. Purchases are allocated FIFO. A refund removes only that purchase's unused tickets; it cannot erase tickets from another pack. Revocation tombstones prevent an out-of-order refund followed by a late webhook from granting tickets.

Adventure mutation endpoints require JSON. Browser requests with an `Origin` header must be same-origin; originless native requests remain supported for the iOS bearer-token flow.

## Payment configuration

Web packs are configured with existing Stripe credentials plus:

- `STRIPE_ADVENTURE_REFILL_1_PRICE_ID`
- `STRIPE_ADVENTURE_REFILL_5_PRICE_ID`
- `STRIPE_ADVENTURE_REFILL_12_PRICE_ID`

The Stripe webhook must subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `charge.refunded` in addition to the existing subscription events.

iOS pack IDs default to:

- `com.mazle.adventure.refill.1`
- `com.mazle.adventure.refill.5`
- `com.mazle.adventure.refill.12`

The local StoreKit configuration prices them at $0.99, $3.99, and $7.99 for testing. Production prices remain controlled by App Store Connect. Server verification requires `APPLE_APP_STORE_BUNDLE_ID`, `APPLE_APP_STORE_APP_ID` in production, `APPLE_APP_STORE_ENVIRONMENT`, and `APPLE_APP_STORE_ROOT_CERTS_BASE64`; product IDs may be overridden with the corresponding `APPLE_APP_STORE_REFILL_*_PRODUCT_ID` variables. iOS binds refill purchases to the authenticated user UUID with StoreKit's app-account token and does not expose tickets until the server accepts the signed transaction.

Creating the Stripe prices/webhook, creating and approving the App Store Connect consumables, and installing Apple root certificates are external release tasks. Local StoreKit/Stripe fixtures do not perform real charges.

Before enabling real-money iOS purchases, implement and test an App Store Server Notifications V2 receiver for refund/revocation events, then configure its URL in App Store Connect. Before paid energy becomes an enforcement boundary, submit server-verifiable movement traces or mark offline imports as untrusted; the local-first launch currently accepts client-reported completions. Add guest rate limiting and attempt retention before opening the mode to broad unauthenticated traffic.

## Local verification

Use the repository Make targets for the normal build workflow:

```sh
export UNIQUE_RUNNER_ID=$(whoami)
make build
```

The focused deterministic checks are:

```sh
npx --yes tsx --test src/adventure/adventure.test.ts
node --experimental-strip-types --test \
  src/lib/server/adventureEnergy.test.mjs \
  src/lib/server/adventureRequest.test.mjs
npx tsc --noEmit
npm run lint
```

With a local web server on port 3100, the browser smoke test covers portrait, small-screen, landscape, completion, failure, offline play, focus trapping, rotation, persistence, and live account switching:

```sh
ADVENTURE_QA_OUTPUT=/tmp/mazle-adventure-web-qa \
CHROME_DEBUG_PORT=9334 \
node tests/adventure-web/smoke.mjs http://127.0.0.1:3100
```

The backend integration script must only be run against a disposable local PostgreSQL database whose migrations have been applied:

```sh
DB_URL=postgresql://localhost/mazle_adventure_test \
npx --yes tsx scripts/adventure-backend-integration.mjs
```

The iOS test scheme includes catalog parity, movement, energy, persistence, account switching, error handling, and StoreKit binding:

```sh
cd ios
xcodebuild -quiet \
  -project Mazle.xcodeproj \
  -scheme Mazle \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  test CODE_SIGNING_ALLOWED=NO
```

## Authoring the next campaign

The runtime never generates campaign levels. `src/adventure/tools/author-catalog.mjs` deterministically prints a complete catalog, and `src/adventure/validation.ts` is the release gate. For a new catalog version:

1. Change the authoring inputs and content version.
2. Generate to a new JSON file; do not overwrite v1 until migration behavior is decided.
3. Run the catalog tests and review every validation warning.
4. Update the deterministic SHA-256 expectation only after the level diff is intentionally approved.
5. Verify the same JSON is included in the Xcode resource phase.
6. Exercise chapter starts, mechanic introductions, move-limit boundaries, and the final level on both platforms.

Never hand-edit declared optimal moves or solutions without rerunning the solver. Catalog versions are part of attempt and progress contracts, so a shipped content change needs an explicit migration/reconciliation decision.

# Mazle TODO (Frontend/UI Next)

## Archive calendar: remove “lock flicker”

- Implement tri-state loading for archive availability so the calendar does **not** briefly show locked days before entitlements load.
- Preferred behavior:
  - Initial render: neutral “loading” skeleton (no lock icons).
  - After data arrives: show locked/unlocked based on API response.
- Data source:
  - `GET /api/archive/days?from=YYYY-MM-DD&to=YYYY-MM-DD` returns `{ entitled, days: [{date, locked}] }`.
- Likely touchpoints:
  - Archive UI component(s) (calendar/modal) in `src/app/page.tsx` and/or `src/components/*`.
  - Any client API wrapper in `src/lib/api/*` used by archive UI.

## Stripe checkout: “already owned” guardrails

- Current behavior: even when `GET /api/me` shows `{ archiveAccess: true, adsRemoved: true }`, `POST /api/stripe/checkout` still returns a valid Checkout URL.
- Desired behavior:
  - UI: replace “Buy” CTA with “Owned” state (and/or “Manage” link) when entitled.
  - API: add a server-side entitlement check; if already entitled, return a non-error response like `{ alreadyOwned: true }` (or a dedicated `409 ALREADY_ENTITLED`) instead of creating a new Checkout session.
- Goal: prevent accidental double-purchases and make the purchase UX feel deterministic.

## Auth: Apple sign-in (UI + local test)

- Backend support exists in `src/auth.ts` (Apple provider is enabled when Apple env vars are present), but the end-to-end UX is not finished until:
  - The UI shows an Apple button when `/api/auth/providers` includes `apple`.
  - The sign-in modal/page handles Apple-specific errors cleanly (misconfigured return URL, missing scopes, etc).
- Add to local E2E verification:
  - Configure Apple web sign-in in Apple Developer.
  - Confirm `/api/auth/providers` returns both `google` and `apple`.
  - Complete sign-in and confirm `GET /api/me` returns `mode:"user"`.

## Profile: change display name (signed-in users)

- Add a simple “Profile” UI (modal or route) for signed-in users to change display name.
- Server API already exists:
  - `POST /api/claim` with JSON `{ "displayName": "NewName123" }`
  - Validation: 3–24 chars, alphanumeric only.
  - Updates:
    - Postgres `users.display_name`
    - Leaderboard name map for `user:<id>` (so leaderboards reflect the new name).
- UX requirements:
  - Show current display name (from `GET /api/me`).
  - Input + submit; handle errors:
    - `409 NAME_TAKEN` → show “name already taken”
    - `400 INVALID_NAME` → show validation message
  - On success: update local UI immediately (header/name display) without full refresh.

## Archive UX: navigation + modal consistency

- Ensure “Back to archive” exists when playing an archive puzzle (not only “Back to today”).
- Fix modal/route state sync bugs:
  - After purchase → back to menu → back to archive → selecting a day should not leave the calendar visible over a loaded puzzle.
  - Closing the archive UI should not accidentally route you back to “today” if you were on an archive day.
  - Refreshing while archive is open should recover cleanly (either restore archive modal over daily, or be a dedicated `/archive` route that renders correctly).

## Share modal: swipeable tabs

- Make post-game share UI swipe between `Share` and `Leaderboard` (horizontal gesture + tab buttons).
- Keep the look/feel consistent with existing game UI (font, rounded corners, spacing, palette).

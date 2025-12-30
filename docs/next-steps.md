# Next Steps (After Local E2E Pass)

This repo now has enough wiring to test the full loop locally (Auth → Stripe → Entitlements → Archive unlock → Leaderboard submit). Before polishing UI, lock down correctness and make it easy to ship safely.

## 1) Re-run the local E2E checklist any time you change server code

Follow: `docs/local-e2e-test-plan.md`

Stop criteria for “safe to merge”:
- Auth providers load (`/api/auth/providers` includes Google when env vars are set).
- Stripe offer endpoint returns correct price (`/api/stripe/archive-offer`).
- Guest checkout is rejected (`/api/stripe/checkout` → `401 AUTH_REQUIRED`).
- Invalid price is rejected (`/api/stripe/checkout` → `400 INVALID_PRICE`).
- Leaderboard rejects non-today submissions (`/api/leaderboard/submit` → `400 DATE_NOT_TODAY`).
- Purchase grants entitlements (`/api/me` shows `archiveAccess:true` and `adsRemoved:true`).
- Past-day archive fetch returns 200 after purchase (`/api/archive/:yesterday`).

## 2) Known gaps / polish work (not implemented yet)

Tracked in: `TODO.md`

## 3) Apple Auth (to match the epic)

Epic requires Google + Apple OIDC. Code already supports Apple when env vars exist (`src/auth.ts`), but you still need:
- Apple Developer setup (Services ID + return URL) and production keys.
- UI that shows an Apple sign-in option when `/api/auth/providers` includes it.

Add an explicit local test once Apple is configured:
- `GET /api/auth/providers` includes `apple`
- Sign in succeeds and `GET /api/me` returns `mode:"user"`

## 4) “Prod cutover” prep (do later, not during local testing)

Use: `docs/infra-setup-checklist.md`

Notes:
- Using personal Google/Stripe accounts for local testing is fine; production is just swapping env vars + OAuth/Stripe config.
- If you pasted keys/tokens into chat, rotate them before production.

## 5) Gaps vs `docs/auth-stripe-leaderboard-epic.md` (intentional / future work)

- Local dev automation: the epic proposes Docker Postgres + seed container; current setup relies on Neon + runtime schema creation.
- Leaderboard snapshot job: epic calls for a nightly snapshot into Postgres; current system persists per-submission in `leaderboard_submissions` but has no snapshot job yet.
- Rate limiting: epic recommends rate limiting leaderboard writes; not implemented yet.

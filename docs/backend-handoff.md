# Backend Handoff: Frontend Contracts (Auth + Stripe + Leaderboard + Archive)

This doc is the backend-facing summary of the frontend contract. The full UX spec lives at `docs/frontend-ux-spec.md`.

## Canonical “Day”
- **Day key**: `YYYY-MM-DD` in `America/New_York` (used everywhere: archive, leaderboard, puzzle lookup).
- Mazle number is derived from day key (`Mazle #N` primary label; date is secondary).

## URLs & Query Params (Frontend Already Shipped)

### Route-backed overlays
These are real routes that render as overlays when navigated to from the game:
- `/leaderboard`
- `/archive`
- `/account`

### Archive paywall / checkout
The archive calendar uses query params for paywall and Stripe return URLs:
- Locked day click → `/archive?paywall=1&d=YYYY-MM-DD`
- Stripe success return → `/archive?checkout=success&d=YYYY-MM-DD`
- Stripe cancel return → `/archive?checkout=canceled&d=YYYY-MM-DD`

On `checkout=success`, the frontend polls `GET /api/me` for up to **15s** until `entitlements.archiveAccess === true`, then:
- If `d` is present → navigates to `/play/[d]`
- Else → shows “Archive unlocked” and stays on `/archive`

### Archive play
- `/play/[date]` plays an archive puzzle and **must not** affect daily streak/stats.
- If not entitled, frontend expects `403 ENTITLEMENT_REQUIRED` from `GET /api/archive/:date`.

## Entitlements (Required Shape)
Frontend expects `GET /api/me` to be the source of truth:
```ts
type MeResponse = {
  mode: "guest" | "user";
  displayName: string;
  entitlements: {
    archiveAccess: boolean;
    adsRemoved: boolean; // purchase also removes ads
  };
};
```

Purchase grants both:
- `archive_access`
- `ads_removed`

## API Routes Expected (See `src/lib/api/real.ts`)

### Identity
- `GET /api/me` → `MeResponse`
- `POST /api/guest` → `{ displayName: string }` (sets `guest_id` HttpOnly cookie)
- `POST /api/claim` → `{ displayName: string }` (links guest → user; migrate leaderboard ownership)
  - On collision: `409 { errorCode: "NAME_TAKEN", message }`

### Stripe
- `GET /api/stripe/archive-offer`
```ts
type ArchiveOfferResponse = {
  priceId: string;
  formattedPrice: string; // e.g. "$4.99"
  currency: string;       // e.g. "usd"
  purchaseType: "one_time";
  grants: ("archive_access" | "ads_removed")[];
};
```

- `POST /api/stripe/checkout`
```ts
type CheckoutRequest = {
  priceId: string;
  successUrl: string; // absolute
  cancelUrl: string;  // absolute
};
type CheckoutResponse = { url: string }; // Stripe Checkout URL
```

### Leaderboard (daily-only)
Ranking is deterministic:
1) `timeMs` asc
2) `attemptsUsed` asc
3) `submittedAt` asc

- `GET /api/leaderboard/top?date=YYYY-MM-DD&limit=50`
- `GET /api/leaderboard/me?date=YYYY-MM-DD` (returns `null` if not submitted)
- `GET /api/leaderboard/around?date=YYYY-MM-DD&rank=123&window=5`
- `POST /api/leaderboard/submit`
```ts
type LeaderboardSubmitRequest = {
  date: string;           // today only
  timeMs: number;
  attemptsUsed: number;   // 1..3
};
type LeaderboardSubmitResponse = {
  ok: true;
  rank?: number;
  updated: boolean; // true if this improved the user’s best score
};
```

### Archive
- `GET /api/archive/days?from=YYYY-MM-DD&to=YYYY-MM-DD`
```ts
type ArchiveDaysResponse = {
  entitled: boolean;
  days: Array<{ date: string; locked: boolean }>;
};
```

- `GET /api/archive/:date`
```ts
type ArchivePuzzleResponse = {
  date: string;
  puzzleNumber: number;
  seed: string; // equals date
  puzzle: import("@/game/types").PuzzleData;
};
```

### Errors (standard)
All non-2xx responses should be JSON:
```ts
type ApiError = { errorCode: string; message: string };
```

## Notes
- Frontend dev is unblocked via mock adapter (`src/lib/api/mock.ts`); switching to real is purely backend wiring.
- Ads are shown only when `NEXT_PUBLIC_ADS_ENABLED` is true and `entitlements.adsRemoved === false` (placements: leaderboard/archive/account/post-game).


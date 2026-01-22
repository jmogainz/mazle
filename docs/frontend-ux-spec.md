# Mazle Frontend UX Spec (Auth + Leaderboard + Archive)

Status: **v0.1** (decisions locked from chat; update via PRs)

This spec is the frontend source of truth for **routes, UI states, and API contracts** for:
- Guest-first identity + claim via Auth.js
- Daily global leaderboard
- Paid archive calendar + Stripe checkout

It is written so backend implementation can be wired in without UI refactors.

---

## 0) Product Principles (Non-negotiable)

1) **Daily-first**: `/` is always playable without auth or purchase.
2) **Progressive disclosure**: only show extra surfaces (leaderboard/archive/account) when user asks or after game ends.
3) **Single primary action** per screen (no clutter).
4) **Deterministic “day”**: Mazle days roll over at **midnight America/New_York**.
5) **No hidden timers**: time pauses whenever an overlay/modal is open (easy to change later via one switch).

---

## 1) Definitions

### 1.1 Puzzle identity
- `date`: `YYYY-MM-DD` in **America/New_York** (this is the canonical day key everywhere).
- `seed`: equal to `date` (existing generator convention).
- `puzzleNumber`: `Mazle #N` (primary label everywhere), with `date` as secondary label.

### 1.2 Attempts / lives
- A “try” == a life attempt.
- `attemptsUsed` for a **completed** run:
  - `attemptsUsed = failedAttempts + 1`
  - `failedAttempts` is the number of burned lives (max 2 for a successful run with 3 lives).
- Leaderboard tie-break uses `attemptsUsed` (fewer is better) only when `timeMs` ties.

### 1.3 Modes
- `daily` mode: today’s puzzle at `/` (affects streak/stats).
- `archive` mode: past puzzle at `/play/[date]` (does **not** affect streak/stats).

---

## 2) Global UX Rules

### 2.1 Time pause rules
Time is considered paused when **any** of these are open:
- In-game modals: Help, Stats, Share (existing)
- Route overlays: Leaderboard, Archive, Account
- Paywall / post-checkout “Unlocking…” overlay

Implementation requirement:
- Timer pause must be implemented by a single `setPaused(true/false)` call on the game scene so we can change policy later without rework.

### 2.2 Clean UI conventions
- Keep “Today” screen mostly unchanged: no leaderboards or paywalls mixed into the main play UI.
- Post-game share modal is the “moment” to offer: `Share` tab ↔ `Leaderboard` tab (swipe left/right), then (optional) sign in.
- Locked archive is visible but never blocks daily play.

---

## 3) Routes + Overlay Architecture (Next.js App Router)

We use **route-backed overlays**: real URLs that render as overlays when navigated from the game, and render as full pages on direct visit.

### 3.1 Route map
- `/` — Daily game (client page; existing `src/app/page.tsx`)
- `/leaderboard` — Leaderboard overlay/page
- `/archive` — Archive calendar overlay/page
- `/account` — Account overlay/page
- `/play/[date]` — Play a past puzzle (archive mode; full page)

### 3.2 Overlay mechanism (implementation plan)
Use App Router parallel route slot `@overlay` + intercepting routes.

File structure (planned):
```
src/app/
  @overlay/
    default.tsx                      # returns null
    (.)leaderboard/page.tsx          # overlay version
    (.)archive/page.tsx              # overlay version
    (.)account/page.tsx              # overlay version
  leaderboard/page.tsx               # full-page version
  archive/page.tsx                   # full-page version
  account/page.tsx                   # full-page version
  play/[date]/page.tsx               # archive play
```

Overlay close behavior:
- Clicking “Close” or `Esc` calls `router.back()`.
- Browser back closes overlay (expected).

### 3.3 Pause integration
On the game page (`/`), compute:
- `isRouteOverlayOpen = pathname !== '/'`
- `isModalOpen = showHelp || showStats || showShareCard || showDevTools || ...`
- `shouldPause = isRouteOverlayOpen || isModalOpen`
and call `gameControls.setPaused(shouldPause)` whenever it changes.

---

## 4) Identity & Entitlements UX

### 4.1 Identity states
All users are always in exactly one state:
- `guest`: has `displayName` + `guest_id` cookie
- `user`: has Auth.js session + `displayName`

Entitlements are independent:
- `archiveAccess: boolean`
- `adsRemoved: boolean`

### 4.2 Identity UX rules
- Guest is default and frictionless: no auth prompt on first visit.
- Account surface is informational unless user opts in.
- Claim is always framed as “Save name across devices / unlock archive purchase”.

### 4.3 Account overlay contents
**Guest**
- “You’re playing as `DisplayName`”
- “Sign in to save your name and keep purchases across devices.”
- Buttons: “Continue with Google”, “Continue with Apple” (Apple can be hidden if not configured)
- Setting: “Auto-submit wins to leaderboard” toggle

**Signed in**
- Shows `displayName` + provider badge (or “Signed in”)
- Button: “Sign out”
- Setting: “Auto-submit wins to leaderboard” toggle

### 4.4 Claim collision UX (rename on collision)
If `POST /api/claim` fails with `NAME_TAKEN`, show a dedicated Rename screen:
- Title: “That name is taken”
- Input for new display name (rules in §4.5)
- Primary: “Save name”
- Secondary: “Cancel”

### 4.5 Display name rules (client + server)
The server is the source of truth. The client validates to prevent obvious errors.

- Allowed chars: `A–Z`, `a–z`, `0–9` (no spaces, no punctuation)
- Length: `3..16`
- Uniqueness: case-insensitive unique across all profiles (guest + user)
- Reserved words: `MAZLE`, `ADMIN`, `MOD` (case-insensitive) are rejected

---

## 5) Leaderboard UX (Daily)

### 5.1 What appears where
- Post-win result card includes a secondary action: “View leaderboard”.
- Leaderboard overlay includes:
  - Today header (`Mazle #N` + date)
  - Top list (default 50)
  - “Me” panel (rank/time/attempts if submitted)
  - “Around me” (±5) if rank exists

### 5.2 Submission UX
We support **manual submit by default** + an optional “always submit” setting.

**Manual submit flow**
- After a daily win, show button:
  - “Submit my time”
- After submit:
  - Replace with “Submitted” + show rank

**Auto-submit flow**
- Setting `autoSubmitWins=true` (default false) stored locally.
- On daily win, automatically call submit in background and show “Submitting…” then “Submitted”.
- If submit fails, show “Couldn’t submit. Try again.” and keep manual submit button.

### 5.3 Ranking rules (server + UI expectations)
Sort key (best → worst):
1) `timeMs` (ascending)
2) `attemptsUsed` (ascending)
3) `submittedAt` (ascending)

Display per row:
- `rank`
- `displayName`
- `time` (formatted)
- `attemptsUsed` (shown as e.g. `1/3`, `2/3`, `3/3`)

### 5.4 Eligibility
- Only successful daily completions can submit.
- Archive completions never submit.

---

## 6) Archive UX (Calendar + Paywall + Play)

### 6.1 Calendar scope
- Calendar shows **launch date → yesterday** (NY time).
- “Today” is not a calendar tile; it is a dedicated “Back to Today” action.

### 6.2 Calendar tile states
Each day tile can be:
- `locked` (no entitlement)
- `unlocked` (entitled)
- `played` (optional future; not required v1)

Locked presentation:
- Lock icon + muted tile
- Clicking opens Paywall (not a dead end)

### 6.3 Paywall trigger + affordance
Trigger: click a locked day.

Navigation requirement:
- Clicking a locked day navigates to `/archive?paywall=1&d=YYYY-MM-DD`.
- The paywall is open iff `paywall=1` and `d` is present/valid.
- Closing the paywall returns to `/archive` (query params cleared).

Archive calendar header includes a subtle, always-visible cue:
- “Archive” + lock icon + “One-time unlock”

### 6.4 Paywall modal (one-time purchase)
Content:
- Title: “Unlock the Archive”
- Subtitle: “Play any past Mazle puzzle. Removes ads.”
- Price: pulled from Stripe offer endpoint (see §7.5)
- Primary: “Unlock — {formattedPrice}”
- Secondary: “Not now”

If user is not signed in:
- Replace primary action with:
  - “Sign in to unlock”
and start Auth.js with a callback back to the same paywall URL:
  - `signIn(provider, { callbackUrl: "/archive?paywall=1&d=YYYY-MM-DD" })`

### 6.5 Checkout + post-checkout behavior
Checkout:
- `POST /api/stripe/checkout` returns `{ url }`
- Browser navigates to Stripe Checkout

Return URLs:
- Success: `/archive?checkout=success&d=YYYY-MM-DD`
- Cancel: `/archive?checkout=canceled&d=YYYY-MM-DD`

On `/archive?checkout=success`:
- Show “Unlocking…” state
- Poll entitlement (see §7.2) for up to **15s** with backoff
- If entitlement becomes true:
  - If `d` query param exists, navigate to `/play/[d]`
  - Otherwise, show “Archive unlocked” toast and remain on calendar

On `/archive?checkout=canceled`:
- Show “Checkout canceled” toast and remain on calendar

### 6.6 Archive play (`/play/[date]`)
Header:
- `Mazle #N` (primary) + date (secondary)
- “Back to Archive” button
- “Today” button

Post-game share modal:
- Primary: “Share”
- Secondary: “Back to Archive”
- Footer text: “Pick another day in the Archive.”

Rules:
- No streak/stats mutation for daily stats (do not touch `mazle_daily` or streak counters).
- Share card must include an “Archive” marker (see §8.2).
- Leaderboard submission UI is hidden/disabled.

---

## 7) API Contracts (Frontend-facing)

All endpoints are **Next.js API routes** (Vercel) per `docs/mazle-architecture.puml` and `docs/auth-stripe-leaderboard-epic.md`.

### 7.1 Standard error contract
All non-2xx responses return JSON:
```ts
type ApiError = {
  errorCode: string;     // e.g. "NAME_TAKEN", "ENTITLEMENT_REQUIRED"
  message: string;
};
```

### 7.2 `GET /api/me` (required)
Single source of truth for identity + entitlement.

Response:
```ts
type MeResponse = {
  mode: "guest" | "user";
  displayName: string;
  entitlements: {
    archiveAccess: boolean;
    adsRemoved: boolean;
  };
};
```

### 7.3 `POST /api/guest`
Creates (or re-creates) a guest profile and sets `guest_id` in an HttpOnly cookie.

Response:
```ts
type GuestResponse = { displayName: string };
```

### 7.4 `POST /api/claim`
Links current guest to signed-in user and migrates leaderboard ownership.

Request:
```ts
type ClaimRequest = {
  displayName?: string; // provided only if resolving a NAME_TAKEN conflict
};
```

Success response:
```ts
type ClaimResponse = { displayName: string };
```

Errors:
- `409 NAME_TAKEN`

### 7.5 Stripe offer + checkout
**Offer endpoint** (for displaying price in UI):
- `GET /api/stripe/archive-offer`

Response:
```ts
type ArchiveOfferResponse = {
  priceId: string;
  formattedPrice: string; // e.g. "$4.99"
  currency: string;       // e.g. "usd"
  purchaseType: "one_time";
  grants: ("archive_access" | "ads_removed")[];
};
```

**Checkout endpoint**:
- `POST /api/stripe/checkout`

Request:
```ts
type CheckoutRequest = {
  priceId: string;
  successUrl: string; // absolute (use window.location.origin)
  cancelUrl: string;  // absolute (use window.location.origin)
};
```

Response:
```ts
type CheckoutResponse = { url: string };
```

### 7.6 Leaderboard endpoints
Dates are NY `YYYY-MM-DD`. Leaderboard is daily-only.

- `GET /api/leaderboard/top?date=YYYY-MM-DD&limit=50`
```ts
type LeaderboardEntry = {
  rank: number;
  displayName: string;
  timeMs: number;
  attemptsUsed: number; // 1..3
  isMe?: boolean;
};
type LeaderboardTopResponse = {
  date: string;
  entries: LeaderboardEntry[];
};
```

- `GET /api/leaderboard/me?date=YYYY-MM-DD`
```ts
type LeaderboardMeResponse = {
  date: string;
  rank: number;
  displayName: string;
  timeMs: number;
  attemptsUsed: number;
} | null;
```

- `GET /api/leaderboard/around?date=YYYY-MM-DD&rank=123&window=5`
```ts
type LeaderboardAroundResponse = {
  date: string;
  entries: LeaderboardEntry[];
};
```

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
  updated: boolean;       // true if this write improved best score
};
```

Errors:
- `400 INVALID_DATE` / `INVALID_PAYLOAD`
- `429 RATE_LIMITED`

### 7.7 Archive endpoints
- `GET /api/archive/days?from=YYYY-MM-DD&to=YYYY-MM-DD`
```ts
type ArchiveDay = {
  date: string;
  locked: boolean;
};
type ArchiveDaysResponse = {
  entitled: boolean;
  days: ArchiveDay[];
};
```

- `GET /api/archive/:date`
```ts
type ArchivePuzzleResponse = {
  date: string;
  puzzleNumber: number;
  seed: string;
  puzzle: import("@/game/types").PuzzleData;
};
```

Errors:
- `403 ENTITLEMENT_REQUIRED` (when locked)
- `404 NOT_FOUND` (if missing in archive store)

### 7.8 Dev mode behavior
In dev mode, all features are enabled and entitlement checks are bypassed.

Source of truth:
- Server sets `MAZLE_DEV_MODE=1`
- `GET /api/me` must return `entitlements.archiveAccess=true`
- Archive endpoints must not return `ENTITLEMENT_REQUIRED`

---

## 8) Client Persistence

### 8.1 Preferences
LocalStorage key: `mazle_prefs_v1`
```ts
type MazlePrefsV1 = {
  leaderboardAutoSubmitWins: boolean; // default false
};
```

### 8.2 Share text rules
- Daily share: `Mazle #N` (no date)
- Archive share: `Mazle #N · YYYY-MM-DD (Archive)`

---

## 9) UI Components (planned, code-facing)

### 9.1 Overlay shell (shared)
`OverlayShell` responsibilities:
- focus trap + `Esc` close
- `router.back()` close
- consistent header and scrolling
- mobile bottom-sheet behavior vs desktop centered sheet

### 9.2 Leaderboard module
- `LeaderboardView` (data-fetching + rendering)
- `LeaderboardRow`
- `SubmitPanel` (manual/auto submit status)

### 9.3 Archive module
- `ArchiveCalendar` (month grid + tile states)
- `PaywallModal`
- `UnlockingOverlay` (post-checkout polling)

### 9.4 Account module
- `AccountView` (identity, sign-in/out, preferences)
- `ClaimNameModal` (name taken resolution)

---

## 10) Rollout Milestones (frontend-only)

1) Overlay route scaffolding + OverlayShell + pause integration
2) Leaderboard UI with mocked API client + submit toggle
3) Archive calendar UI + paywall UI (mock offer + checkout redirect stub)
4) `/play/[date]` archive play mode (no stats/streak, archive share copy)
5) Wire real API routes as backend lands (no UI refactor; client layer swap)

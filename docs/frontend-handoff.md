# Frontend Handoff (Mazle): What’s Implemented + How It Works

This doc is written for **you** to own the frontend going forward. It covers:
- How to run the app and demo the new flows
- What I implemented (routes/components/state)
- How the architecture is set up so backend can plug in without refactors

Related docs:
- UX + API source-of-truth: `docs/frontend-ux-spec.md`
- Backend-facing contract summary: `docs/backend-handoff.md`
- Architecture overview: `docs/mazle-architecture.puml`

---

## 1) Demo: Run It + Test The Flows

### 1.1 Start the app
From repo root:
```bash
export UNIQUE_RUNNER_ID=$(whoami)

# optional: disable ngrok if you don’t need it
ENABLE_NGROK_FOR_DEV=0 make up
```

Open the app using the URL printed by `make up`:
- Look for a line like: `LAN URL: http://…`

Stop it later with:
```bash
export UNIQUE_RUNNER_ID=$(whoami)
make down
```

### 1.2 Confirm overlays + pause behavior (core UX rule)
1) From `/`, click the **… menu** (top-right).
2) Verify the in-game **timer stops** while the menu is open.
3) Close the menu and verify the timer resumes.
4) Open **Help** / **Stats** / **Share** and confirm the timer pauses there too.
5) Open **Leaderboard / Archive / Account** via the menu and confirm the timer pauses while the overlay is open.

### 1.3 Leaderboard (view + submit)
1) Open **Leaderboard** from the menu.
2) You should see:
   - “Top” list
   - “Me” panel
   - “Around Me” after you have a rank

To demo submission without solving today’s puzzle, you can seed a fake “win” locally:
1) Open browser DevTools → Console while on `/`.
2) Paste:
   ```js
   const date = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
   localStorage.setItem('mazle_daily', JSON.stringify({
     date,
     completed: true,
     moveCount: 10,
     timeMs: 42000,
     puzzleNumber: 1,
     failed: false,
     attempts: [], // failed attempts
   }));
   location.reload();
   ```
3) Open **Leaderboard** → click **Submit my time**.
4) You should see “Submitted” and your rank.

### 1.4 Archive (browse locked days → paywall → unlock → auto-open day)
This demo works end-to-end in **mock mode** (default in dev).
1) Open **Archive** from the menu.
2) Click any day tile → it navigates to `/archive?paywall=1&d=YYYY-MM-DD` and opens the paywall.
3) If you’re “guest”, click **Sign in to unlock**:
   - In mock mode this “claims” instantly (no real auth yet).
4) Click **Unlock — $…**
   - In mock mode it redirects to `/archive?checkout=success&d=…`
   - The UI shows “Unlocking…” and polls `GET /api/me` until entitlement is true
5) You should automatically land on `/play/[date]` for the day you clicked.

### 1.5 Archive play (`/play/[date]`)
1) Click **Begin**.
2) Verify timer pause works with menu/help/stats/share.
3) Finish the puzzle → Share modal opens; it has `Share` + `Leaderboard` tabs (swipe left/right).
4) Confirm this doesn’t touch daily stats/streak (archive mode is isolated).

### 1.6 Ads placeholder
Ads are a **placeholder component** so we can place slots early without picking an ad network.
1) Set `NEXT_PUBLIC_ADS_ENABLED=1` in your env (or `.env.local`) and restart with `make up`.
2) You’ll see “Advertisement” blocks in:
   - leaderboard/archive/account
   - post-game area (daily page)
3) After archive unlock, ads should disappear because purchase grants `adsRemoved=true`.

---

## 2) What’s Implemented (High-level)

### 2.1 New routes (overlay + full page)
We now have **route-backed overlays** (real URLs that render as overlays when opened from the game):
- `/leaderboard`
- `/archive`
- `/account`

And a full-page archive play route:
- `/play/[date]`

Implementation detail:
- Overlay versions live in `src/app/@overlay/(.)*/page.tsx`
- Full-page versions live in `src/app/*/page.tsx`
- Root layout now renders the `@overlay` slot: `src/app/layout.tsx`

### 2.2 API integration is “mock-first”
Frontend is unblocked without backend by using a client-side adapter:
- `src/lib/api/mock.ts` simulates `/api/*` responses (leaderboard entries, entitlements, checkout, archive puzzles).
- `src/lib/api/real.ts` defines the real HTTP calls (expects backend endpoints).
- `src/lib/api/index.ts` exports `api` based on `NEXT_PUBLIC_MAZLE_API_MODE` (defaults to mock in dev).

So you can build UI now and later flip to real endpoints with minimal changes.

### 2.3 Time pause is centralized and easy to change later
Timer pause is now controlled by:
- `gameControls.setPaused(true/false)` (new method)
- The React pages compute `shouldPause` from:
  - route overlays open
  - any modal/menu open

This matches the spec: “time pauses on modal” but is intentionally a single switch so changing policy later is easy.

---

## 3) Deep Dive: Architecture + Key Files

### 3.1 Route-backed overlays (Next.js App Router)
**Goal:** Use real URLs (shareable / deep-linkable) but render as overlays when navigated from the game.

How it works:
- Root layout defines a parallel route slot named `@overlay` and renders `{overlay}` under `{children}`.
- Intercepting routes `(.)leaderboard`, `(.)archive`, `(.)account` render into that slot when you navigate to them from `/`.
- If you open `/leaderboard` directly, you get the full-page route `src/app/leaderboard/page.tsx`.

Files:
- `src/app/layout.tsx` (renders `overlay`)
- `src/app/@overlay/default.tsx` (empty default)
- `src/app/@overlay/(.)leaderboard/page.tsx`
- `src/app/@overlay/(.)archive/page.tsx`
- `src/app/@overlay/(.)account/page.tsx`
- `src/app/@overlay/play/[date]/page.tsx` (forces overlays off on `/play/[date]`)
- `src/app/leaderboard/page.tsx`, `src/app/archive/page.tsx`, `src/app/account/page.tsx`

The shared wrapper is:
- `src/components/OverlayShell.tsx`
  - `variant="overlay"` uses `router.back()` to close (Esc also closes)
  - `variant="page"` uses `router.push('/')` on close

### 3.2 API adapter layer (why `src/lib/api` not `src/app/api`)
`src/app/api/*` is for **server route handlers** (runs on Vercel/Node). You generally should not import server route files into client components.

Instead, `src/lib/api/*` is a client-only adapter that:
- Keeps UI code clean (`api.leaderboardTop(...)`, `api.me()`, etc.)
- Lets you switch mock ↔ real with one env var
- Avoids mixing concerns (server handler code vs client fetch code)

Key files:
- `src/lib/api/types.ts` (frontend-facing TypeScript contracts)
- `src/lib/api/http.ts` (shared JSON fetch + error handling)
- `src/lib/api/mock.ts` (localStorage-backed mock backend)
- `src/lib/api/real.ts` (fetches `/api/*`)
- `src/lib/api/mode.ts` (env-based mode selection)

### 3.3 Pause system (timer + input)
Changes made:
- Added `GameControls.setPaused(paused)` in `src/game/PhaserGame.tsx`
- Implemented `GameScene.setPaused(paused)` in `src/game/GameScene.ts`
  - Stops accepting input when paused
  - Pauses Phaser timers + tweens
  - Adjusts `startTime` when resuming so elapsed time doesn’t “jump”
- `GameState` now includes `isPaused` and `GameUI` stops its interval when paused

Where pause is triggered:
- Daily page: `src/app/page.tsx` computes `shouldPause` and calls `controls.setPaused(shouldPause)`
- Archive play page: `src/app/play/[date]/play-client.tsx` does the same

### 3.4 Global swipe moves refactor
The “swipe anywhere” logic from the daily page is extracted so it can be reused:
- `src/game/useGlobalSwipeMoves.ts`

Used by:
- `src/app/page.tsx`
- `src/app/play/[date]/play-client.tsx`

### 3.5 Archive calendar + paywall + checkout
Main component:
- `src/components/ArchiveView.tsx`

Responsibilities:
- Calendar month grid + navigation
- Calls `api.archiveDays(from,to)` for visible month (clamped to launch → yesterday)
- Locked day click → pushes `/archive?paywall=1&d=…`
- Paywall:
  - Fetches price via `api.archiveOffer()`
  - If guest: prompts sign-in first
  - If signed in: calls `api.createCheckout(...)` and redirects to returned URL
- Post-checkout:
  - On `/archive?checkout=success…`, polls `api.me()` for up to 15s
  - When `archiveAccess=true`, auto-opens `/play/[d]` (hard-navigates when shown as an overlay so the modal state can’t “stick”)

Date helpers:
- `src/lib/date.ts` (UTC-based month grid math)
- `src/game/puzzleGenerator.ts` exports `LAUNCH_DATE_NY` and NY date formatting helpers

### 3.6 Archive play page
Route:
- `src/app/play/[date]/page.tsx`
- `src/app/play/[date]/play-client.tsx`

Responsibilities:
- Fetch puzzle via `api.archivePuzzle(date)`
  - If locked: expects `403 ENTITLEMENT_REQUIRED` to show “Unlock” CTA
- Runs the Phaser game with the same base layout/styling as daily
- Does **not** save daily stats/streaks (archive mode separation)

### 3.7 Account + prefs
Component:
- `src/components/AccountView.tsx`

Responsibilities:
- Load `api.me()` (guest vs user)
- Sign-in:
  - Mock: `api.claim({})`
  - Real: redirect to `/api/auth/signin/google` or `/api/auth/signin/apple`
- Sign-out:
  - Mock: clears `mazle_mock_me_v1` from localStorage
  - Real: redirect to `/api/auth/signout`
- Preferences:
  - LocalStorage via `src/lib/prefs.ts`
  - Toggle: `leaderboardAutoSubmitWins`

Auto-submit integration:
- Daily win triggers submit if prefs enabled: `src/app/page.tsx`

### 3.8 Leaderboard
Component:
- `src/components/LeaderboardView.tsx`

Responsibilities:
- Loads:
  - `api.leaderboardTop(date, 50)`
  - `api.leaderboardMe(date)`
  - If rank exists: `api.leaderboardAround(date, rank, 5)`
- Manual submit uses local daily result (`localStorage`) to send:
  - `timeMs`
  - `attemptsUsed` (computed as failedAttempts + 1 for wins)
- Renders top/me/around panels

### 3.9 Ads placeholder
Component:
- `src/components/AdSlot.tsx`

Behavior:
- Shows only if `NEXT_PUBLIC_ADS_ENABLED=1|true` **and** `me.entitlements.adsRemoved === false`
- Intended to be swapped later for real ad network integration without changing UI layout

---

## 4) Switching From Mock → Real Backend

When the backend endpoints exist:
1) Set `NEXT_PUBLIC_MAZLE_API_MODE=real` and restart via `make up`
2) Implement the endpoints described in:
   - `docs/backend-handoff.md`
   - `docs/frontend-ux-spec.md`

No UI refactors should be required; the UI already calls `api.*`.

---

## 5) Known Gaps / Next Things You’ll Probably Want

UI polish / flow improvements (frontend-owned):
- Add a CTA inside the win/share flow to open leaderboard (right now it’s in the “…” menu).
- Add lightweight toasts (success/failure) instead of the current simple banner in archive.
- Visual polish of archive tiles (played state, hover states, month jump).
- Better “Account” copy + rename-on-claim UI (spec supports NAME_TAKEN flow; UI surface not built yet).

Backend-owned (expected next):
- Implement `/api/me`, `/api/guest`, `/api/claim`, `/api/stripe/*`, `/api/leaderboard/*`, `/api/archive/*`
- Auth.js handlers and Stripe webhook.

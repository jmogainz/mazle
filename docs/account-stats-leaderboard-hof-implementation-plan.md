# Mazle: Account Stats + Daily Leaderboard + Hall of Fame (Implementation Plan)

Goal: ship account-based identity + stats (played/win streaks, avg solve time) and an account-only daily leaderboard with a podium + a public Hall of Fame (historical podiums only).

UI note: keep new UI elements consistent with the current overhaul (same theme/colors/modals/buttons/fonts).

---

## 0) Locked Product Decisions

- **Daily game** remains guest-first; guests can play without an account.
- **Leaderboard**
  - Viewable by anyone.
  - **Submitting is account-only.**
  - Full leaderboard list is **Today only** (New York date).
  - Shows a **podium (top 3)** for today; podium includes character/skin.
- **Hall of Fame**
  - Public/read-only.
  - Shows **historical podiums only** (top 3 per day).
- **Stats**
  - Account stats are **daily-only**. Archive plays do not count.
  - Track **played streak** (consecutive NY days played) and **win streak** (consecutive NY days won).
  - Avg solve time includes **wins only**.
  - For a given user+date, only the **first recorded result counts**.
  - Manual leaderboard submit later is allowed, but it must submit that same recorded run/result.
- **Guest → account import**
  - Guests retain “all-time local” stats.
  - On sign-in, import all locally available guest stats into the account.
- **Settings**
  - Theme + auto-submit sync to account when signed in; per-device when guest.
- **Date acceptance**
  - Stats recording accepts **today or yesterday** (NY date) for offline/backfill.
  - Leaderboard submission remains **today-only**.
- **Migrations**
  - Continue editing `migrations/000001_initial.sql` for these changes (assumed not yet deployed).

---

## 1) Database Schema (edit `migrations/000001_initial.sql`)

### 1.1 User profile (cosmetics)

- [ ] Add `user_profiles`:
  - `user_id uuid PRIMARY KEY references users(id) on delete cascade`
  - `character_id text not null default 'default'`
  - `skin_id text not null default 'default'`
  - `updated_at timestamptz not null default now()`

### 1.2 Account settings (synced)

- [ ] Add `user_settings`:
  - `user_id uuid PRIMARY KEY references users(id) on delete cascade`
  - `theme text not null default 'system'` (or `light|dark|system`)
  - `leaderboard_auto_submit boolean not null default true`
  - `updated_at timestamptz not null default now()`

### 1.3 Daily results (account stats truth)

- [ ] Add `daily_results` (daily-only):
  - `date date not null`
  - `user_id uuid not null references users(id) on delete cascade`
  - `played_at timestamptz not null default now()`
  - `completed boolean not null`
  - `time_ms integer` (nullable; wins only)
  - `attempts_used integer` (nullable; wins only)
  - Unique `(user_id, date)`
- [ ] Add index `(user_id, date desc)`

### 1.4 Hall of Fame podium snapshot (top 3 only)

- [ ] Add `leaderboard_podium`:
  - `date date not null`
  - `rank integer not null check (rank in (1,2,3))`
  - `user_id uuid not null references users(id) on delete cascade`
  - `time_ms integer not null`
  - `attempts_used integer not null`
  - `display_name_at_time text not null`
  - `character_id_at_time text not null`
  - `skin_id_at_time text not null`
  - Unique `(date, rank)`
  - Optional unique `(date, user_id)`

### 1.5 Keep existing tables

- [ ] Keep `leaderboard_submissions` for now (audit/debug/future badges).

**Verify**
- [ ] Local migrations apply and `/api/me` no longer errors with missing schema/version tables.

---

## 2) API Changes (server)

### 2.1 `/api/me` should return account data when signed in

- [ ] Extend response for `mode='user'`:
  - `profile: { characterId, skinId }`
  - `settings: { theme, leaderboardAutoSubmit }`
  - `stats: { playedStreak, winStreak, totalPlayed, totalWins, avgSolveTimeMs }`
- [ ] For guests, return existing fields and omit account-only details (or return defaults with `synced=false`).

### 2.2 Record daily result (account-only)

- [ ] Add `POST /api/results/record` (user-only):
  - Accept `{ date, completed, timeMs?, attemptsUsed? }`
  - Validate NY date string; accept only today or yesterday
  - Enforce “first result only”: if row exists for user+date, return existing
  - Store losses too (`completed=false`, `time_ms` null)

### 2.3 Import guest local history after sign-in

- [ ] Add `POST /api/results/import` (user-only):
  - Accept list of compact daily summaries from local storage
  - Validate shape, dates, and limits
  - Upsert into `daily_results` but do not overwrite existing user+date rows (first wins)

### 2.4 Leaderboard submission becomes account-only and uses recorded run

- [ ] Update `POST /api/leaderboard/submit`:
  - Reject guests (401/403)
  - Today-only
  - Do not trust request body time/attempts; submit exactly what’s stored in `daily_results` for today
  - Keep writing to Redis zset for ranking + optional `leaderboard_submissions` audit

### 2.5 Hall of Fame read endpoints

- [ ] Add `GET /api/hall-of-fame/podium?date=YYYY-MM-DD` (public):
  - Reads `leaderboard_podium` for the requested date (top 3)

### 2.6 Podium snapshot job

- [ ] Add `POST /api/cron/podium-snapshot?date=YYYY-MM-DD` (CRON_SECRET-protected):
  - Reads Redis `lb:{date}` top 3
  - Joins `display_name` + `user_profiles` cosmetics
  - Writes `leaderboard_podium` rows (idempotent)

**Verify**
- [ ] Guest can view leaderboard/hall of fame but cannot submit.
- [ ] Signed-in daily completion creates a `daily_results` row (win or loss).
- [ ] Manual submit later submits exactly the recorded win.
- [ ] Snapshot produces historical podium for hall of fame.

---

## 3) Frontend Changes (client) — keep existing look/feel

### 3.1 Local guest history retention (all-time, compact)

- [ ] Introduce a compact stored history format (avoid persisting path arrays for every day).
- [ ] Migrate existing `mazle_stats` data to the compact format.
- [ ] Retain “all-time” (or very high cap) for compact records.
- [ ] Keep detailed per-attempt paths only for “today/in-progress” state, not long-term history.

### 3.2 Post-game flows

- [ ] On completion:
  - If signed in: call `/api/results/record` (win or loss).
  - If win and autosubmit is enabled: call `/api/leaderboard/submit`.
  - If guest: show CTA to create account to join leaderboard/save stats.
- [ ] Allow manual submit later (signed in), but it submits the recorded run.

### 3.3 Account screen

- [ ] Show character/skin + display name (editable when signed in).
- [ ] Show stats (played streak, win streak, totals, avg solve time).
- [ ] Settings:
  - theme toggle (account-synced when signed in; local when guest)
  - autosubmit toggle (account-synced when signed in; local when guest)
  - subscription tier/entitlements
- [ ] After sign-in, trigger one-time import of guest local history.

### 3.4 Leaderboard screen

- [ ] Today leaderboard list remains today-only.
- [ ] Add podium block with character/skin.
- [ ] Guests can view; only signed-in users can submit.

### 3.5 Hall of Fame screen

- [ ] Add menu entry “Hall of Fame”.
- [ ] Show date navigation and podium-only results.

**Verify**
- [ ] Guest → sees CTA and can browse leaderboard/hall of fame.
- [ ] User → sees stats/settings, can submit to leaderboard, sees podium cosmetics.

---

## 4) Local Dev vs Prod Strategy

- [ ] No code branching: only env values differ by BWS project.
- [ ] `mazle-dev` uses:
  - local Postgres (docker) for `DB_URL`
  - local `redis-rest` for both KV and leaderboard Redis REST
- [ ] staging/prod use managed services via their BWS projects.

---

## 5) End-to-End Checklist (Manual)

- [ ] Guest plays daily → local stats update; CTA to create account appears.
- [ ] Sign in → guest history import runs; account stats match imported history.
- [ ] Signed-in win → records `daily_results`; autosubmit submits to leaderboard.
- [ ] Manual submit later → submits the same recorded run; no duplicate.
- [ ] Today leaderboard shows full list + podium with cosmetics.
- [ ] Hall of Fame shows historical podium from Postgres snapshots only.


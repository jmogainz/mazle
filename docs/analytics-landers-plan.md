# Analytics: Unique Landers (View -> Start)

## Goal
Add a metric that counts **unique people who land on mazle.io but never start a game** so we can measure landing traffic vs engagement.

## Definitions
- **Unique lander**: a unique `player_id` that loads the site on a given date (UTC), recorded via `viewed_at`.
- **Starter**: a `player_id` with `started_at` set that date.
- **Non-starter**: `viewed_at` set but `started_at` is null for the same date.
- **Conversion**: starters / unique landers.

## Data Model
- Add `viewed_at` to `analytics_daily_plays`.
- Do **not** add raw view counts (user asked for unique only).

## Backend
- New migration: `000006_add_viewed_at_to_analytics_daily_plays.sql`.
- Add `/api/analytics/view` to upsert `(date, player_id, user_id, viewed_at)`.
- Ensure `viewed_at` is set only once per day per player.
- Backfill landers implicitly by also setting `viewed_at` on start/finish/share upserts.

## Client
- Fire `/api/analytics/view` on initial page load (once per day per player).
- Use same `player_id`/`user_id` logic as starts.

## Admin Analytics
- Add daily and range totals:
  - `landers` (unique viewers)
  - `nonStarters` (landers - starters)
  - `viewToStartRate` (starters / landers)
- Add table column(s) and a chart metric option.

## Edge Cases
- Missing JS / ad blockers: views may be undercounted (acceptable).
- Multiple refreshes: deduped by `(player_id, date)`.
- Guests and users both counted; if a user logs in later, `user_id` should be backfilled via upsert.

## Verification (Dev)
1. Load the site once; confirm row has `viewed_at`.
2. Start a game; confirm `started_at` set for same row.
3. Hit `/api/admin/analytics?range=7` and verify landers/non-starters/ratio.
4. Check that daily table and chart match expected counts.

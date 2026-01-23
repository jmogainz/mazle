# UI Dev Walkthrough (ENV=dev)

This work is **dev-only UI/data scaffolding** to make it easy to test flows locally without touching production data or changing DB schemas.

## Start

Run the app in dev mode as usual (recommended path):

```bash
export UNIQUE_RUNNER_ID=$(whoami)
make up ENV=dev
```

## UI Dev Tools modal (`UIUIUIUI`)

On the home screen, type `UIUIUIUI` (case-insensitive). This opens **UI Dev Tools**.

Use it for:

- **API → Data source**
  - `Mock` (default in `ENV=dev`): enables rich fake data for UI testing:
    - **Leaderboard:** 80 entries for *today*.
    - **Hall of Fame:** podium snapshot for *any* past date (you appear in a random podium position).
    - **Archive:** every past date loads a dummy playable maze.
  - `Real`: switches back to the real backend (page reload).

- **Identity → Mode**
  - Mock-only **Guest ↔ Account** toggle (UI/state only; not real auth).

- **Today → Result**
  - Force today into `Win`, `Loss`, or `Clear` to quickly see postgame/share/leaderboard UI states.

- **Today → Submit**
  - Submits today’s win to the leaderboard (requires **Mock + Account + Win**).

- **Navigate**
  - Quick open: Stats, Account, Hall of Fame, Archive.

## Stats modal (20 days + 5 streak)

In `ENV=dev`, the first time local stats are read, the app seeds a fake history so you immediately see:

- **At least 20 days** of local stats history
- **Current streak = 5**

Open **Stats** (from header or UI Dev Tools) to verify.

## Archive (Calendar + List view)

Open **Archive** (from menu or UI Dev Tools).

- Toggle **Calendar/List** using the icon toggle in the month header.
- **List view** shows each day’s state based on your local stats:
  - `Solved` + time
  - `DNF`
  - `Unplayed`
- Use the **Today** button to return to the daily maze.

### Playing an archived day

Click any past date to open `/play/YYYY-MM-DD`.

On the archive play page:

- The maze renders with an **ARCHIVE** badge and slightly darker tiles (visual distinction).
- Use **Podium** to open Hall of Fame for that specific date.
- Archive plays **do not submit** to the leaderboard.

## Skins (2 unlocked + 2 locked)

Open **Account** (from menu or UI Dev Tools).

In `ENV=dev`:

- A **Skins** picker appears.
- Two skins are selectable; two are visible but **locked**.
- In **Mock + Account** mode, selecting a skin updates your avatar and the “you” entry on Hall of Fame podiums.

## Notes

- No DB schemas were changed.
- No deploy/push steps are included.


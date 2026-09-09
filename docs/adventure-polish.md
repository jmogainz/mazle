# Adventure mobile polish

## Direction

Keep Mazle's snowy world, character, step movement, ice slides, and one-way ledges.
The campaign stays at 50 levels. Make each swipe legible and satisfying, retries
quick, and progress through the trail rewarding. Web and native iOS should share
visual identity, content, and interaction intent while respecting each platform.

## Decisions — 2026-09-07

- Polish the existing five-chapter campaign before adding mechanics or levels.
- Retain scalable vector/code artwork for crisp mazes and controls. Add raster
  illustration only where it improves the scene; do not replace assets wholesale.
- Use short, gentle effects for movement and rewards, with independent sound and
  haptic preferences. Respect silent mode, background audio, and Reduce Motion.
- Show mechanic guidance at its introduction and make it available again. Avoid
  blocking experienced players with long tutorials.
- Keep result actions immediately available during celebrations. Cancel visual,
  sound, and haptic sequences when their screen disappears.
- Reward solving and chapter progress first. Do not add currencies, boosters,
  streak penalties, or monetization pressure during this polish phase.
- Create logical local commits after review and focused verification. Existing
  unrelated native Daily-statistics edits remain outside these commits.

## Implemented polish

- Native campaign scenery and chapter colors now follow the Frostpeak identity;
  both platforms use the catalog's normalized trail coordinates. Native nodes have
  non-overlapping touch areas, clear current/completed states, and star progress.
- Native movement and input share one slide duration, including long ice paths.
  Logical moves persist before animation; interrupted terminal attempts settle on
  resume, retry resets the rendered character, and failed attempts settle once.
- Short original local audio cues and independent sound/haptic preferences are
  implemented on iOS. Sound follows silent mode and stops on backgrounding or
  interruption. Actual sound balance and tactile quality still need device QA.
- Native celebrations, button feedback, move counters, and map transitions honor
  Reduce Motion. Win overlays report the current run while saved progress retains
  personal bests.
- Web Adventure has a dedicated moves/stars scoreboard; Daily's lives display and
  shared input behavior are unchanged. Accessible movement remains available.
- The native app icon is exported from the existing Mazle vector logo, not new art.

## Safe native QA

Debug launch arguments `-Adventure -MazleOfflinePreview` open the local campaign
without production APIs, Keychain account access, or StoreKit operations. Add
`-MazleResetAdventurePreview` to reset only the preview progress suite. These
offline switches do not change release configuration.

The separate `MazleUI` scheme exercises real swipes, map/settings/preview,
win/replay/next-level, protected failure/retry, and iPad rotation. Always use a
dedicated Mazle simulator and task-local DerivedData. `ios/project.yml` is the
source for generated Xcode project/scheme changes.

## Verification gates

1. Existing 50-level catalog and Daily mechanics remain unchanged and validated.
2. Web tests cover real swipes, keyboard/accessibility input, wins, move-limit
   failure, retry, persistence, responsive layouts, and account isolation.
3. Native tests cover movement/animation completion, retry, progress/energy, and
   reduced-motion behavior; simulator evidence covers map, play, and results.
4. Screen review covers compact iPhone, larger iPhone, iPad, and responsive web.
5. No production services are contacted during local QA. Test processes and bulky
   temporary outputs are cleaned up after evidence is recorded.

Human device QA remains necessary for tactile quality, sound balance, and whether
the difficulty curve is fun. Automated checks cannot establish those judgments.

# Tasks

## 1. Navigation bugs (done with this change's proposal)

- [x] 1.1 Red: `live.test.ts` covers `stepCard` (clamp, empty strip) and `wheelStep` (threshold, horizontal-dominant, cooldown); `chat.test.ts` covers `composerLock`; `map.test.ts` covers `mapEdgeSide`. Verify: `npm test` fails on the missing names.
- [x] 1.2 Green: the four pure seams in `live.ts`, `chat.ts`, `visual/map.ts`. Verify: `npm test` 113/113.
- [x] 1.3 Shell: `camera(animate)` with a `ResizeObserver` on `#canvas`; `overflow: clip` + `min-width: 0`; `focusin` moves the camera; prev/next buttons, clickable named rail, wheel stepping, home/end; `setActive` only notifies the chat on a real move; `openReplyRef` re-focuses its thread; `currentTarget` guards the empty strip. Verify: rebuild (`npm run build`, `go build`), `go test ./...` green.
- [x] 1.4 Browser check on the rebuilt binary over the four plates (sealed, conversation, missing repo, empty-open): no page errors; 0 px off centre during chat collapse and legend hover; Tab keeps the active card on screen; rail click, wheel, home/end, reply-ref focus all behave. Verify: the scratch Playwright driver's log (re-runnable: serve a plate on a fixed port and run `drive.js`, `timing.js`, `live.js`).

## 2. Design variants and the decision

- [x] 2.1 `docs/design/revamp/`: shared fixture `plate.js` (the bug-hunt plate with real code lines), `revamp.css` (the shipped tokens), `common.js` (visual interactions, drawer, chat), the three variants `v1-filmstrip.html`, `v2-scroll.html`, `v3-stage.html`, and the hub `index.html` with the findings and the comparison. Verify: each page loads with no console errors, steps with keys, opens a chip, flips the dial, in both themes.
- [x] 2.2 Decide the direction: A · Filmstrip with a fullscreen visual mode, recorded in design.md; variant A carries the mode so it can be tried. Verify: design.md names the direction; `v1-filmstrip.html` enters and leaves fullscreen with `f`, steps inside it, opens a chip as a sheet, hands the visual back on `esc`.

## 3. Adopt Filmstrip in the shipped reader (test-first per seam)

- [x] 3.1 Red → green: the help becomes a popover (`?` key and button) and the legend column goes; the dial moves to the top bar. Verify: `#legend` no longer exists; `npm test` green; a browser check shows no canvas resize on `?`.
- [x] 3.2 Red → green: the plate description collapses to one line with a `more` toggle; the dial no longer changes the canvas height. Verify: canvas height identical at both dial levels (browser check).
- [x] 3.3 Red → green: the rail becomes numbered segments carrying message badges (pure seam: `badgeCounts` per card already exists; the rail reads it). Verify: `chat.test.ts` scenario, badge visible on a card with a thread.
- [x] 3.4 Red → green: the camera becomes native scroll snapping on `#canvas` (cards at 84 % width, `scroll-snap-align: center`); neighbours peek, dimmed and clickable; an `IntersectionObserver` sets `active`; `stepCard` stays for keys and buttons, `wheelStep` is retired (the native scroll owns the swipe); `#strip` carries no transform; a `settleCamera` on `scrollend` reconciles the camera and the active card. Verify: the browser checks from 1.4 pass unchanged with `scrollLeft` as the camera.
- [x] 3.5 Red → green: fullscreen mode. Pure seam: `fsStage(active, cards)` (the caption, count, button states); shell: `f` / ⤢ / double-click makes the active card itself `position: fixed` over the window (class `fs`, nothing moved or copied — see design.md), stepping hands the class to the next card, chips open `#drawer` inside the fixed card as a sheet, `esc`, `f` or ✕ hand it back, `fullscreenchange` leaving the browser's fullscreen leaves ours too. Verify: a unit test on the seam; browser check: enter, step twice, open a chip, leave, and the sequence step count on the card is what it was on the stage.
- [x] 3.6 Red → green: the visual slot gives a wide SVG its intrinsic height (no letterboxing) — `.visual-body` sizing. Verify: a 753×302 map fills the slot width at 1440×900; title and description stay visible without scrolling.
- [x] 3.7 Update `openspec/specs/reader/ui-shell` via the delta in this change: fullscreen as a requirement under "One canvas, a camera" (the visual fills the window, stepping continues, state survives). Verify: `openspec validate reader-ux-revamp`.

## 4. Site and docs

- [x] 4.1 `docs/guide/reading.html` (the guide's reader page; `docs/guide.html` only redirects there): the keys and the new ways to step (buttons, rail, swipe, home/end), the help popover, the empty-plate message. Verify: the guide's reader section matches the shipped legend text.
- [x] 4.2 `docs/design/mockups.html` §03: replace the plate mockup with the adopted direction (or link the hub) so the mockups and the spec agree again. Verify: the page renders; the hub link resolves.
- [x] 4.3 `docs/roadmap.html`: "UI improvement & design adherence" is already `class="it done"` (marked by the earlier UI change); nothing to flip at archive time. Verify: `class="it done"` on that item.

## Workflow follow-up

- Archive with `/opsx:archive` once §3 and §4 are done; the archive syncs the
  `reader/ui-shell` delta into the main spec.

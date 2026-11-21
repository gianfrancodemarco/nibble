# Design

## Context

The shell (`reader/src/app.ts`) positions cards with a JS-computed
`translateX` on `#strip`, recomputed on navigation and, until this change,
on `transitionend` of the chat and the legend. Pure decisions live in
`live.ts`, `chat.ts` and `visual/host.ts` and are the only part under unit
test; the DOM wiring is exercised by hand, which is how the bugs survived.
`cli/internal/cmd/ui/` embeds the built `app.js`, `index.html` and
`style.css`. The design mockups (`docs/design/mockups.html` §03) show a strip
with neighbours in sight, the dial in the legend and a send button in the
title bar; the spec (`reader/ui-shell`) says one card in view at a time.
The two already disagree, which is part of why the revamp needs a decision.

See proposal.md for the bug list and the three directions.

## Goals / Non-Goals

**Goals:**
- Every way of moving between nibbles ends with the active card centred and
  the camera state consistent, under keyboard, pointer, trackpad and
  relayout.
- The visual is the dominant element of a card at a laptop window.
- One layout direction, decided with the live variants, not in prose.

**Non-Goals:**
- A browser-driven test suite in the repo (Playwright would be a new
  dependency; the driver used here stays a scratch script, described in
  tasks so it can be re-run).
- Touch-first or phone layouts.

## Decisions

**Camera relayout without the slide.** A `ResizeObserver` on `#canvas`
calls `camera(false)`, which commits the transform with the strip's
transition off (a `jump` class, one forced reflow). Alternatives: keep
`transitionend` listeners (fires once, after the card has already drifted
for the whole width transition — the lurch); make the panels overlays so the
canvas never resizes (variant C does this; too large a change for a fix).

**The canvas clips.** `overflow: clip` instead of `hidden`: a clipped box is
not a scroll container, so focus and `scrollIntoView` cannot move it. Needs
an explicit `min-width: 0` on the flex item, since a clipped box no longer
shrinks below its content. A `focusin` listener on the strip moves the
camera to the card that received focus, so Tab navigation stays usable.

**Stepping is one pure function.** `stepCard(active, delta, count)` clamps
and handles the empty strip, tested in `live.test.ts`; buttons, rail and
keys all go through `setActive`. (The bug-fix round also had
`wheelStep`, turning a trackpad gesture into one step; the Filmstrip
retired it — the strip scrolls natively and the snap points stop a swipe
one card on, so the shell owns no wheel code.)

**An empty plate locks the composer.** `composerLock(cards, turn)` wraps
`turnLabel`: with no card there is nothing to point at, whatever the turn.
`currentTarget` returns `""` for that case rather than reading `.n` of a
nibble that is not there.

**A twin edge bends.** `mapEdgeSide(edges, i)` returns -1/0/1; the renderer
bows the Bézier control points by 18 px on that side and moves the label
with it. Layout (positions) is untouched, so the dial and selection tests
hold.

**Variants as pages, not pictures.** The three directions are standalone
pages under `docs/design/revamp/` sharing one fixture (`plate.js`, generated
from the plate served during the bug hunt, with real code lines) and one
stylesheet of the shipped tokens. Each implements its navigation for real so
the choice is made by using them. The hub (`index.html`) frames them with
the findings and a comparison.

**The adopted direction: A · Filmstrip, plus a fullscreen mode for the
visual.** Decided 2026-11-19 from the live variants: the strip stays, the
camera becomes native scroll snapping (neighbours peek and are clickable),
and the answer to "more room for the visual" is a fullscreen mode rather
than a different card layout: `f`, the ⤢ button on the visual, or a
double-click lends the active card's visual to a window-filling stage with
the claim as a caption; ← → keep stepping and swap the picture, chips open
the drawer as a sheet over the stage, `esc` hands the visual back. The
visual element itself moves (not a copy), so sequence step, timeline cursor
and selection survive both ways. B's table of contents stays an option for
later; C is retired.

**Fullscreen is the card itself, fixed.** Implementing it in the shipped
reader (2026-11-19): instead of lending the visual to a separate stage
element as the prototype did, the active card gets a class that makes it
`position: fixed` over the window, its body `display: contents` so the
visual, the drawer and the lateral bar restack as a column (the bar becomes
the caption). Nothing is moved or copied, so the host wiring on `#strip`
(chips, selection, prose links, badges, the drawer mounting into the active
card) works untouched, and state survives trivially. Stepping moves the
class to the next card; the canvas's own scroll catches up when the mode
ends (`camera(false)`). The stage's own controls — count, ‹ ›, ✕ — are one
fixed element (`#fs-ctl`) shown with `body.fs`. The intersection watcher
ignores the strip while the mode is on, since the fixed card leaves the
flow and the strip reflows under it.

**The camera is the scroll position, and it settles.** `camera()` scrolls
`#canvas` to centre the card (smooth for a navigation, instant for a
relayout), snap points hold it, and an `IntersectionObserver` makes
whichever card is mostly in view the active one — ignoring the cards a
navigation passes on its way (`scrollTarget`). A smooth navigation can be
cut short (the browser's own focus scroll lands on top of it when the
reader tabs into a neighbour), so `settleCamera` runs on `scrollend` and on
a fallback timer: keyboard focus in the active card means the reader meant
that card, so it is recentred; otherwise the card nearest the centre is
where the reader scrolled to, and it becomes active. The gutters either
side of the strip are flex items, not padding: a card is 84 % of the
strip's content box, so only content on both sides lets the first and the
last card sit centred (trailing padding would not count as scrollable
overflow).

**The plate description folds.** One line with ellipsis and a `more`
toggle (`foldLabel` decides whether the toggle shows, from the measured
overflow), so turning the dial — which swaps the text — never changes the
canvas height under the camera; the help is a popover over the canvas for
the same reason.

## Risks / Trade-offs

- [`overflow: clip` support] → Chrome 90+, Safari 16+, Firefox 81+; the
  reader is a local tool on a developer machine, acceptable. A `scroll`
  listener resetting `scrollLeft` would be the fallback.
- [Wheel stepping fights a horizontal scroll inside a visual] → only
  horizontal-dominant gestures over the threshold step, and the handler is
  on the canvas; a visual that needs horizontal scrolling should stop
  propagation (none does today).
- [Direction C changes the spec's "camera slide" wording] → the delta spec
  words the requirement as "moves the view" so A, B or C satisfy it.
- [The fixture in `docs/design/revamp/plate.js` drifts from the real
  renderers] → it is a design artefact, not a golden file; the OpenSpec
  archive step keeps the hub as the record of the decision.

## Open Questions

- Keep the hover-expanding legend at all once the help is a popover?
  (Deferrable: the fix already stops it moving the card.)

# Proposal

## Why

Navigating a plate is the reader's most basic act, and it breaks in ordinary
use: an open plate with no nibble yet crashes the chat on every render,
tabbing to a chip scrolls the clipped canvas out from under the camera,
collapsing the chat or merely hovering the legend lurches the active card
hundreds of pixels sideways before it slides back, and without a keyboard
there is no way to move at all. Beyond the bugs, the reader does not deliver
the mockups' promise: the visual is letterboxed into a tall, narrow slot
beside the text, the legend is a column of bare keycaps that resizes the
canvas on hover, and the plate's description is a full-width band. This is
the "UI improvement & design adherence" item on the v0.2 roadmap.

## What Changes

- **Navigation bugs fixed** (landed in the working tree with this change,
  test-first where the logic is pure):
  - an open plate with no cards keeps the composer locked and explained
    instead of throwing; the ghost card is centred;
  - the canvas clips instead of scrolling, and keyboard focus landing in
    another card moves the camera there;
  - a relayout (chat column, legend, window) recentres the active card on
    every frame of the width change, without the slide;
  - stepping gains prev/next buttons on the canvas edges, a clickable,
    named rail, trackpad swipes, and home/end;
  - re-activating the card already in view no longer drops the focused
    thread; a reply's ref re-focuses its thread;
  - a map draws a twin pair of opposite edges bent apart, labels on their
    own sides.
- **One of three layout directions adopted** for the reader shell, chosen
  from the live variants in `docs/design/revamp/`:
  - **A · Filmstrip** — the strip, with the camera handed to native scroll
    snapping; neighbours peek and are clickable; help as a popover.
  - **B · Reading column** — the plate as a vertically scrolled document
    with a table of contents that is also the progress and message map.
  - **C · Stage** — one visual fills the window under a caption; a chapter
    bar is the only navigation; code and chat are sheets over the stage.
  The decision is recorded in design.md once made; the tasks below carry
  the parts common to all three and the adopted direction's own.
- **Design adherence, whichever direction**: the visual gets the room the
  mockups give it; the legend stops resizing the canvas; the plate
  description collapses to a line with a `more`; the dial moves to the top
  bar; the rail carries message badges.

Out of scope: any change to the protocol, the Go server or its API; new
visual kinds; the step-by-step sequence mode and chapter flow (v1 roadmap);
the Tauri pill; the streaming ghost's look; mobile layouts below 760 px
beyond not breaking.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `reader/ui-shell`: the "One canvas, a camera" requirement gains the
  stepping affordances (buttons, rail, swipe, home/end), the relayout rule
  (a resize never moves the card off centre, only navigation animates) and
  the focus rule (the canvas never scrolls; focus moves the camera); the
  composer requirement gains the empty-plate state; the camera wording is
  loosened so that a direction other than a horizontal strip can satisfy it.

## Impact

- `reader/src/app.ts`, `reader/src/live.ts`, `reader/src/chat.ts`,
  `reader/src/visual/map.ts`, `cli/internal/cmd/ui/{index.html,style.css}`
  — the fixes (done) and the adopted layout (to do).
- `reader/test/{live,chat,map}.test.ts` — new pure-seam tests (done).
- `docs/design/revamp/` — the three variants and the comparison hub (done);
  `docs/design/mockups.html` and `docs/guide.html` follow the adopted
  direction.
- `openspec/specs/reader/ui-shell/spec.md` — delta below.

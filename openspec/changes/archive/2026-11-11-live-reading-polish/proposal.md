# Proposal

## Why

Reading a plate while the agent is still writing it is the reader's signature
moment, and today it is the roughest one: every arriving nibble rebuilds the
whole strip, which snaps the code drawer shut, resets sequence/timeline/compare
step state, and can even paint stale data when two reloads race. The mockups
(section 08, "Streaming") promise the opposite — arrivals never steal your
reading, the count stays honest, and a pulse says the agent is still at work.
This is the "Live-reading polish" item on the v0.2 roadmap.

## What Changes

- **Arrivals append instead of rebuilding.** When a reload differs from the
  shown plate only by new cards at the end (new nibbles, or the ledger card at
  seal), the shell appends those cards and leaves everything else alone: the
  open drawer stays open, visual step state and selection survive, the camera
  does not move. Anything else (dial flip, review, changed existing nibbles)
  still rebuilds wholesale.
- **Arriving cards animate in** — including the first nibble landing in an
  empty strip and the ledger card at seal, which the current `knownCards > 0`
  guard skips. Honors `prefers-reduced-motion`.
- **Plate reloads are latest-wins.** Concurrent `loadPlate` calls (one per SSE
  event today) can resolve out of order and paint an older plate — the nibble
  count visibly goes backwards. A reload token makes only the newest response
  render.
- **Honest progress text, per the mockup.** While the plate is open the
  progress shows a pulsing dot and "N nibbles · still being written"; once
  sealed it reads "N of N · sealed". The rail reconciles segments in place
  instead of rebuilding its HTML, so a new segment grows in and the active
  segment's width transition actually runs.
- **The reader notices a dead server.** When the event stream drops and the
  plate can no longer be fetched, the existing "serve has exited" notice
  appears instead of the page silently going stale.

Out of scope: syntax highlighting (its own roadmap item), prose↔visual links,
review-loop refinement, any change to the Go server or its API (the SSE events
and `/api/plate` stay exactly as they are), and any protocol change.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `reader/ui-shell`: the "Follows a live plate" requirement grows teeth —
  arrivals must preserve reader state (drawer, selection, visual step state,
  camera), arriving cards animate in, reloads are latest-wins, and the
  open/sealed progress text follows the mockup (pulse + "still being written" /
  "N of N · sealed").

## Impact

- `reader/src/app.ts` — render split into full rebuild vs. append path, reload
  token, rail reconciliation, progress markup, SSE error probe.
- `reader/src/visual/host.ts` (or a sibling pure module in both tsconfig
  builds) — the new pure seams: appendability check, arrival range, progress
  label. Tested under the node harness like the existing dial/wiring logic.
- `reader/test/` — new tests for those seams.
- `cli/internal/cmd/ui/app.js`, `style.css`, `index.html` — rebuilt output,
  pulse/arrival CSS, progress element markup. CI drift check requires the
  rebuilt `app.js` to be committed.
- No Go changes; `cli/internal/cmd/http.go` is untouched.
- `docs/` — roadmap item and the streaming part of the guide, per the apply
  guidance.

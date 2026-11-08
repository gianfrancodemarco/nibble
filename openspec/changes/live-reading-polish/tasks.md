# Tasks

## 1. The pure seams (live.ts)

- [x] 1.1 Add `reader/test/live.test.ts` to the test tsconfig with failing
  tests for `progressLabel`: open → `{ text: "2 nibbles · still being
  written", live: true }` (singular "1 nibble" too), sealed → `{ text: "3 of
  3 · sealed", live: false }`. Verify `npm test` in `reader/` fails red.
- [x] 1.2 Create `reader/src/live.ts` with `progressLabel`, add it to both
  tsconfigs (before `app.ts` / the test files). Verify `npm test` passes.
- [x] 1.3 Red: tests for `arrivalPlan` using real nibble JSON shapes from an
  existing fixture plate (worked example: a 3-nibble open plate growing to 4,
  the same plate sealing with a ledger, a mid-stream rewrite of n2, an
  identical reload, and a shrinking reload). Expect `"append"` for growth and
  seal, `"rebuild"` for rewrite/shrink/review change, `"none"` for identical.
- [x] 1.4 Green: implement `arrivalPlan` (prefix check on per-nibble JSON
  strings + open/review/ledger flags). Verify `npm test` passes.
- [x] 1.5 Red then green: `latestWins()` token counter — an older token may
  not render after a newer one resolved. Verify `npm test` passes.

## 2. Wire the append path in app.ts

- [x] 2.1 Factor the per-card markup in `render()` into a helper used for one
  card, keep `render()` as the wholesale rebuild on top of it. Verify
  `npm run build` emits `app.js` and the Go e2e tests still pass
  (`go test ./...` in `cli/`).
- [x] 2.2 `loadPlate` keeps the previous plate shape, consults `arrivalPlan`
  and `latestWins`: append path builds only the new cards (nibbles and/or
  ledger card), runs their renderers, updates rail + progress, and never
  touches drawer/selection/popover/camera. Verify by `nibble serve` on a
  plate while appending `n3.json` by hand: the new card slides in, an open
  drawer stays open, a stepped sequence keeps its step.
- [x] 2.3 Replace the `knownCards > 0` animation guard with a `painted` flag
  so a first nibble into an empty strip animates; seal appends the ledger
  card through the same path. Verify by serving a plate dir with no nibbles,
  then adding n1.json and a done file.
- [x] 2.4 `rail()` reconciles `<i>` segments in place (add/remove/toggle
  classes, no innerHTML rewrite). Verify in the browser: the active segment's
  width transition runs when stepping, and a new segment appears on arrival
  without the others flashing.

## 3. Progress chrome and the dead-server notice

- [x] 3.1 `#progress` renders from `progressLabel` with the pulse marker;
  add `.pulse` keyframes to `style.css` with a `prefers-reduced-motion`
  override. Verify open plate shows the pulsing dot + "still being written",
  sealed shows "N of N · sealed".
- [x] 3.2 EventSource `error` handler probes `GET /api/plate` once (guarded,
  only when the stream is closed); a rejected probe shows the existing
  "serve has exited" flash, a successful one stays quiet. Verify by killing
  `nibble serve` with the tab open → notice appears; and that normal
  streaming shows none.

## 4. Integration

- [x] 4.1 Full suite: `npm test` + `npm run build` in `reader/`,
  `go test ./...` in `cli/`, committed `app.js` matches the build (CI drift
  check clean: `git status` shows the rebuilt file staged-able, no further
  diff after a second build).
- [x] 4.2 End-to-end streaming pass with `nibble new` + `nibble add` +
  `nibble done` against a real repo: cards arrive animated, count/progress
  honest throughout, seal brings the ledger card, review from the reader
  still locks the bar.

## 5. Docs

- [x] 5.1 Update the affected site pages in `docs/`: the streaming section of
  the guide (`docs/guide/receiving.html` or wherever streaming is described)
  to match the shipped behavior, and mark the roadmap item's state in
  `docs/roadmap.html` if the project marks items done at merge. Verify the
  pages render locally and say what the reader now does.

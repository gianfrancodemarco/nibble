# Design

## Context

See proposal.md — Why. The relevant mechanics today:

- `render()` in `reader/src/app.ts` rebuilds `#strip` via `innerHTML` on every
  reload and starts with `closeDrawer()`; the per-visual step state lives in
  the DOM the rebuild throws away.
- Every SSE event fires `void loadPlate()`; nothing serializes the fetches.
- The arrival animation keys off `knownCards > 0`, so a first card into an
  empty strip never animates, and `rail()` rebuilds `#rail`'s innerHTML, which
  kills the segments' CSS transitions.
- The node test build (`reader/test/tsconfig.json`) has no DOM and does not
  include `app.ts` — only `host.ts` and the renderers. Testable logic must be
  a pure function in a file both builds include.

## Goals / Non-Goals

Goals: the append path, latest-wins reloads, mockup-faithful progress, the
dead-server notice — with the decision logic pure and node-tested.

Non-goals: no virtual-DOM or diffing framework (the shell stays
no-dependency), no server changes, no attempt to preserve state across a
*wholesale* rebuild (dial flips and reviews may still reset step state, as
they do today).

## Decisions

**1. A pure `live.ts` module, in both builds.** New file
`reader/src/live.ts` added to both `reader/tsconfig.json` and
`reader/test/tsconfig.json` (before `app.ts`), holding the pure seams:

- `progressLabel(open, nibbles, total) → { text, live }` — the chrome text
  and whether the pulse shows. `app.ts` renders `live` as
  `<span class="pulse"></span>`.
- `arrivalPlan(prev, next) → "append" | "rebuild" | "none"` — `prev`/`next`
  are cheap shapes of the two plates: nibble JSON strings, `open`, reviewed
  flag, ledger presence. Append only when prev's nibbles are a prefix of
  next's (string-equal per nibble), review state unchanged, and nothing
  shrank. The seal (open→sealed, ledger appearing) is still an append: new
  cards at the end plus a progress update. Identical shapes → "none" (skip
  pointless work on the review event's reload of an unchanged strip).
  Alternative considered: diffing live DOM against data — rejected, the
  string-prefix check on the raw nibble JSON is exact and trivial.
- `latestWins()` — a counter factory: `begin()` returns a token, `isCurrent
  (token)` says whether a resolved fetch may render. Alternative: AbortController
  on the older fetch — more moving parts for the same guarantee.

**2. `render()` splits into `rebuild()` and `appendCards(from)`.**
`loadPlate` keeps the previous plate's shape, asks `arrivalPlan`, and either
rebuilds (today's path, still opens with `closeDrawer()`) or appends: build
only the new cards' DOM (the existing per-card markup factored into a helper
used by both paths), run their renderers, animate them in, update rail and
progress — and never touch the drawer, selection, popover or camera
transform.

**3. Arrival animation keys off "painted", not `knownCards > 0`.** A
`painted` flag set after the first `rebuild()` replaces the guard, so a first
nibble into an empty strip animates. The `.in` → remove-class transition
mechanism stays; `prefers-reduced-motion` already disables `.nibble`
transitions in `style.css`.

**4. The rail reconciles.** `rail()` adds/removes `<i>` elements to match the
card count and toggles classes on the survivors instead of rewriting
innerHTML, so the existing `width/background` transitions run and a new
segment appears without resetting the others.

**5. Dead-server probe on stream error.** `EventSource` retries forever and
fires `error` on every transient reconnect, so the error handler alone can't
tell "redeploying the laptop's Wi-Fi" from "serve exited". On `error`, probe
`GET /api/plate` once (reusing a guard so probes don't stack); if the fetch
rejects, show the existing "serve has exited" flash. If it responds, stay
quiet and let the EventSource reconnect.

**6. Progress follows mockup section 08 exactly.** Open:
`<pulse> N nibbles · still being written`; sealed: `N of N · sealed`. The
`#progress` element switches from `textContent` to innerHTML built from
`progressLabel` (text is escaped — it's all generated, but keep `esc()` on
the number interpolations for form).

## Risks / Trade-offs

- [Append path drifts from rebuild path] → one shared card-markup helper used
  by both; the e2e-ish wiring stays thin.
- [An existing nibble silently edited mid-stream (agent rewrites n2)] →
  `arrivalPlan` detects the prefix mismatch and falls back to wholesale
  rebuild, which is today's behavior; correctness beats continuity there.
- [Trust badges of already-shown refs go stale while reading] — true today as
  well (they refresh on every rebuild). The append path refreshes them only
  on the next wholesale rebuild. Accepted: trust is re-verified when the
  drawer opens, which is where it matters.
- [SSE probe races a genuine restart] → the probe only reports, never tears
  anything down; a false notice clears on the next successful render? No —
  `flash()` has no auto-clear, so only probe after the EventSource has
  errored with `readyState === CLOSED` or the fetch actually rejects.

## Migration Plan

Pure additive UI change; ship with the rebuilt `app.js` committed (CI drift
check). No data or protocol migration. Rollback is reverting the commit.

# Spec Delta

## Purpose

The chassis the visual kinds plug into: one canvas, a camera, the code
drawer, comments and verdict. Pure presentation — TypeScript compiled to one
static file, embedded in the Go binary, talking only to the JSON API.

## ADDED Requirements

### Requirement: One canvas, a camera

The shell SHALL render the whole plate on one canvas: a card per nibble
(caption, visual kind + title + anchors as a typed summary, budget reason
when present) laid out in reading order. Stepping (buttons, arrow keys)
SHALL move a camera — an animated transform centering the active card —
never a page navigation. Per-kind rendering is explicitly a later change;
the card states the kind it stands in for.

#### Scenario: Stepping moves the camera
- **WHEN** the reader shows a 3-nibble plate and the user steps forward
- **THEN** the canvas transform animates to center card 2; the document URL
  and page do not change

### Requirement: Code drawer with trust badges

Each ref on a card SHALL be clickable and open a drawer showing the code from
`/api/code`: line numbers, the referenced range distinguished from context,
and a trust badge — `exact`, `shifted ±N` (with the resolved position), or
`stale` with a visible warning that the code has moved on.

#### Scenario: Stale ref is not presented as current
- **WHEN** a ref's trust is `stale` and its drawer is opened
- **THEN** the drawer shows the stale badge and warning alongside whatever is
  at the original range now

### Requirement: Comments and verdict

The shell SHALL let the reader attach comments to a nibble (target `n<N>`)
and choose one verdict (`approve` / `changes` / `question` / `closed`).
Choosing is a draft: nothing is posted, the verdict can be changed, and
`serve` keeps running. Only an explicit send action SHALL `POST /api/review`
— the irreversible step is one deliberate button, never a stray click. After
a successful send — or on a plate that already has a review — the shell SHALL
show the review and lock input.

#### Scenario: Choosing a verdict is not sending
- **WHEN** the reader clicks `approve` and nothing else
- **THEN** no request is made, `review.json` does not exist, and `serve` keeps
  waiting

#### Scenario: Send ends the loop
- **WHEN** the reader adds a comment on n2, chooses `changes`, and clicks send
- **THEN** the POST carries `{"verdict":"changes","comments":[{"target":"n2",...}]}`
  and the UI switches to the submitted, locked state, then attempts to close
  the tab (falling back to a visible "sent — you can close this tab" state
  where the browser refuses)

### Requirement: Follows a live plate

The shell SHALL subscribe to `/api/events` and reflect new nibbles and the
seal without a reload, and show open/sealed state (`n of N` once sealed).

#### Scenario: Plate grows while open
- **WHEN** the reader is open on a 2-nibble plate and the agent adds n3
- **THEN** card 3 appears without a reload

### Requirement: Built TS, embedded, drift-guarded

The UI SHALL be TypeScript under `reader/` compiled (pinned tsc, no bundler,
no runtime deps) to a committed `app.js` embedded via `go:embed`, so
`go install` needs no Node. CI SHALL rebuild the UI and fail on drift between
source and committed output.

#### Scenario: Drift fails CI
- **WHEN** `app.ts` changes but the committed `app.js` is not rebuilt
- **THEN** the CI job fails on the diff

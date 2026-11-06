---
name: nibble
description: Build an interactive walkthrough (a plate) instead of a wall of text when the shape of a change matters — explaining, reviewing, or summarizing a PR, branch, or diff; explaining an architecture; walking through an incident. Also use when the user asks for a plate or mentions nibble. Not for one-line fixes, renames, or questions a true paragraph answers — a PR touching several files is not one of those, even when the ask is just "explain this PR".
---

# nibble: build a plate

nibble turns an explanation into a plate: a small set of steps (nibbles),
each one claim with a visual and references into the real code. The human
reads it in a browser, pokes the visuals, comments on the exact element they
disagree with, and sends back a review that ends your `serve` command —
their comments, or just "done".

You write JSON and run a CLI. The CLI validates everything — refs against the
real files, visuals against their schemas, budgets — and tells you how to fix
what it rejects. The reader draws the pictures; you never think about pixels.

## When to build a plate

Build one when the reader needs the shape of the thing, not just the words:

- Reviewing a PR or an uncommitted diff: what changed, what depends on it,
  what the new flow looks like.
- Explaining an architecture: what talks to what, and where the data goes.
- An incident or a performance story: what happened over time, and what the
  fix changes.
- Any before/after with real numbers.

Answer in plain text when a plate would be ceremony:

- A one-line fix, a rename, a dependency bump.
- A question one paragraph answers ("what does this flag do?").
- Anything with no structure to show: if the visual would be one box, write
  a sentence instead.

Tell the user you are building a plate before you start. Do not silently
switch output modes.

## The loop

```
nibble new   --title <t> [--description <md>] [--description-standard <md>] [--about code|worktree|<base>..<head>]
nibble serve <plate> [--timeout <dur>] &                          # start serving now, in the background
nibble add   <plate> --title <md> [--description <md>] [--description-standard <md>] --visual <file.json> [--ref <ref>]...
nibble done  <plate>                                              # seals it; serve keeps waiting for the review
```

`--about` says what code the plate is about: `code` (the code as it is, the
default), `worktree` (the uncommitted diff), or a range like `main..feat`.
Every command takes `--json`. Exit codes: 0 ok, 1 validation error, 2 usage.

Serve early: start `serve` right after `new`, as a background task (in
Claude Code, a Bash call with `run_in_background`). The reader does not wait
for a finished plate — every `add` streams into the open page live, so the
human reads nibble 1 while you build nibble 3. `serve` prints a
`reader: http://…` line to stderr; pass that URL to the user as soon as you
have it, then keep adding.

`serve` blocks until the review is submitted, then exits. Its exit code is
the review: 0 done (no comments), 2 comments to handle, 5 timeout. The
review itself comes out on stdout. The human can answer before you seal —
if `serve` ends while you still have nibbles queued, stop adding and handle
the review.

## A worked review

The PR moves image resizing out of the upload request into a queue worker.
The four example visuals in [examples/](examples/) tell this story; the
transcript below is what you actually run. Write each visual to a file
first, then `add` it.

```
$ nibble new --title "Image resize moved off the upload request" --about worktree \
    --description "Resizing leaves the request path: the handler stores, enqueues and returns, and a new worker makes the sizes." \
    --description-standard "The upload handler used to resize three sizes in-request, holding the connection for ~6 s. This PR stores the original, enqueues a job and returns 201 in 0.4 s; a new resize-worker drains the queue and writes the sizes about 2 s later. The trade is a short window where a thumbnail GET can 404."
/Users/me/.nibble/plates/2026-11-04-image-resize-moved-off-the-upload-request

$ nibble serve <plate> --timeout 45m &
reader: http://127.0.0.1:52314

$ nibble add <plate> \
    --title "The upload handler no longer resizes anything — the red edge is the window where a thumbnail GET can 404." \
    --description "It stores the original, enqueues a job and returns. The new resize-worker drains the queue." \
    --visual map.json \
    --ref "diff:src/upload/handler.ts@worktree:8-21 @api store, enqueue, return" \
    --ref "src/worker/resize.ts:1-18 @worker the whole worker"

$ nibble add <plate> \
    --title "One upload, end to end. The request returns at s5, before any resize happens. Everything after that arrow is the worker's problem." \
    --visual sequence.json \
    --ref "diff:src/upload/handler.ts@worktree:15-19 @s4 the enqueue call"

$ nibble add <plate> \
    --title "Same upload, both worlds. Inline resize holds the request open for 6.2 s. Queued, the client gets its 201 in 0.4 s and the sizes land about 2 s later." \
    --visual timeline.json \
    --ref "src/worker/resize.ts:6-14 @queued the loop that drains the queue"

$ nibble add <plate> \
    --title "The trade, in numbers: p95 upload drops from 6.2 s to 0.4 s, and thumbnails arrive about 3 s after the 201 instead of immediately." \
    --visual compare.json \
    --ref "diff:src/upload/handler.ts@worktree:8-21 @after the handler that buys this"

$ nibble done <plate>
✓ sealed at 4 nibbles

$ wait %1   # serve is still running; it exits with the review
```

Each `add` landed in the reader the moment it ran — by `done`, the human may
already be two nibbles in. Sealing tells the reader nothing more is coming;
the review ends the backgrounded `serve`.

The visuals: [examples/map.json](examples/map.json),
[examples/sequence.json](examples/sequence.json),
[examples/timeline.json](examples/timeline.json),
[examples/compare.json](examples/compare.json).

## Titles and descriptions

Plates and nibbles carry the same text model: a **title** (one level) and an
optional **description** (two levels, following the dial).

The title is the claim: one or two sentences of markdown, 40 words or fewer.
The visual is the evidence; the refs are the proof in the code. Don't
describe the visual ("this diagram shows...") — say the thing it shows.

The description is the prose behind the claim. `--description` is the
overview variant (≤ 100 words): what someone skimming needs. Add
`--description-standard` (≤ 250 words) when the full story earns the room —
the reader sees it at the dial's standard level, and the overview text
otherwise (`--description-standard` alone is rejected). Give the plate a
description when the plate needs framing; give a nibble one when its claim
needs context the title can't hold. Many nibbles need none — the title and
the visual carry it.

## Choosing the visual

Every nibble needs exactly one visual. Pick by what the reader must see:

- **map** — structure: what talks to what. Nodes and edges. Use `tier`
  (`edge`/`service`/`data`) and `group` to drive placement, `focus: true` on
  the one node the nibble is about, edge `style` to mean something: `flow`
  for the normal path, `miss` for the failure or gap, `weak` for incidental.
  See [examples/map.json](examples/map.json).
- **sequence** — one interaction over time: actors and ordered steps.
  `kind` per step: `call`, `return`, `async`. `alt` labels a branch
  ("over 25 MB"). See [examples/sequence.json](examples/sequence.json).
- **timeline** — behavior over time: lanes, events with `at` (a number of
  seconds or `"HH:MM:SS"`) and `weight` for magnitude. `states` are
  precomputed what-ifs the reader toggles — give each a `name`, `label` and
  its full event set; mark one `default`. That is how you show "with the fix
  / without it". See [examples/timeline.json](examples/timeline.json).
- **compare** — before/after. Both sides hold the same content type: `ref`
  (code), `metrics` (name/value/unit rows), or a nested `map`. See
  [examples/compare.json](examples/compare.json).

Declare meaning only. There are no colours, coordinates or sizes in a visual
— a field like `x` or `color` is rejected (`visual.field.unknown`). The
reader owns the pixels.

## Open a PR review with the blast radius

For a PR or worktree review, make nibble 1 a **ringed map**: the whole change
in three rings, so the reader starts with its reach instead of its diff. Add
`ring` to every node of a map:

- `"changed"` — the files or components this PR touches. At least one, at
  the centre.
- `"dependent"` — unchanged, but depends on something that changed. You
  compute these yourself before building the plate — you have the repo:
  callers of changed functions, importers of changed modules, tests that
  cover the changed code, configs and charts that template it. nibble never
  runs dependency analysis; it draws what you declare.
- `"rest"` — everything else in the picture, kept for orientation.

Use `group` on the dependents to say *why* each one depends —
`"group": "callers"`, `"tests"`, `"configs"` — and the reader clusters them.
Keep `focus`, `tier`, edges and `level` as on any map; the dial works the
same (positions never move).

The reader renders the rings as concentric zones and badges every dependent
the human has not yet looked at, with an "N of M unvisited" count on the
dependents ring — the plate's promise that no affected caller slips by
unreviewed. That only works if the rings are honest: list every dependent you
found, not just the interesting ones.

Rings are all-or-nothing. One ringed node makes `ring` required on all —
`map.ring.partial` names the ones you missed; add their ring rather than
deleting the hint, and park anything genuinely unaffected in `rest`. A ringed
map with no `changed` node is rejected too (`map.ring.empty`): rings only
mean something anchored on a change. A bad value is `map.ring.unknown`.
Worked example: [examples/ring-map.json](examples/ring-map.json) — the
image-resize PR's opening nibble.

## Layer the detail (the dial)

The reader has a detail dial: **overview** for a skim, **standard** for the
full picture (plates open at standard; `d` flips it). Both levels live on the
same canvas — nothing moves, the overview just draws less.

You author the layers with one optional field: `"level": "standard"` on a map
node or edge, a sequence step, or a timeline lane or event marks it
standard-only. No `level` means the element is part of the overview and is
always drawn. `"standard"` is the only value (`"deep"` is reserved).

Put the **claim** in the overview and the **mechanism** at standard. In
[examples/map.json](examples/map.json) the overview is upload → queue and
the 404-window edge — the point of the PR — while `store original`, `poll`
and `write 3 sizes` are standard-only plumbing. In
[examples/timeline.json](examples/timeline.json) the whole `upload-api` lane
is standard-only: the overview is just "POST, then 201 — 6.2 s before,
0.4 s after".

A small visual may need no levels at all — then both views are identical.
The rules the CLI enforces: an overview edge may not touch a standard-only
node (`map.edge.level`), an overview event may not sit in a standard-only
lane (`timeline.event.level`), and marking *everything* standard is rejected
(`visual.overview.empty`) — the overview must still make the claim.

## Refs and anchors

A ref points a nibble at real lines. Three forms:

```
<path>:<start>[-<end>] [@<anchor>] [note]
diff:<path>@worktree:<start>[-<end>] [@<anchor>] [note]
diff:<path>@<base>..<head>#<base|head>:<start>[-<end>] [@<anchor>] [note]
```

`@anchor` binds the ref to an element id in the same nibble's visual: a map
node id, a sequence step or actor id, a timeline lane, event or state name,
or `before`/`after` on a compare. An anchored element becomes clickable —
the reader lands on your lines. Anchor every element you make a claim about.
Refs are validated at `add` time against the real file, so a wrong path or
range fails fast instead of shipping a broken link.

## Budgets

7 nibbles for a `code` or `worktree` plate, 12 for a range plate, 40 words
per title, 100 per overview description, 250 per standard description, 12
nodes per map. The budgets are the product's respect for the reader's
attention: a plate is a guided walk, not a data dump.

`--because "<reason>"` overrides a budget and prints the reason on the
plate, where the reader sees it. Use it when the content genuinely needs the
room — a race with three actors needs the actors:

```
nibble add <plate> --because "the race needs all three actors on one picture" ...
```

Do not use it to avoid editing. An 8th nibble that exists because you didn't
want to cut the 3rd is a worse plate with a visible excuse attached. Trim
first; override when trimming would lose the point.

## When a command rejects

Rejections are machine-readable and nothing is written. Read the code and
message, fix the input, run the same command again:

```
$ nibble add <plate> --title "..." --visual map.json \
    --ref "src/worker/resize.ts:1-80 @worker the whole worker"
error ref.range.beyond-eof: src/worker/resize.ts has 18 lines, ref ends at 80

$ nibble add <plate> --title "..." --visual map.json \
    --ref "src/worker/resize.ts:1-18 @worker the whole worker"
✓ n1
```

Same pattern for every code: `ref.anchor.dangling` names the missing
element, `cli.budget` names the budget and the override. Never abandon the
plate over a rejection — the message tells you the fix.

## The review

When `serve` returns, the exit code says what came back and stdout is the
review — the human's comments, or nothing to address:

```json
{"comments": [{"target": "n2:s4", "text": "enqueue can fail — what does the client get then?"}]}
```

A target `n2` is nibble 2; `n2:s4` is element `s4` on nibble 2's visual —
here, the enqueue arrow in the sequence. Map each comment back to what it
points at before answering.

- done (exit 0, no comments): the reader is done with the plate. Report it
  and move on; don't re-serve.
- comments (exit 2): read each comment and decide from its text what it
  needs — a question gets an answer (a reply, or a new nibble if the plate
  is still open, rather than rebuilding the plate from scratch); a change
  request gets addressed where the work happens — in the code — and then an
  explanation of what changed.
- timeout (exit 5): nobody read it. Say so and carry on without a review.

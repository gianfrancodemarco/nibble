---
name: nibble
description: Build an interactive walkthrough (a plate) instead of a wall of text when the shape of a change matters — explaining, reviewing, or summarizing a PR, branch, or diff; explaining an architecture; walking through an incident. Also use when the user asks for a plate or mentions nibble. Not for one-line fixes, renames, or questions a true paragraph answers — a PR touching several files is not one of those, even when the ask is just "explain this PR".
---

# nibble: build a plate

nibble turns an explanation into a plate: a small set of steps (nibbles),
each one claim with a visual and references into the real code. The human
reads it in a browser, pokes the visuals, comments on the exact element they
disagree with, and sends back a verdict that ends your `serve` command.

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
nibble new   --title <t> [--about code|worktree|<base>..<head>]   # prints the plate path
nibble add   <plate> --caption <md> --visual <file.json> [--ref <ref>]...
nibble done  <plate>                                              # seals it
nibble serve <plate> [--timeout <dur>]                           # blocks until the review
```

`--about` says what code the plate is about: `code` (the code as it is, the
default), `worktree` (the uncommitted diff), or a range like `main..feat`.
Every command takes `--json`. Exit codes: 0 ok, 1 validation error, 2 usage.

`serve` opens the plate to the reader and blocks. Its exit code is the
verdict: 0 approve, 2 changes, 3 question, 4 closed, 5 timeout. The review
itself comes out on stdout.

## A worked review

The PR moves image resizing out of the upload request into a queue worker.
The four example visuals in [examples/](examples/) tell this story; the
transcript below is what you actually run. Write each visual to a file
first, then `add` it.

```
$ nibble new --title "Image resize moved off the upload request" --about worktree
/Users/me/.nibble/plates/2026-11-04-image-resize-moved-off-the-upload-request

$ nibble add <plate> \
    --caption "The upload handler no longer resizes anything. It stores the original, enqueues a job and returns. The new resize-worker drains the queue. The red edge is the window where a thumbnail GET can 404." \
    --visual map.json \
    --ref "diff:src/upload/handler.ts@worktree:8-21 @api store, enqueue, return" \
    --ref "src/worker/resize.ts:1-18 @worker the whole worker"

$ nibble add <plate> \
    --caption "One upload, end to end. The request returns at s5, before any resize happens. Everything after that arrow is the worker's problem." \
    --visual sequence.json \
    --ref "diff:src/upload/handler.ts@worktree:15-19 @s4 the enqueue call"

$ nibble add <plate> \
    --caption "Same upload, both worlds. Inline resize holds the request open for 6.2 s. Queued, the client gets its 201 in 0.4 s and the sizes land about 2 s later." \
    --visual timeline.json \
    --ref "src/worker/resize.ts:6-14 @queued the loop that drains the queue"

$ nibble add <plate> \
    --caption "The trade, in numbers: p95 upload drops from 6.2 s to 0.4 s, and thumbnails arrive about 3 s after the 201 instead of immediately." \
    --visual compare.json \
    --ref "diff:src/upload/handler.ts@worktree:8-21 @after the handler that buys this"

$ nibble done <plate>
✓ sealed at 4 nibbles

$ nibble serve <plate> --timeout 45m
```

The visuals: [examples/map.json](examples/map.json),
[examples/sequence.json](examples/sequence.json),
[examples/timeline.json](examples/timeline.json),
[examples/compare.json](examples/compare.json).

## Captions

One or two sentences of markdown, 40 words or fewer. The caption is the
claim; the visual is the evidence; the refs are the proof in the code. Don't
describe the visual ("this diagram shows...") — say the thing it shows.

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
per caption, 12 nodes per map. The budgets are the product's respect for the
reader's attention: a plate is a guided walk, not a data dump.

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
$ nibble add <plate> --caption "..." --visual map.json \
    --ref "src/worker/resize.ts:1-80 @worker the whole worker"
error ref.range.beyond-eof: src/worker/resize.ts has 18 lines, ref ends at 80

$ nibble add <plate> --caption "..." --visual map.json \
    --ref "src/worker/resize.ts:1-18 @worker the whole worker"
✓ n1
```

Same pattern for every code: `ref.anchor.dangling` names the missing
element, `cli.budget` names the budget and the override. Never abandon the
plate over a rejection — the message tells you the fix.

## The review

When `serve` returns, the exit code is the verdict and stdout is the review:

```json
{"verdict": "changes",
 "comments": [{"target": "n2:s4", "text": "enqueue can fail — what does the client get then?"}]}
```

A target `n2` is nibble 2; `n2:s4` is element `s4` on nibble 2's visual —
here, the enqueue arrow in the sequence. Map each comment back to what it
points at before answering.

- `approve` (exit 0): done. Report it and move on.
- `changes` (exit 2): address each comment where the work happens — in the
  code. Then explain what changed.
- `question` (exit 3): answer each question. If the answer needs showing,
  add to the explanation — a reply, a new nibble if the plate is still open
  — rather than rebuilding the plate from scratch.
- `closed` (exit 4): the reader is done. Stop; don't re-serve.
- timeout (exit 5): nobody read it. Say so and carry on without a verdict.

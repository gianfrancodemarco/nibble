# nibble protocol v1

The contract every nibble component is written against. Plates are plain JSON
on disk; anything can read them without nibble installed. This document is
normative; the fixtures under [`golden/`](golden/) are its executable
conformance suite, run by `cli/internal/protocol`'s tests.

Versioning: this is **version 1**, named by `version` in `plate.json` and by
the `fp1:` fingerprint prefix. Consumers refuse versions they don't support;
they never guess.

## A plate on disk

```
<plate-dir>/
  plate.json     the header (required)
  n1.json        nibbles, numbered from 1, contiguous
  n2.json
  ledger.json    the not-shown ledger (diff plates, written at seal)
  done           seals the plate: {"total": N}
  review.json    the review thread: round 1 of the human's comments
  reply.json     the agent's replies to round 1
  review.2.json  round 2 (review.3.json, reply.2.json… as the thread goes on)
```

A plate is **append-only while open**: nibbles are added with increasing
numbers and never renumbered. A reader may consume a plate before `done`
exists. Files not named here are ignored (`notes.txt`, editor droppings);
unknown *fields* in protocol files are preserved by tools that rewrite them.
Fixtures: [`golden/plates/`](golden/plates/).

### plate.json

| field | type | meaning |
| --- | --- | --- |
| `version` | int | protocol version; this document is 1 |
| `title` | string | non-empty |
| `description` | object | optional levelled prose (below) |
| `repo` | string | path of the root refs resolve against: absolute, or relative to the plate directory (a portable plate bundles a snapshot of its files) |
| `head_sha` | string | commit the working tree was at |
| `about` | see below | what code the plate is about |
| `created_at` | string | RFC 3339 |
| `because` | string | optional reason for exceeding a budget, shown to the reader |

`about` takes one of four forms: `"code"` (the code as it is), `"worktree"`
(the uncommitted diff), `{"pr": 1247}`, or `{"range": "main..feat"}`.

### n\<N\>.json — one nibble

| field | type | meaning |
| --- | --- | --- |
| `title` | string | markdown; the claim, one or two sentences (renamed from early drafts' `caption`, which is refused with `nibble.title.missing`) |
| `description` | object | optional levelled prose (below) |
| `visual` | object | required — a visual document (below) |
| `view` | object | optional camera hint on the plate's canvas |
| `because` | string | optional reason for exceeding a budget, shown to the reader |
| `refs` | array | stored refs (below), may be empty |

### description — levelled prose

Plates and nibbles share one description shape, following the detail dial:

```json
{"overview": "the skim text", "standard": "the fuller story"}
```

`overview` is required and non-empty — the skim is the point; `standard` is
optional, shown at the dial's standard level, **falling back to `overview`**
when absent (never the other way: the overview never shows the long text). A
description of any other shape fails with `plate.description` /
`nibble.description`. Word budgets (overview ≤ 100, standard ≤ 250) are
enforced by the CLI at authoring time, not by the protocol; a linked phrase
counts as its phrase text.

### prose anchor links

Nibble prose — the `title` and both `description` variants — may name
elements of the nibble's own visual with markdown links whose target is an
anchor: `[phrase](@id)`, the id in the same `[A-Za-z0-9_-]+` charset ref
anchors use. The reader turns the phrase and the element into a two-way
highlight. A link to an id the visual does not declare, or with an empty
phrase, fails with `nibble.prose.anchor.dangling` (the message lists the ids
the visual declares). Links inside backtick code spans are literal text, and
`[text](url)` without the `@` form is untouched. The plate header's
description has no visual, so an anchor link there fails with
`plate.prose.anchor`.

### done

`{"total": N}` — the final nibble count. A nibble file numbered beyond
`total` makes the plate invalid: sealing is a promise.

### ledger.json — the not-shown ledger

The diff hunks no nibble referenced, so nothing slips by unreviewed. Only a
plate whose `about` names a diff (`worktree`, `{"range": …}`, `{"pr": …}`)
may carry one — on an `about: code` plate it is `plate.ledger`; a diff plate
without one stays valid. The **CLI** computes and writes it when the plate is
sealed (`nibble done`); the agent never computes coverage itself.

```json
{ "shown": 1, "total": 2, "hunks": [
    { "path": "src/pool.ts", "side": "head",
      "start": 1, "end": 1, "added": 1, "removed": 1, "covered": true },
    { "path": "src/retry.ts", "side": "head",
      "start": 10, "end": 14, "added": 5, "removed": 2 } ] }
```

`hunks` is the whole diff in diff order, each hunk a nibble referenced
flagged `"covered": true`, so the reader can show what was reviewed next to
what was not. `shown`/`total` are stored rather than derived, and must agree
with the hunks: `total` equals the hunk count, `shown` the covered count
(full coverage is every hunk flagged; an empty `hunks` is only an empty
diff). Each hunk: `path` (repo-relative, same rules as ref paths),
`side` — `"head"` for added or changed lines (the worktree, or the range's
head), `"base"` for removed lines (they only exist on the base side) —
`start`/`end` (`1 ≤ start ≤ end`) and `added`/`removed` line counts, not
both zero unless the hunk declares `"binary": true` (a binary file has no
lines to count). Mismatched counts or anything else is `plate.ledger`;
unknown fields are
preserved by tools that rewrite the file. Fixtures:
[`golden/plates/worktree-ledger/`](golden/plates/worktree-ledger/),
[`golden/plates/ledger-covered/`](golden/plates/ledger-covered/).

### The review thread

The human's answer and the agent's replies are a thread of **rounds**, one
pair of files per round. Round 1 is `review.json` (the v1 name) and
`reply.json`; round `k ≥ 2` is `review.k.json` and `reply.k.json`. Rounds
are numbered without gaps and a round may only follow a round whose every
comment has a reply (a done round trivially is) — either break is
`review.round`. Fixtures: [`golden/plates/review-loop/`](golden/plates/review-loop/)
(a three-round conversation), [`golden/plates/line-comments/`](golden/plates/line-comments/)
(a thread on specific lines) and the `review-*` / `reply-*` plates beside them.

**review.k.json** — a review is the reader's comments, nothing more:
`{"comments": [{"target": "n2:cache", "text": "…"}]}`, each pinned to a
nibble and optionally an element, and each with non-empty `text`. A plate
with a ledger also takes comments targeted `ledger` (the ledger as a whole)
or `ledger:<path>` (one uncovered file; `ledger:<path>#base` when the
uncovered lines are deletions, living on the diff's base side). An empty
(or absent) `comments` array means **done**: nothing to address now. It is
not an end — the chat stays open and a later round may follow. There is no verdict — whether a comment asks a question or
requests a change is read from the comment itself. A bad shape, or a
comment without text, is `review.malformed`.

A comment may point at **lines**, not just a target: `"ref"` is one stored
ref in the nibble form — `{"target": "n2:s4", "ref": {"ref":
"src/upload/handler.ts:16-18", "fp": "fp1:…", "lines": […]}, "text": "this
swallows the error"}` — naming the lines the comment is about, beside the
target whose drawer showed them (a ref may accompany any target). The ref
string is the v1 grammar (plain, worktree or range form) and takes **no
`@anchor`** — the target already names the element (`review.ref`). The
fingerprint is optional: the reader's send stores one, computed server-side
against the code; a hand-written review may give `{"ref": "src/x.ts:17"}`
alone, and the ref's trust is then `unverified` rather than computed. When
present it must have the stored-ref shape (`ref.fp.invalid`); a ref that
does not parse is `ref.syntax`; a `ref` that is not an object is
`review.malformed`.

Every comment has the derived id `<round>.<index>` (1-based index in its
round; nothing is stored). A comment may **continue a thread** an earlier
comment opened: `{"thread": "1.2", "text": "and if the queue is full?"}`
belongs to the conversation comment 1.2 started and inherits its target and
its lines (a `target` it carries must match; a `ref` of its own is
`review.thread`). `thread` must name a comment of an
earlier round that is itself an opener (no chains of links) — anything else
is `review.thread`. A thread is therefore flat: the opener, then the
agent's replies and the reader's follow-ups alternating round by round.

**reply.k.json** — the agent's answers to that round, one per comment:

```json
{ "replies": [
    { "to": 1,
      "text": "Yes: billing reads through the same [cache](@cache)…",
      "refs": [ { "ref": "src/prices.ts:3-4 the ttl lines", "fp": "fp1:…", "lines": ["…"] } ],
      "because": "optional reason for exceeding the reply budget" } ] }
```

`to` is the comment's 1-based index in the round; `text` is non-empty
markdown; `refs` are stored refs in the nibble form (verified and
fingerprinted at write time, see below) and take **no `@anchor`** — the
element already carries its own refs; `because` is a budget reason shown to
the reader. The reply's prose may link `[phrase](@id)` into the visual of
the nibble its thread targets (`n<N>` or `n<N>:<id>`, the opener's target
for a follow-up); a link that resolves nowhere, a link in a reply on a
ledger or untargeted thread, or a ref anchor is `reply.anchor`. Shape
errors are `reply.malformed`; `to` outside the round or on a done review
is `reply.target`; two replies to one comment `reply.duplicate`; a reply
file without its review `reply.orphan`. Unknown fields are preserved by
tools that rewrite the file; the file is rewritten as replies are added,
so a reader sees them land one by one.

**Whose turn** is derived, never stored: `agent` while the latest round has
a comment without a reply; `reader` otherwise (no review yet, the latest
round fully answered, or done).

## Refs

Grammar (fixtures: [`golden/refs/grammar.json`](golden/refs/grammar.json)):

```
<path>:<start>[-<end>] [@<anchor>] [note]
diff:<path>@worktree:<start>[-<end>] [@<anchor>] [note]
diff:<path>@<base>..<head>#<base|head>:<start>[-<end>] [@<anchor>] [note]
```

`path` is relative to `repo` and may not escape it. `1 ≤ start ≤ end`.
`@anchor` binds the ref to an element id in the same nibble's visual. At
write time a ref is verified against the file it names: the file must exist
and the range must lie within it — a running agent gets a machine-readable
error and can correct itself.

### Stored form

```json
{ "ref": "src/cache/prices.ts:43-45 @cache the TTL lines",
  "fp": "fp1:<sha256 hex>",
  "lines": ["<hex>", "<hex>", "<hex>"],
  "ctx_before": ["<hex>", "<hex>"],
  "ctx_after": ["<hex>", "<hex>"] }
```

No source text is stored beyond what the agent quoted — only hashes.

### Fingerprint fp1

Normalization: CRLF → LF, trailing whitespace stripped per line. `fp` is
SHA-256 over the normalized referenced lines joined with `\n`, prefixed
`fp1:`. `lines` holds one SHA-256 per referenced line; `ctx_before` /
`ctx_after` hold up to 2 adjacent line hashes on each side. Deterministic on
every platform. Fixtures:
[`golden/trust/fingerprint.json`](golden/trust/fingerprint.json).

### Trust

Computed against the file as it is now
([`golden/trust/trust.json`](golden/trust/trust.json)):

- **exact** — the content still matches at the original position (other
  copies elsewhere don't matter).
- **shifted ±N** — the content matches whole at exactly one other position;
  when several positions match, the stored context must single one out.
- **stale** — everything else: rewritten, gone, or ambiguous. Never a guess.

These three are the protocol: comparisons against code you have. A reader
that cannot check at all (the root or git is not at hand) reports a
presentation-level **unverified** instead of guessing; it is never stored.

## Visuals

A visual declares *what things are*, never how they look: no colours,
coordinates or sizes, and unknown fields are rejected. Four kinds in v1, one
JSON Schema each under [`schemas/`](schemas/), draft 2020-12, fixtures under
[`golden/visuals/`](golden/visuals/):

| kind | declares | reader interaction |
| --- | --- | --- |
| `map` | nodes (id, label, `group`/`tier`/`focus`/`ring` hints), edges | click for code, highlight paths |
| `sequence` | actors, ordered steps (`call`/`return`/`async`, `alt`) | step through |
| `timeline` | lanes, events (`at`, `weight`), named `states` | scrub; toggle precomputed states |
| `compare` | `before`/`after`, same content type: `ref`, `map` or `metrics` | flip, slide |

Structural budget owned by the protocol: a map holds at most **12 nodes**.
What-ifs are **precomputed states** on a timeline — complete alternative
event sets the reader toggles between; at most one is `default`.

**Anchors**: map node ids, sequence actor/step ids, timeline lane/event ids
and state names, and `before`/`after` are stable ids — what a ref's
`@anchor` and a review comment's `target` point at.

**Levels — the detail dial**: map nodes and edges, sequence steps, and
timeline lanes and events may declare `level`: the minimum dial level at
which the element is drawn. Absent means the element belongs to the
**overview** and is drawn at every level; `"standard"` marks it
standard-only. `"standard"` is the only v1 value (`"deep"` is reserved for a
later version — anything else is `visual.level.unknown`). The dial changes
how much is drawn, never the layout: a levelled visual is one picture whose
overview is a subset, so an element drawn at overview may not depend on one
that is not (`map.edge.level`, `timeline.event.level`), and a visual whose
every level-capable element is standard-only is rejected
(`visual.overview.empty`). A visual with no `level` fields reads identically
at both levels. Compare sides and sequence actors take no `level`; a map
nested in a compare side is free-form content, as before.

**Rings — blast radius**: a map node may declare `ring`, placing it relative
to the change the plate is about: `"changed"` (the node changed),
`"dependent"` (unchanged, but depends on something that changed — a caller,
importer, test or config), or `"rest"` (everything else in view). The *agent*
computes what belongs in each ring — it has the repo; nibble never runs
dependency analysis, it validates and draws. Like every hint, `ring` says
what the node is, never how the rings look (anything else is
`map.ring.unknown`). Rings are **all-or-nothing per map**: one ringed node
makes every unringed node an error (`map.ring.partial`, naming them) — a
forgotten node must never silently read as "unaffected". A ringed map needs
at least one `changed` node (`map.ring.empty`): rings only mean something
anchored on a change. A map with no `ring` fields at all is simply not a
ringed map and stays valid. `ring` composes with the other hints — `group`
is the natural way to cluster dependents into callers / importers / tests /
configs — and ring coherence is checked against the full document regardless
of `level`. Fixture:
[`golden/visuals/map/valid/ringed-blast-radius.json`](golden/visuals/map/valid/ringed-blast-radius.json).

## Error code index

Codes are the stable API; messages are not. Every code the implementation
can return:

| code | meaning |
| --- | --- |
| `ref.syntax` | malformed ref string |
| `ref.range` | start/end not `1 ≤ start ≤ end` |
| `ref.path` | absolute path, or escapes the repo |
| `ref.file.missing` | referenced file does not exist |
| `ref.range.beyond-eof` | range ends past the file's last line (count reported) |
| `ref.diff.side-missing` | named diff side does not contain the path |
| `ref.anchor.dangling` | `@anchor` names no element in the nibble's visual |
| `ref.fp.invalid` | stored fingerprint is not `fp1:<64 hex>` (or a bad line hash) |
| `visual.kind.unknown` | not a v1 kind |
| `visual.field.unknown` | unknown field (usually a presentation knob) |
| `visual.schema` | any other schema violation |
| `visual.level.unknown` | `level` is not `"standard"` (`"deep"` reserved; overview is the default) |
| `visual.overview.empty` | every level-capable element is standard-only, so overview would draw nothing |
| `map.node.duplicate` | node id declared twice |
| `map.ring.unknown` | `ring` is not `changed`, `dependent` or `rest` |
| `map.ring.partial` | some nodes declare `ring` and some don't (named) |
| `map.ring.empty` | a ringed map has no `changed` node |
| `map.edge.dangling` | edge references a missing node |
| `map.edge.level` | overview edge touches a standard-only node |
| `map.nodes.budget` | more than 12 nodes |
| `sequence.step.dangling` | step references a missing actor |
| `timeline.event.dangling` | event in a missing lane |
| `timeline.event.level` | overview event in a standard-only lane |
| `timeline.state.duplicate` | two states share a name |
| `timeline.state.default` | more than one default state |
| `compare.sides.mismatch` | sides hold different content types |
| `plate.header` | plate.json unreadable or a field malformed |
| `plate.description` | plate description is not `{overview, standard?}` with a non-empty overview |
| `plate.ledger` | ledger.json malformed, or present on a plate whose `about` names no diff |
| `nibble.title.missing` | nibble has no `title` (or still carries the pre-rename `caption`) |
| `nibble.description` | nibble description is not `{overview, standard?}` with a non-empty overview |
| `nibble.prose.anchor.dangling` | prose links `[phrase](@id)` to no element of the nibble's visual, or with an empty phrase |
| `plate.prose.anchor` | anchor link in the plate description, which has no visual to resolve it |
| `plate.version.missing` | no `version` field |
| `plate.version.unsupported` | version this consumer does not implement |
| `plate.nibbles.gap` | nibble numbering has a hole |
| `plate.sealed` | nibbles beyond the sealed `total` |
| `nibble.file` | nibble file unreadable |
| `nibble.visual.missing` | nibble has no visual |
| `review.malformed` | a review file is not a review: bad shape, or a comment without text |
| `review.exists` | the latest round still awaits the agent's reply; no new round until it is answered |
| `review.round` | rounds out of order: a numbering gap, or a round after an unanswered round |
| `review.thread` | a comment's `thread` names no opener of an earlier round, its target mismatches, or it carries a `ref` of its own |
| `review.ref` | a comment ref carries `@anchor` — the target already names the element |
| `reply.malformed` | a reply file is not a replies object, or a reply has no text or a non-integer `to` |
| `reply.target` | `to` names no comment of its round, or the round is done |
| `reply.duplicate` | two replies to one comment |
| `reply.orphan` | a reply file without its round's review |
| `reply.anchor` | a reply ref carries `@anchor`, or a prose link resolves against no element of the thread's nibble |

The CLI adds codes of its own, same contract:

| code | meaning |
| --- | --- |
| `cli.repo.missing` | command run outside a git repository |
| `cli.budget` | title, description or nibble count over budget, and no `--because` |
| `cli.plate.empty` | sealing a plate that has no nibbles |
| `cli.ledger` | the coverage check could not compute the diff (git failed, a range side is gone) |

## The CLI, briefly

`nibble new / add / done / lint / serve / reply` — commands, budgets and
exit codes are documented in [`cli/README.md`](../cli/README.md). The
exit-code contract: 0 ok, 1 validation/protocol error, 2 usage; `serve`
encodes what the agent owes when it ends — 2 a round with unanswered
comments, 0 the reader sent done (nothing to address now), 5 it stopped
waiting with nothing owed. The
[`golden/plates/cli-authored/`](golden/plates/cli-authored/) fixture is a
plate written end-to-end by the CLI's own test suite.

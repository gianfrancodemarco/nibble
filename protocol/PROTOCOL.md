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
  done           seals the plate: {"total": N}
  review.json    the human's answer
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
enforced by the CLI at authoring time, not by the protocol.

### done

`{"total": N}` — the final nibble count. A nibble file numbered beyond
`total` makes the plate invalid: sealing is a promise.

### review.json

The review is the reader's comments, nothing more:
`{"comments": [{"target": "n2:cache", "text": "…"}]}`, each pinned to a
nibble and optionally an element or line, and each with non-empty `text`.
An empty (or absent) `comments` array means **done**: nothing to address.
There is no verdict — whether a comment asks a question or requests a change
is read from the comment itself.

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
| `nibble.title.missing` | nibble has no `title` (or still carries the pre-rename `caption`) |
| `nibble.description` | nibble description is not `{overview, standard?}` with a non-empty overview |
| `plate.version.missing` | no `version` field |
| `plate.version.unsupported` | version this consumer does not implement |
| `plate.nibbles.gap` | nibble numbering has a hole |
| `plate.sealed` | nibbles beyond the sealed `total` |
| `nibble.file` | nibble file unreadable |
| `nibble.visual.missing` | nibble has no visual |
| `review.malformed` | review.json is not a review: bad shape, or a comment without text |
| `review.exists` | a plate takes one review; this one already has it |

The CLI adds codes of its own, same contract:

| code | meaning |
| --- | --- |
| `cli.repo.missing` | command run outside a git repository |
| `cli.budget` | title, description or nibble count over budget, and no `--because` |
| `cli.plate.empty` | sealing a plate that has no nibbles |

## The CLI, briefly

`nibble new / add / done / lint / serve` — commands, budgets and exit codes
are documented in [`cli/README.md`](../cli/README.md). The exit-code contract:
0 ok, 1 validation/protocol error, 2 usage; `serve` encodes the review —
0 done (no comments), 2 comments to handle, 5 timeout. The
[`golden/plates/cli-authored/`](golden/plates/cli-authored/) fixture is a
plate written end-to-end by the CLI's own test suite.

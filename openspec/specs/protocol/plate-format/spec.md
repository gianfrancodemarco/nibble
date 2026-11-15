# protocol/plate-format Specification

## Purpose
Defines the plate as it exists on disk: a self-contained folder of plain JSON
files that an agent writes incrementally, a reader can consume while it is
still being written, and any tool can parse without nibble installed.

## Requirements

### Requirement: Plate folder layout

A plate SHALL be a single directory containing `plate.json` (the header),
zero or more nibble files named `n1.json`, `n2.json`, … in reading order,
an optional `done` marker file, an optional `ledger.json` (the not-shown
ledger), and the review thread: an optional `review.json` (round 1) with an
optional `reply.json`, then `review.2.json` / `reply.2.json` and so on, one
pair per round. No other files are part of protocol v1; consumers SHALL
ignore unknown files.

#### Scenario: Minimal valid plate
- **WHEN** a directory contains a valid `plate.json` and a valid `n1.json`
- **THEN** it parses as a valid plate with one nibble and no review

#### Scenario: Unknown extra file
- **WHEN** a plate directory also contains an unrelated file (e.g. `.DS_Store`)
- **THEN** parsing succeeds and the file is ignored

#### Scenario: A v1 plate with one review still parses
- **WHEN** a plate carries `review.json` and no reply file
- **THEN** it parses as a valid plate whose thread has one unanswered round

### Requirement: Plate header

`plate.json` SHALL carry: `version` (integer, 1 for this protocol), `title`
(non-empty string), `repo` (path of the root the plate's refs resolve
against: absolute, or relative to the plate directory — a relative root makes
a plate portable, e.g. a fixture or an export bundled with a snapshot of its
files), `head_sha` (the commit the working tree was at), `about` (one of
`code`, `worktree`, or `{pr: <number>}` / `{range: "<base>..<head>"}`), and
`created_at` (RFC 3339). It MAY carry `description` per the levelled
description requirement, and an optional `because` (string, the over-budget
reason, round-tripping untouched like a nibble's). Unknown fields SHALL be
preserved by tools that rewrite the file.

#### Scenario: Missing version
- **WHEN** `plate.json` lacks the `version` field
- **THEN** parsing fails with error code `plate.version.missing`

#### Scenario: Future version
- **WHEN** `plate.json` declares `version: 2`
- **THEN** a protocol-v1 consumer refuses it with error code
  `plate.version.unsupported`, naming the supported version

#### Scenario: Relative root
- **WHEN** `plate.json` says `"repo": "../repo"` and the plate lives at
  `<dir>/plate`
- **THEN** consumers resolve refs against `<dir>/repo`

#### Scenario: Plate description accepted
- **WHEN** `plate.json` carries `"description": {"overview": "the gist",
  "standard": "the full story"}`
- **THEN** the plate parses and both variants are available to consumers

### Requirement: Nibble files

Each nibble file SHALL carry: `title` (markdown string — the nibble's claim,
renamed from protocol drafts' `caption`, which is no longer accepted),
`visual` (a visual document per the visual-schemas capability), optional
`description` per the levelled description requirement, optional `view`
(camera hint), and `refs` (array, MAY be empty, each entry per the
refs-and-trust capability). A nibble whose `visual` is absent SHALL be
invalid, with error code `nibble.visual.missing`. An optional `because`
(string) field is reserved for over-budget reasons and SHALL round-trip
untouched.

#### Scenario: Nibble without a visual
- **WHEN** a nibble file has a title and refs but no `visual`
- **THEN** validation fails with error code `nibble.visual.missing`

#### Scenario: Contiguous numbering
- **WHEN** a plate contains `n1.json` and `n3.json` but no `n2.json`
- **THEN** validation fails with error code `plate.nibbles.gap`

#### Scenario: Old caption field refused
- **WHEN** a nibble file carries `caption` and no `title`
- **THEN** validation fails with error code `nibble.title.missing`, and the
  message names the rename

### Requirement: Plate lifecycle

A plate SHALL be append-only while open: nibble files are added with
increasing numbers and never renumbered. The `done` file seals the plate and
SHALL carry the final count as `{"total": N}` (an empty marker could not
detect later additions); a nibble file numbered beyond `total` SHALL make the
plate invalid (`plate.sealed`). The review thread — rounds of the reader's
comments and the agent's replies — marks the plate answered round by round;
a review round with no comments means done — nothing to address now, never
an end: a later round may follow. A reader
SHALL be able to consume a plate that has nibbles but no `done` yet.

#### Scenario: Reading while writing
- **WHEN** a plate has `n1.json` and `n2.json` and no `done`
- **THEN** it parses as a valid, open plate with two nibbles

#### Scenario: Malformed review
- **WHEN** `review.json` carries a comment without text, or is not a review
  object
- **THEN** parsing fails with error code `review.malformed`

### Requirement: Ledger file shape

`ledger.json` SHALL carry `shown` and `total` (hunk counts) and `hunks`:
every hunk of the diff in diff order — covered ones flagged `"covered":
true` — each with `path` (repo-relative, same path rules as refs), `side`
(`"head"` or `"base"`), `start`/`end` (`1 ≤ start ≤ end`) and
`added`/`removed` line counts. `total` SHALL equal the hunk count and
`shown` the covered count. Any other shape SHALL be rejected with
`plate.ledger`; unknown fields SHALL be preserved by tools that rewrite the
file.

#### Scenario: Binary hunk
- **WHEN** a hunk declares `"binary": true`
- **THEN** its `added`/`removed` may both be 0 (no lines to count); on a
  non-binary hunk both zero is rejected with `plate.ledger`

#### Scenario: Valid ledger, partly covered
- **WHEN** a plate contains `{"shown": 1, "total": 2, "hunks": [{"path":
  "src/pool.ts", "side": "head", "start": 1, "end": 1, "added": 1,
  "removed": 1, "covered": true}, {"path": "src/retry.ts", "side": "head",
  "start": 10, "end": 14, "added": 5, "removed": 2}]}` as `ledger.json`
- **THEN** the plate parses and exposes the ledger

#### Scenario: Fully covered ledger
- **WHEN** every hunk in `hunks` is `"covered": true` and `shown` equals
  `total`
- **THEN** the plate parses: full coverage is a ledger whose every hunk is
  covered (an empty `hunks` is only valid for an empty diff, `total` 0)

#### Scenario: Malformed ledger rejected
- **WHEN** `ledger.json` has a hunk whose `side` is `"worktree"`, or whose
  `end` is below its `start`, or an absolute `path`
- **THEN** parsing fails with `plate.ledger` naming the offending hunk

#### Scenario: Inconsistent counts rejected
- **WHEN** `shown` differs from the number of covered hunks, or `total` from
  the number of hunks
- **THEN** parsing fails with `plate.ledger` naming the mismatch

### Requirement: Ledger only on diff plates

A `ledger.json` SHALL be valid only on a plate whose `about` names a diff
(`worktree`, `{"range": …}` or `{"pr": …}`); on an `about: code` plate it
SHALL be rejected with `plate.ledger` — there is no diff for a ledger to
cover. A diff plate without a `ledger.json` SHALL remain valid (plates
predating the ledger, or sealed by other tools).

#### Scenario: Ledger on a code plate rejected
- **WHEN** a plate with `"about": "code"` contains a `ledger.json`
- **THEN** parsing fails with `plate.ledger`

#### Scenario: Diff plate without a ledger still valid
- **WHEN** a sealed `about: worktree` plate has no `ledger.json`
- **THEN** the plate parses with no ledger

### Requirement: Levelled descriptions

A plate header and a nibble MAY each carry `description`: an object with
`overview` (required, non-empty markdown) and `standard` (optional, non-empty
markdown). The variants follow the detail dial: `overview` is the skim text,
`standard` the fuller text shown at the standard level, falling back to
`overview` when absent. A `description` that is not such an object SHALL be
invalid: `plate.description` on the header, `nibble.description` on a nibble.

#### Scenario: Overview-only description
- **WHEN** a nibble carries `"description": {"overview": "why this matters"}`
- **THEN** it is valid, and both dial levels read the overview text

#### Scenario: Description without overview rejected
- **WHEN** a nibble carries `"description": {"standard": "only the long form"}`
- **THEN** validation fails with error code `nibble.description`

#### Scenario: Malformed plate description rejected
- **WHEN** `plate.json` carries `"description": "just a string"`
- **THEN** parsing fails with error code `plate.description`

### Requirement: Prose anchor links

Nibble prose — the `title` and each `description` variant — MAY carry anchor
links in markdown link syntax, `[phrase](@id)`, where `id` names a stable
element id of that nibble's own visual (per the visual-schemas anchors
requirement). Validation SHALL reject a link whose id no element of the
visual declares, with error code `nibble.prose.anchor.dangling` and a message
naming the ids the visual does declare. Link text SHALL be non-empty.

#### Scenario: Linked phrase accepted
- **WHEN** a nibble's title reads `the [cache](@cache) misses fall through`
  and its map has a node `cache`
- **THEN** the nibble validates

#### Scenario: Dangling prose anchor
- **WHEN** a nibble's description overview carries `[the pool](@pool)` and no
  element of its visual has id `pool`
- **THEN** validation fails with `nibble.prose.anchor.dangling`, and the
  message lists the visual's element ids

#### Scenario: Empty link text rejected
- **WHEN** a nibble's title carries `[](@cache)`
- **THEN** validation fails with `nibble.prose.anchor.dangling` naming the
  empty phrase

### Requirement: Plate prose carries no anchor links

A plate header's `description` has no visual to resolve against, so anchor
links there SHALL be rejected with error code `plate.prose.anchor`. Markdown
that merely resembles a link without the `@` form (for example
`[text](url)`) is not an anchor link and SHALL pass this check unchanged.

#### Scenario: Anchor link in plate description rejected
- **WHEN** `plate.json`'s description overview carries `[the cache](@cache)`
- **THEN** validation fails with error code `plate.prose.anchor`

#### Scenario: Ordinary bracketed text untouched
- **WHEN** a plate description carries `see [RFC 42](https://example.com)`
- **THEN** validation passes and the text round-trips unchanged

### Requirement: Review rounds

The thread SHALL be numbered rounds: round 1 is `review.json`, round `k ≥ 2`
is `review.k.json`, each a review (`{"comments": […]}`). Rounds SHALL be
contiguous and a round MAY only follow a round whose every comment has a
reply — a done round (no comments) trivially qualifies, so the chat never
closes. Either broken is `review.round`.

#### Scenario: Two rounds
- **WHEN** a plate has `review.json` with two comments, a `reply.json`
  answering both, and `review.2.json` with `{"comments": []}`
- **THEN** it parses with two rounds, the second done, and the turn the
  reader's

#### Scenario: Round numbering gap
- **WHEN** a plate has `review.json` and `review.3.json` but no `review.2.json`
- **THEN** parsing fails with `review.round`

#### Scenario: Round before its predecessor is answered
- **WHEN** `review.2.json` exists while a comment of `review.json` has no
  reply
- **THEN** parsing fails with `review.round`

#### Scenario: Round after done
- **WHEN** `review.json` is `{"comments": []}` and `review.2.json` carries a
  comment
- **THEN** the plate parses with two rounds and the turn is `agent`

### Requirement: Comment ids and thread continuation

Every comment SHALL have the derived id `<round>.<index>` (1-based index in
its round). A comment MAY carry `"thread": "<id>"` naming a comment of an
earlier round that itself carries no `thread` (the opener); it then belongs
to that thread and inherits the opener's target and ref, and a `target` it
carries SHALL equal the opener's. A `thread` naming a missing comment, a
comment of the same or a later round, or a continuation, or a mismatched
target, or a continuation that carries a `ref` of its own, is
`review.thread`.

#### Scenario: Follow-up continues a thread
- **WHEN** `review.json` comment 2 targets `n2:s4` and `review.2.json`
  comment 1 is `{"thread": "1.2", "text": "and if the queue is full?"}`
- **THEN** the plate parses and comment 2.1 belongs to thread 1.2 with
  target `n2:s4`

#### Scenario: Follow-up inherits the opener's lines
- **WHEN** comment 1.2 targets `n2:s4` with ref `src/upload/handler.ts:15-19`
  and comment 2.1 continues thread 1.2 with no ref
- **THEN** the plate parses and comment 2.1 resolves to the opener's ref

#### Scenario: Follow-up carries its own ref
- **WHEN** comment 2.1 continues thread 1.2 and carries a `ref`
- **THEN** parsing fails with `review.thread`

#### Scenario: Thread names a missing comment
- **WHEN** a comment carries `"thread": "1.9"` and round 1 has two comments
- **THEN** parsing fails with `review.thread`

#### Scenario: Thread names a continuation
- **WHEN** comment 3.1 carries `"thread": "2.1"` and comment 2.1 itself
  continues thread 1.2
- **THEN** parsing fails with `review.thread`

#### Scenario: Thread target mismatch
- **WHEN** a continuation of thread 1.2 (target `n2:s4`) carries
  `"target": "n3"`
- **THEN** parsing fails with `review.thread`

#### Scenario: Thread within the same round
- **WHEN** comment 2.2 carries `"thread": "2.1"`
- **THEN** parsing fails with `review.thread`

### Requirement: Reply file shape

A round's replies SHALL live in `reply.json` (round 1) or `reply.k.json`:
`{"replies": [{"to": N, "text": "<md>", "refs": […], "because": "…"}]}`.
`to` is the 1-based index of a comment in that round's review; `text` is
non-empty markdown; `refs` (optional) are stored refs in the nibble form,
fingerprinted, with no `@anchor`; `because` (optional) is a budget reason
shown to the reader. Unknown fields SHALL be preserved by tools that rewrite
the file.

#### Scenario: Valid reply with refs
- **WHEN** `reply.json` carries a reply to comment 1 with text and one stored
  ref carrying a valid `fp1:` fingerprint
- **THEN** the plate parses and the reply's ref resolves like a nibble ref

#### Scenario: Malformed reply
- **WHEN** a reply has empty text, a non-integer `to`, or the file is not a
  replies object
- **THEN** parsing fails with `reply.malformed`

#### Scenario: Reply to no comment
- **WHEN** `reply.json` replies `to` 3 and the round has two comments, or the
  round's review is done
- **THEN** parsing fails with `reply.target`

#### Scenario: Two replies to one comment
- **WHEN** `reply.json` carries two replies with the same `to`
- **THEN** parsing fails with `reply.duplicate`

#### Scenario: Reply without its review
- **WHEN** `reply.2.json` exists and `review.2.json` does not
- **THEN** parsing fails with `reply.orphan`

#### Scenario: Reply ref carries an anchor
- **WHEN** a reply's stored ref is `src/a.ts:1-3 @cache note`
- **THEN** parsing fails with `reply.anchor`

### Requirement: Reply prose anchor links

A reply's `text` MAY carry `[phrase](@id)` anchor links when its thread's
target is a nibble (`n<N>` or `n<N>:<id>`); each id SHALL name an element
of that nibble's visual. A link that names no such element, or any anchor
link in a reply on a `ledger…` or untargeted thread, is `reply.anchor`.

#### Scenario: Reply links into the thread's nibble
- **WHEN** a reply to a comment on `n2:s4` reads "the [enqueue](@s4) is
  retried" and nibble 2's visual declares `s4`
- **THEN** the plate parses

#### Scenario: Reply to a follow-up resolves against the opener's nibble
- **WHEN** comment 2.1 continues thread 1.2 (target `n2:s4`) and its reply
  links `[s4](@s4)`
- **THEN** the plate parses

#### Scenario: Dangling reply link
- **WHEN** a reply to a comment on `n2` links `[x](@nope)` and nibble 2's
  visual declares no `nope`
- **THEN** parsing fails with `reply.anchor`

### Requirement: Whose turn it is

A parsed plate SHALL expose the thread's turn, derived from the files:
`agent` when the latest review has a comment without a reply; `reader`
otherwise (no review yet, every comment of the latest round answered, or a
done round).

#### Scenario: Fresh plate
- **WHEN** a plate has no review file
- **THEN** its turn is `reader`

#### Scenario: Comments awaiting replies
- **WHEN** the latest round has two comments and one reply
- **THEN** its turn is `agent`

#### Scenario: Round answered
- **WHEN** the latest round has two comments and two replies
- **THEN** its turn is `reader`

#### Scenario: Done is the reader's turn
- **WHEN** the latest review is `{"comments": []}`
- **THEN** its turn is `reader`

### Requirement: Comment refs

A review comment MAY carry `ref`: one stored ref in the nibble form —
`{"ref": "<v1 ref string>", "fp": "fp1:…", "lines": […], "ctx_before":
[…], "ctx_after": […]}` — naming the lines the comment is about, beside
its `target`. The ref string SHALL parse in the v1 grammar (plain, worktree
or range form) and SHALL carry no `@anchor`. `fp` and the hashes are
optional: when present they SHALL have the stored-ref shape; when absent the
ref's trust is `unverified`. Unknown fields SHALL be preserved.

#### Scenario: Line comment with a fingerprint
- **WHEN** `review.json` carries `{"target": "n2:s4", "ref": {"ref":
  "src/upload/handler.ts:15-19", "fp": "fp1:…", "lines": […]}, "text":
  "this swallows the error"}` with a well-formed fingerprint
- **THEN** the plate parses and the comment exposes its ref, resolvable like
  a reply ref

#### Scenario: Hand-written line comment without a fingerprint
- **WHEN** a comment carries `"ref": {"ref": "src/upload/handler.ts:17"}`
  and no `fp`
- **THEN** the plate parses and consumers report that ref's trust as
  `unverified`

#### Scenario: Comment ref carries an anchor
- **WHEN** a comment's ref string is `src/a.ts:1-3 @cache`
- **THEN** parsing fails with `review.ref`, the message saying the target
  already names the element

#### Scenario: Comment ref does not parse
- **WHEN** a comment's ref string is `src/a.ts` (no range)
- **THEN** parsing fails with `ref.syntax`

#### Scenario: Comment ref with a malformed fingerprint
- **WHEN** a comment's ref carries `"fp": "nope"`
- **THEN** parsing fails with `ref.fp.invalid`

#### Scenario: Ref on a ledger comment
- **WHEN** a comment targets `ledger:src/b.ts#base` and carries a ref
  `diff:src/b.ts@abc..def#base:10-12`
- **THEN** the plate parses: a ref may accompany any target

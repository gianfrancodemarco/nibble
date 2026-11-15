# Spec Delta

## ADDED Requirements

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

## MODIFIED Requirements

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

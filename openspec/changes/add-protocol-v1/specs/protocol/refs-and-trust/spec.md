# Spec Delta

## Purpose

Defines how a nibble points at real code — the ref grammar for plain and diff
refs — and how a consumer decides, later, how much to trust that pointer:
the fingerprint stored at write time and the `exact`/`shifted`/`stale`
computation against the code as it is now.

## ADDED Requirements

### Requirement: Plain ref grammar

A ref SHALL be written as `<path>:<start>[-<end>]`, optionally followed by
`@<anchor>` (binding it to a visual element id) and a trailing note, where
`path` is relative to the plate's `repo` and `1 ≤ start ≤ end`.

#### Scenario: Plain ref with range and anchor
- **WHEN** parsing `src/cache/prices.ts:43-45 @cache the TTL lines`
- **THEN** it yields path `src/cache/prices.ts`, lines 43–45, anchor `cache`,
  note `the TTL lines`

#### Scenario: Reversed range rejected
- **WHEN** parsing `src/a.ts:45-43`
- **THEN** parsing fails with error code `ref.range`

#### Scenario: Escaping path rejected
- **WHEN** parsing `../secrets.env:1` or `/etc/passwd:1`
- **THEN** parsing fails with error code `ref.path`

#### Scenario: Malformed ref rejected
- **WHEN** parsing `src/a.ts` (no line part)
- **THEN** parsing fails with error code `ref.syntax`

### Requirement: Diff ref grammar

A diff ref SHALL be written as `diff:<path>@<side-spec>:<start>[-<end>]`,
where `<side-spec>` is `worktree`, or `<base>..<head>` followed by `#base`
or `#head` naming which side the lines are on. Anchor and note suffixes
apply as for plain refs.

#### Scenario: Worktree diff ref
- **WHEN** parsing `diff:src/db/pool.ts@worktree:12-18`
- **THEN** it yields a diff ref against the uncommitted working tree,
  lines 12–18

#### Scenario: Range diff ref with side
- **WHEN** parsing `diff:src/pay.ts@main..feat#head:5-9`
- **THEN** it yields a diff ref on the `head` side of `main..feat`, lines 5–9

#### Scenario: Range diff ref without side rejected
- **WHEN** parsing `diff:src/pay.ts@main..feat:5-9`
- **THEN** parsing fails with error code `ref.syntax`

### Requirement: Write-time validation

At write time, a ref SHALL be verified against the file it names: the file
must exist (else `ref.file.missing`) and the range must lie within the
file's line count (else `ref.range.beyond-eof`, naming the actual line
count). For a diff ref, the named side must contain the path (else
`ref.diff.side-missing`). Verification failures SHALL identify the ref and
be machine-readable, so a running agent can correct and retry.

#### Scenario: Range beyond end of file
- **WHEN** a ref names lines 12–90 of a 61-line file
- **THEN** validation fails with `ref.range.beyond-eof` and reports 61

### Requirement: Fingerprint

A validated ref SHALL store a fingerprint of the exact referenced lines plus
up to 2 lines of context on each side, after normalizing line endings
(CRLF → LF) and stripping trailing whitespace per line. The fingerprint SHALL
be deterministic: the same lines always produce the same fingerprint, on any
platform. Fingerprints SHALL be versioned (`fp1:` prefix) so the algorithm
can evolve.

#### Scenario: Determinism across platforms
- **WHEN** the same referenced lines are fingerprinted with LF and with CRLF
  line endings
- **THEN** the fingerprints are identical

### Requirement: Trust computation

Given a stored ref and the repository as it is now, trust SHALL be computed
as: `exact` when the stored range still matches the fingerprint; `shifted`
(with a signed line offset) when the fingerprinted content is found whole at
exactly one other location in the same file; `stale` when it is found
nowhere, at multiple locations, or the file is gone. Consumers SHALL receive
the trust level and, for `shifted`, the offset.

#### Scenario: Untouched file
- **WHEN** the file has not changed since write time
- **THEN** trust is `exact`

#### Scenario: Lines moved down
- **WHEN** 3 lines were inserted above the referenced range and the range
  itself is unchanged
- **THEN** trust is `shifted` with offset +3

#### Scenario: Content rewritten
- **WHEN** the referenced lines were edited so the fingerprint no longer
  matches anywhere in the file
- **THEN** trust is `stale`

#### Scenario: Ambiguous match
- **WHEN** the fingerprinted content now appears at two locations in the file
- **THEN** trust is `stale` (never a guess between the two)

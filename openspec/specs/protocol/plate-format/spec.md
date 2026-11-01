# protocol/plate-format Specification

## Purpose
Defines the plate as it exists on disk: a self-contained folder of plain JSON
files that an agent writes incrementally, a reader can consume while it is
still being written, and any tool can parse without nibble installed.

## Requirements

### Requirement: Plate folder layout

A plate SHALL be a single directory containing `plate.json` (the header),
zero or more nibble files named `n1.json`, `n2.json`, … in reading order,
an optional `done` marker file, and an optional `review.json`. No other
files are part of protocol v1; consumers SHALL ignore unknown files.

#### Scenario: Minimal valid plate
- **WHEN** a directory contains a valid `plate.json` and a valid `n1.json`
- **THEN** it parses as a valid plate with one nibble and no review

#### Scenario: Unknown extra file
- **WHEN** a plate directory also contains an unrelated file (e.g. `.DS_Store`)
- **THEN** parsing succeeds and the file is ignored

### Requirement: Plate header

`plate.json` SHALL carry: `version` (integer, 1 for this protocol), `title`
(non-empty string), `repo` (absolute path of the repository root the plate is
about), `head_sha` (the commit the working tree was at), `about` (one of
`code`, `worktree`, or `{pr: <number>}` / `{range: "<base>..<head>"}`), and
`created_at` (RFC 3339). Unknown fields SHALL be preserved by tools that
rewrite the file.

#### Scenario: Missing version
- **WHEN** `plate.json` lacks the `version` field
- **THEN** parsing fails with error code `plate.version.missing`

#### Scenario: Future version
- **WHEN** `plate.json` declares `version: 2`
- **THEN** a protocol-v1 consumer refuses it with error code
  `plate.version.unsupported`, naming the supported version

### Requirement: Nibble files

Each nibble file SHALL carry: `caption` (markdown string), `visual` (a visual
document per the visual-schemas capability), optional `view` (camera hint),
and `refs` (array, MAY be empty, each entry per the refs-and-trust
capability). A nibble whose `visual` is absent SHALL be invalid, with error
code `nibble.visual.missing`. An optional `because` (string) field is
reserved for over-budget reasons and SHALL round-trip untouched.

#### Scenario: Nibble without a visual
- **WHEN** a nibble file has a caption and refs but no `visual`
- **THEN** validation fails with error code `nibble.visual.missing`

#### Scenario: Contiguous numbering
- **WHEN** a plate contains `n1.json` and `n3.json` but no `n2.json`
- **THEN** validation fails with error code `plate.nibbles.gap`

### Requirement: Plate lifecycle

A plate SHALL be append-only while open: nibble files are added with
increasing numbers and never renumbered. The `done` file seals the plate and
SHALL carry the final count as `{"total": N}` (an empty marker could not
detect later additions); a nibble file numbered beyond `total` SHALL make the
plate invalid (`plate.sealed`). `review.json` (verdict plus comments) marks
the plate answered. A reader SHALL be able to consume a plate that has
nibbles but no `done` yet.

#### Scenario: Reading while writing
- **WHEN** a plate has `n1.json` and `n2.json` and no `done`
- **THEN** it parses as a valid, open plate with two nibbles

#### Scenario: Review verdict values
- **WHEN** `review.json` carries a `verdict` other than `approve`,
  `changes`, `question`, or `closed`
- **THEN** parsing fails with error code `review.verdict.unknown`

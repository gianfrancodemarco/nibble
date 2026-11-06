# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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

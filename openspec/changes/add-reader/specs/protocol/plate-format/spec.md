# Spec Delta

## MODIFIED Requirements

### Requirement: Plate header

`plate.json` SHALL carry: `version` (integer, 1 for this protocol), `title`
(non-empty string), `repo` (path of the root the plate's refs resolve
against: absolute, or relative to the plate directory — a relative root makes
a plate portable, e.g. a fixture or an export bundled with a snapshot of its
files), `head_sha` (the commit the working tree was at), `about` (one of
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

#### Scenario: Relative root
- **WHEN** `plate.json` says `"repo": "../repo"` and the plate lives at
  `<dir>/plate`
- **THEN** consumers resolve refs against `<dir>/repo`

# Spec Delta

## ADDED Requirements

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

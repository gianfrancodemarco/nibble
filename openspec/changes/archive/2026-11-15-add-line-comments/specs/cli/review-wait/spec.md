# Spec Delta

## MODIFIED Requirements

### Requirement: Review output

By default `serve` SHALL print the round that ended the wait as markdown: a
`done — no comments` line for an empty review, or a comment count followed
by one section per comment with its id and target; a comment that carries
a ref (or continues a thread whose opener does) SHALL put the ref's
location on its heading and quote the lines it names, numbered, at the
trust-resolved position when the code is readable, with a trust word when
it is not `exact`; a comment that continues a thread SHALL print the
thread's earlier messages (the opener, each reply, each follow-up, in
order, marked reader or agent) before its own text, so the agent reads the
conversation it is answering. The first line SHALL carry the round number
(`· round N`). With `--json` it SHALL print the parsed review object with
`round` added and, on each comment, its `id`, a `history` array of the
thread's earlier messages and, when it has one, its `ref` with computed
`trust` and the current `lines`. Output goes to stdout only after the wait
ends; a timeout with nothing owed prints nothing to stdout.

#### Scenario: Markdown review
- **WHEN** a round-1 review with one comment targeting `n2:cache` is served
- **THEN** stdout contains `comments: 1 · round 1` and a section naming
  `n2:cache` with the comment text

#### Scenario: Line comment quotes its lines
- **WHEN** round 1's comment 1 targets `n2:s4` with ref
  `src/upload/handler.ts:16-18` and the file is readable
- **THEN** its section is headed `## n2:s4 · src/upload/handler.ts:16-18 ·
  1.1` and quotes lines 16, 17 and 18 with their numbers before the
  comment text

#### Scenario: Line comment on moved code
- **WHEN** the comment's fingerprinted ref now resolves `shifted +2`
- **THEN** the section says the lines moved to 18-20 and quotes them there

#### Scenario: Line comment with the code unavailable
- **WHEN** the plate's root is not on this machine
- **THEN** the section keeps the location on its heading and says the
  lines could not be read, instead of quoting them

#### Scenario: Follow-up prints its history
- **WHEN** `review.2.json`'s only comment continues thread 1.2, whose
  opener asked about the enqueue and whose reply said it is retried
- **THEN** the comment's section quotes the opener and the reply, marked as
  reader and agent, before the follow-up's text

#### Scenario: JSON of a later round
- **WHEN** `serve --json` ends on `review.2.json`
- **THEN** stdout is the review object with `"round": 2` and each comment
  carrying `id` and `history`

#### Scenario: JSON of a line comment
- **WHEN** `serve --json` ends on a round whose comment 1 carries a ref
- **THEN** that comment carries `ref` with `path`, `start`, `end`, `trust`
  and the current `lines`

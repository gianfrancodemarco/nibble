# Spec Delta

## MODIFIED Requirements

### Requirement: Teaches answering the review

The skill SHALL teach reading `serve`'s result: done vs comments from the
exit code, the review JSON from stdout, comment targets (`n<N>`,
`n<N>:<element-id>`, `ledger`, `ledger:<path>`) mapped back to the nibble
and element they point at, a line comment's location and quoted lines read
as the exact code the human means, and a follow-up's thread history read
as the conversation it continues. It SHALL instruct the agent to read the
round as a batch and answer every comment on the same plate with `nibble
reply` — deciding from each comment's text what it needs: a code change
made where the work happens and then explained in the reply, or an answer
— with refs to the lines that prove it, a line comment's reply pointing at
the lines it named or what replaced them; the open tab shows each reply as
it lands, because the page outlives serve's exit; to run `serve` again (it
reuses the address the tab is on) to wait for the next round; and to stop
when a round comes back done. It SHALL say that a reply never rebuilds the
plate.

#### Scenario: Targets are decoded
- **WHEN** the skill's review section is read
- **THEN** it shows a review with an element-targeted comment (`n2:cache`
  style) and what the agent should do with it

#### Scenario: Line comments are decoded
- **WHEN** the skill's review section is read
- **THEN** it shows a comment printed with a location (`src/upload/handler.ts:16-18`)
  and quoted lines, says those lines are what the comment is about, and
  shows the reply carrying a `--ref` on them

#### Scenario: The loop is taught end to end
- **WHEN** the skill's review section is read
- **THEN** it shows `nibble reply` with `--to`, `--text` and `--ref`,
  the re-serve that picks the address back up, a round-2 follow-up
  printed with its history, and the three outcomes of a round (done, more
  comments, timeout)

### Requirement: Reply transcript is executed

The skill SHALL carry a worked conversation — the round-1 review that came
back from the authoring transcript's plate, the `nibble reply` commands
answering it, a round-2 follow-up and a round-2 line comment with their
replies — and CI SHALL execute that transcript against the authoring
transcript's plate, so the taught commands cannot drift from the CLI.

#### Scenario: Reply transcript runs clean
- **WHEN** the reply transcript's commands run on the plate the authoring
  transcript built, with the shown reviews written as `review.json` and
  `review.2.json` at the points the transcript shows them
- **THEN** every command exits 0 and the plate ends with two answered
  rounds, the second holding a comment with a ref

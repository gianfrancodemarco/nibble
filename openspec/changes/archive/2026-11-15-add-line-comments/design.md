# Design

## Context

See proposal.md — Why. What exists today, and shapes the approach:

- A comment is `{target, text, thread?}`; `ParseReview` checks only the
  text, `NextRound` resolves thread links and targets. Targets are free
  strings the reader mints (`n2`, `n2:s4`, `ledger:src/a.ts#base`); the
  protocol never parses them beyond `nibbleOfTarget` for reply prose.
- Refs have one grammar (`ref.go`), one stored form (`NibbleRef`: string,
  `fp`, line hashes, context hashes) and one verification pipeline
  (`ParseRef` → `loadRefContent` → `CheckRef` → `NewFingerprint`) used by
  `add` and `reply`. Reply refs reuse it with `checkStoredRefShape` on
  load. `resolveRef` computes trust for the API; a `Fingerprint` with no
  lines would match everywhere, so a bare ref must be short-circuited to
  `unverified` before it reaches `Trust`.
- The drawer is one element re-homed into the active card. It renders
  `/api/code` (a nibble ref, or a reply ref via `round/comment/ref`) or
  `/api/ledger` (a file-and-side) as `.ln` rows with a `.no` gutter span;
  it knows the path but not the ref grammar of what it shows.
  `ledgerHunkRef` already synthesizes the ref a ledger row resolves
  through, so the server knows every drawer's address.
- `chat.ts` keys threads by opener id and merges a new draft into the sent
  thread with the same `target` (`sentThreadOn`); `composerDestination`
  reads the current selection; `badgeCounts` maps threads to cards and
  element ids.
- `serve` prints a round from `Plate.Rounds` with `History`; it already
  has the repo (`openGit`, `loadRefContent`) for `reply`.
- The skill's worked conversation is executed by
  `TestSkillConversationTranscript`, which writes the review JSON blocks
  shown in SKILL.md at the points the transcript shows them — so a review
  it shows must be valid when hand-written.

## Goals / Non-Goals

**Goals:**

- A line comment is an ordinary comment plus a pointer, in the one ref
  form the protocol already has, so every existing tool, fixture and
  reader path keeps working and trust applies to the pointer for free.
- The reader stays pure presentation: it concatenates an address the
  server gave it with the numbers it showed; parsing, verification and
  fingerprinting happen in Go on the POST.
- The agent reads the lines in `serve`'s output; it never has to open a
  file to know what was meant.
- A hand-written review can point at lines without computing hashes.

**Non-Goals:**

- Pointing at lines the drawer never showed (an arbitrary path typed by
  the reader): the gutter is the only way in.
- Line comments inside the compare visual's panes.
- A new thread identity scheme: threads stay keyed by opener id; the
  "same place" rule for drafts simply includes the ref.

## Decisions

### D1. `ref` on the comment, in the stored nibble form

A comment carries `"ref": {"ref": "src/x.ts:16-18", "fp": …, "lines": …}`
— the same object a nibble or reply ref is. Alternatives: encoding the
lines in the target (`n2:s4@src/x.ts:16-18`) overloads a string every
consumer splits on `:` today, and loses the fingerprint; a flat
`{path, start, end, side}` object is a second way to say what a ref
already says, with no place for trust. The stored form means `/api/plate`
serves it through `resolveRef` like a reply ref, `/api/code` opens it
through the same path, and `CheckReplies`' shape checks apply verbatim.

### D2. Fingerprint optional on a comment ref

`fp`, `lines`, `ctx_before`, `ctx_after` are optional on a comment ref;
when absent the ref is `unverified`. A reply ref requires them because the
agent's evidence must be checkable; a comment is the human's pointer and a
hand-written review (the skill transcript, a script, a test) should not
need to hash lines. The reader's POST always goes through the server,
which fingerprints when the code is available (root present, git present
for range sides) and stores the ref bare otherwise — the per-ref
degradation tiers the API already has. `resolveRef` returns `unverified`
when `nr.FP == ""` without consulting `Trust` (an empty fingerprint would
match at every position). Alternative considered: requiring `fp` and
teaching a `nibble comment` command for hand-written reviews — a new
command for a case the reader never hits.

### D3. No anchor, no own ref on a follow-up

A comment ref with `@anchor` is `review.ref`: the target already names the
element, and two places saying it could disagree. A continuation that
carries a `ref` is `review.thread`, the same rule as a mismatched target:
the thread's place is the opener's. `Round` resolves refs per comment next
to targets (`Round.Ref(i)`), so `serve`, the API and `reply` read one
resolved value.

### D4. The server tells the drawer its address

`/api/code` and `/api/ledger` responses (and every `apiRef`) gain `at`:
the location part of a ref string — `src/x.ts`, `diff:src/x.ts@worktree`,
`diff:src/x.ts@abc..def#base`. The reader builds `<at>:<start>-<end>`
from the gutter selection and POSTs it; the server parses and verifies
it. The reader never parses a ref. Alternatives: the reader strips the
range from `ref` (needs the grammar — notes, anchors, the `diff:` form);
the POST carries `{path, start, end, side}` and the server builds the ref
(a second shape on the wire, and the ledger's base-side revs would have to
be re-derived from the header on every POST). `at` is derived from the
parsed `Ref` in one helper (`refAt`) shared by the three places.

### D5. Gutter selection is drawer state, cleared with the content

`drawerLines: {start, end} | null` lives in the shell beside the drawer;
click selects, shift-click extends to a contiguous range, clicking the
sole selected line clears. `openCode`/`openLedgerDrawer`/`closeDrawer`
reset it. The composer destination prefers it over the element selection
(a selected line is the more specific pointer), and the draft stores
`ref` next to `target`. `esc` clears lines, then the drawer, then the
selection — the most specific thing first, consistent with today's order.
Alternative considered: a `+` button per row like GitHub — the gutter is
already the affordance and a button per line crowds a 13 px gutter; the
hover style on `.no` says it is clickable.

### D6. Thread identity: opener id; "same place" includes the ref

Threads stay keyed by opener id (sent) or `new:<target>|<ref>` (draft).
`sentThreadOn(threads, target, ref)` matches both, so a draft on other
lines of the same element opens a new thread, and a draft on exactly the
lines of an existing thread continues it. `cardOfTarget` and
`anchorOfTarget` are unchanged: a line thread counts on its card and
element badges like any thread on that target.

### D7. Drawer badges from resolved trust

`drawerBadges(threads, at, lines)` in `chat.ts` returns `{lineNo →
{count, key}}`: for each thread whose opener ref has `ref.at === at`,
take the trust-resolved range (`trust.line` … `trust.line + (end -
start)`), intersect with the shown line numbers, and badge the first
shown line. Stale refs badge at their original range (that is what the
drawer shows for stale too). Applied on every drawer open and on every
`"thread"` arrival plan, as the element badges are.

### D8. `serve` quotes the lines

The markdown heading becomes `## <target> · <path>:<range> · <id>`; below
it, when the ref's content loads (`loadRefContent` through the plate's
repo, the same tiers as the API), the lines at the resolved range are
quoted numbered in a fenced block, with `(moved: now 18-20)` or
`(stale: showing the original range)` after the heading when trust says
so; when the content cannot be read, one line says so. `--json` carries
`ref` as the API's `apiRef` plus `lines`. Resolution for `serve` reuses
`resolveRef` by moving it (and `unverifiable`) onto a small `refResolver`
shared by the API server and `printRound`. Alternative: print only the
location — the agent then opens the file for every line comment, which is
the step this feature exists to remove.

### D9. Composer label and chip wording

Destination: `new thread on src/x.ts:16-18 in n2:s4`; a reply ref's
drawer uses its thread's target. The thread header shows the target chip
and, under it, a code chip `src/x.ts:16-18` with the trust badge, built
with the same markup as reply ref chips (`.mref`) and the same
`openReplyRef`-style path: `setActive(card)`, `selectId`, then
`openCode("comment=<id>")`.

### D10. Golden plates and the generated fixture

Hand-written: `line-comments` (a valid two-round plate: a bare line
comment, a follow-up inheriting it, replies; `expected.json` asserts
rounds and threads), `review-ref-anchor` (`review.ref`),
`review-ref-on-followup` (`review.thread`). Generated: `cli-authored`
grows a round-2 line comment posted through the API handler in
`e2e_test.go` (so it carries a real fingerprint against `../repo`) and
its reply; the README's recipe already deletes `review*.json`.

## Risks / Trade-offs

- [A hand-written ref without `fp` could be served as `exact` by accident]
  → `resolveRef` short-circuits on an empty `fp` before `Trust`; a test
  pins `unverified`.
- [The reader builds a ref string from `at` and numbers; a wrong `at`
  would post a ref on the wrong side] → `at` is derived from the same
  parsed `Ref` the drawer loaded its lines through, in one helper, tested
  for the plain, worktree, range-head and range-base cases.
- [Shift-click in a `<pre>` selects text in the browser] → the gutter
  spans are `user-select: none` and the handler calls `preventDefault`
  on shift-clicks.
- [`docs/demo` shim has no comment-ref snapshots] → `make.sh` snapshots
  `api/code?comment=<id>` for each line comment like it does reply refs,
  and `shim.js` routes `comment=` to them.
- [The skill transcript's round-2 review changes; the executed test asserts
  two answered rounds] → the test gains the second round-2 comment and
  its reply; it asserts the comment carries a ref (bare, since the review
  is hand-written).
- [Thread focus on selection: selecting lines that already have a thread
  should focus it] → `onSelectionMoved` runs on line selection too, with
  the ref in the match, so the composer offers a follow-up there.

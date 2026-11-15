# Tasks

## 1. Protocol: comment refs (TDD)

- [x] 1.1 Red: `thread_test.go` cases — a comment with `"ref": {"ref":
      "src/a.ts:1-3", "fp": …, "lines": […]}` (copied from an existing
      stored ref) parses and `Round.Ref(i)` returns it; a bare
      `{"ref": "src/a.ts:2"}` parses; `src/a.ts` (no range) → `ref.syntax`;
      `src/a.ts:1-3 @cache` → `review.ref`; `"fp": "nope"` →
      `ref.fp.invalid`; a ref on a `ledger:…#base` target parses; green:
      `ReviewComment.Ref *NibbleRef`, checks in `NextRound` (reusing
      `checkStoredRefShape` only when `fp` is set), `CodeReviewRef` in
      `errors.go`; verify `go test ./internal/protocol`
- [x] 1.2 Red: continuation cases — a follow-up with no ref resolves to the
      opener's ref via `Round.Ref`; a follow-up carrying a ref →
      `review.thread`; `Threads()` carries the opener's ref on the thread;
      green: implement
- [x] 1.3 Golden plates: `line-comments` (valid two-round plate with a bare
      line comment, a follow-up inheriting it, replies; `expected.json`
      with rounds and threads), `review-ref-anchor` (`review.ref`),
      `review-ref-on-followup` (`review.thread`); verify `TestGolden` passes
      and fails when an expected code is edited
- [x] 1.4 `protocol/PROTOCOL.md`: the review-thread section documents the
      comment `ref` (form, optional fingerprint, no anchor, inherited by a
      follow-up), `review.ref` joins the error index; verify every code
      named in the doc exists in `errors.go` (grep)

## 2. HTTP API: refs on comments, addresses, the POST (TDD)

- [x] 2.1 Red: `http_test.go` — `refAt` cases: plain, worktree, range head,
      range base; `/api/code` for a nibble ref and a reply ref and
      `/api/ledger` for head and base rows each carry the expected `at`;
      every ref in `/api/plate` carries `at`; green: `refAt(protocol.Ref)
      string`, added to `apiRef` and both drawer responses
- [x] 2.2 Red: `/api/plate` — a fingerprinted comment ref whose lines moved
      shows `ref` with trust `shifted` and the new `line`; a bare ref shows
      `unverified`; a follow-up shows the opener's ref; a comment without
      one has no `ref` key; green: resolve comment refs in `servePlate`
      through `resolveRef`, which returns `unverified` when `fp` is empty
- [x] 2.3 Red: `/api/code?comment=1.1` returns the lines with 15-19 in-range
      and trust; `?comment=2.1` on a follow-up returns the opener's lines;
      a bare ref returns the lines with `unverified`; unknown id or a
      comment without a ref → 404; green: implement in `serveCode`
- [x] 2.4 Red: `POST /api/review` — a comment with `{"ref": {"ref":
      "src/pool.ts:3-4"}}` lands with `fp1:` and hashes and reads `exact`;
      on a missing root it lands bare and reads `unverified`; past EOF →
      400 `ref.range.beyond-eof` nothing written; an anchor → 400
      `review.ref`; a follow-up with a ref → 400 `review.thread`; green:
      verify and fingerprint in `serveReview` before `NextRound`, reusing
      `add`'s pipeline
- [x] 2.5 `cli/README.md`: the API table rows for `at`, `?comment=`, and
      the comment `ref` on POST; verify the documented curl calls run
      against the `line-comments` golden plate

## 3. CLI: serve prints the lines; reply lists them (TDD)

- [x] 3.1 Red: `serve_test.go` — a round whose comment 1 carries a bare ref
      prints `## n2:s4 · src/upload/handler.ts:16-18 · 1.1` and quotes
      lines 16-18 numbered before the text; a fingerprinted ref resolving
      `shifted +2` says the lines moved and quotes 18-20; with the root
      missing the section says the lines could not be read; `--json`
      carries `ref` with `trust` and `lines`; green: a `refResolver`
      shared by the API server and `printRound`
- [x] 3.2 Red: `reply_test.go` — `reply.target`'s comment listing names a
      line comment's location; green: `listComments` prints `Round.Ref`;
      verify the existing reply cases pass unchanged

## 4. Reader: chat seams for lines (TDD, node suite)

- [x] 4.1 Red: `chat.test.ts` — `buildThreads` carries the opener's `ref`
      on the thread; drafts carry `ref` and group by target+ref
      (`new:<target>|<ref>`); `sentThreadOn(threads, target, ref)` matches
      only when both agree; `draftComments` emits `{target, ref: {ref},
      text}`; `composerDestination`-level helper `destinationLabel` reads
      `new thread on src/x.ts:16-18 in n2:s4`; green: implement
- [x] 4.2 Red: `drawerBadges(threads, at, lineNos)` — a thread whose ref
      has the drawer's `at` and resolves exact badges its first line; a
      `shifted +2` ref badges the shifted first line; another file's
      thread is skipped; counts sum per line; green: implement
- [x] 4.3 Red: `lineSelection` reducer — click selects one line,
      shift-click extends to a contiguous range either way, clicking the
      only selected line clears, a new drawer resets; green: implement in
      `chat.ts` so the shell only applies it

## 5. Reader: the review gutter and line threads

- [x] 5.1 Shell: `.no` gutter spans are buttons (`role=button`,
      `user-select: none`); click and shift-click drive the reducer; the
      selected rows get `.sel`; `openCode`, `openLedgerDrawer` and
      `closeDrawer` reset the selection; `esc` clears lines before the
      drawer; the drawer keeps `at` from the response; verify by selecting
      a range in a nibble ref's drawer and in a ledger base-side drawer
- [x] 5.2 Shell: the composer prefers the line selection — label, draft
      `ref` built as `<at>:<start>-<end>` (single line `:<start>`), target
      the current target (a reply ref's drawer uses its thread's target);
      `onSelectionMoved` includes the ref so an existing line thread is
      focused; verify by holding a draft on lines and reading the POST body
      in the network panel
- [x] 5.3 Shell: thread headers show a code chip (`.mref` markup, trust
      badge) under the target chip when the opener has a ref; activating
      it does `setActive`, `selectId`, `openCode("comment=<id>")`; verify
      on the `line-comments` golden plate
- [x] 5.4 Shell: gutter badges — after every drawer render and on each
      `"thread"` arrival plan, apply `drawerBadges` to the shown rows; a
      badge opens the panel focused on its thread; verify with a reply
      landing while the drawer is open
- [x] 5.5 Styles: `.no` hover and `.sel` rows (both themes), the gutter
      badge, the thread code chip; rebuild `app.js` (`npm run build`),
      copy to `docs/visuals`, verify `npm test`, `cmp` of both bundles, and
      the Go suite with the committed bundle

## 6. Skill: line comments in the review

- [x] 6.1 SKILL.md "## The review": the line form as `serve` prints it (the
      location on the heading, the quoted lines), what it means and how
      to answer it (`--ref` on the lines, or on what replaced them); "## A
      worked conversation": round 2 gains a second comment, a line comment
      on `src/upload/handler.ts` inside the try, shown as `serve` prints it
      and as `review.2.json`, with its reply; verify the section against
      the CLI's real output
- [x] 6.2 Red: `TestSkillConversationTranscript` writes the new round-2
      review, runs both replies and asserts the plate ends with two
      answered rounds and comment 2.2 carrying a ref; green: make it pass;
      verify `TestSkillTranscript` and the `setup_test.go` content check
      still pass

## 7. Generated fixture and the live demo

- [x] 7.1 Extend `cli-authored` through `e2e_test.go`: round 2 gains a line
      comment posted through the API handler (so it carries a real
      fingerprint against `../repo`) and its reply; `expected.json` keeps
      three rounds, threads become three; verify `TestGolden` and the
      README recipe
- [x] 7.2 `docs/demo/make.sh`: round 2 posts a line comment through the API
      and replies; snapshot `api/code?comment=<id>`; `shim.js` routes
      `comment=` to the snapshot; verify `docs/visuals/reader.html` opens
      from `file://` with the line thread, its chip opening the drawer, and
      a gutter badge on the lines

## 8. Site pages

- [x] 8.1 `docs/guide/answering.html`: a "Comment on lines" section — the
      gutter, the range, the code chip in the thread, the badge in the
      drawer; `docs/guide/reading.html`: the drawer paragraph and the key
      table (click a line number, shift-click a range, `esc` order);
      `docs/guide/agents.html`: the comment `ref` in the round, the quoted
      lines in `serve`'s output, `?comment=` and `at` in the API table;
      verify each page renders and links resolve
- [x] 8.2 `docs/index.html` / `docs/guide/index.html` wording: wherever a
      comment is described as pinned to a nibble or element, say lines too;
      verify no page says comments cannot name lines

## Workflow follow-up

- Archive the change (`/opsx:archive`), mark **Line-level comments** done
  in `docs/roadmap.html`, then commit, push and open the PR, per CLAUDE.md.

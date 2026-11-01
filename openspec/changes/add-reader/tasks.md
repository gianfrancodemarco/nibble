# Tasks

## 1. Server: plate + code endpoints

- [x] 1.1 Red: `http_test.go` — `/api/plate` on a real plate (worktree +
  diff refs): header fields, nibble order, trust `exact`; rewrite a
  referenced line → that ref `stale`, others untouched; diff ref computed
  via git. `/api/code`: range + clamped ±3 context, in-range flags, 404 on
  unknown nibble/ref index.
- [x] 1.2 Green: `http.go` — handler struct over plate dir + gitRepo,
  `GET /api/plate`, `GET /api/code`, CLI-shaped JSON errors.

## 2. Server: review + events

- [x] 2.1 Red: POST `/api/review` happy path writes review.json atomically;
  unknown verdict → 400 `review.verdict.unknown`, nothing written; second
  review → 409 `review.exists`, original intact. SSE: connect, write
  n3.json / done / review.json → `nibble`, `sealed`, `review` events arrive
  within 2s.
- [x] 2.2 Green: review handler (flock + tmp/rename like `add`), SSE handler
  on the 250ms poll; add `review.exists` to protocol errors + PROTOCOL.md
  index (TestErrorCodeIndex goes green).

## 3. serve wiring

- [x] 3.1 Red: `serve` on an open plate prints `reader: http://127.0.0.1:…`
  to stderr, stdout silent until review; POSTing a review to that URL ends
  serve with the verdict's exit code; `--no-ui` serves nothing; `--addr`
  pins the port. Extend TestEndToEnd: review arrives via HTTP POST.
- [x] 3.2 Green: listener + http.Server lifecycle in RunServe (start before
  wait, shut down after), flags `--addr`, `--no-ui`.
- [x] 3.3 Two-step review in the shell: verdict buttons select (nothing
  posted, serve keeps running); an explicit send button POSTs the review —
  only then does serve print it and exit. Exit codes unchanged.
- [x] 3.4 Reviewed plates stay viewable: with the UI on, a pre-existing
  review means read-only serving (review shown, input locked) until
  interrupt/timeout, exiting with the verdict's code; `--no-ui` keeps the
  print-and-exit resume path.

## 4. Reader UI shell

- [x] 4.1 `reader/` workspace: pinned tsc, `npm run build` →
  `cli/internal/cmd/ui/app.js`; `ui/index.html` + `ui/style.css` authored,
  `app.js` committed. Shell: canvas + camera stepping, visual summary cards
  with anchors, code drawer with trust badges, comments + verdict POST,
  locked state, SSE refresh.
- [x] 4.2 Go tests: `/` serves the embedded shell (html + app.js + css reachable),
  API endpoints unaffected; run the shell against the e2e plate by hand once
  (document in PR notes).

## 5. Examples & CI

- [x] 5.1 Worked example: extend the e2e golden export — `review.json` in
  `golden/plates/cli-authored` now comes from the HTTP POST path.
- [x] 5.2 CI: node job — `npm ci && npm run build` in `reader/`, fail on
  `git diff` drift of `app.js`.

## 6. Serving from files (amendment)

- [x] 6.1 Red: root-without-git (plain ref exact + drawer code, base..head
  ref unverified with reason), root-missing (all unverified, review POST
  still works), relative `repo` resolved against the plate dir, and the
  committed golden fixture serving with `exact` refs.
- [x] 6.2 Green: `newAPIServer` resolves root (abs or plate-relative), uses
  git only when the root is itself a repo top-level; `resolveRef` degrades
  per ref; `/api/plate` reports source availability; UI: unverified badge,
  availability banner, drawer reason. Protocol docs: `repo` may be relative.
- [x] 6.3 Golden: export `cli-authored` with a `repo/` file snapshot and
  `"repo": "../repo"`, so it serves from the checkout.

## 7. Docs & site

- [x] 7.1 cli/README: serve section (`--addr`, `--no-ui`, URL on stderr),
  API table. PROTOCOL.md: `review.exists` (done in 2.2), pointer to the
  reader.
- [x] 7.2 Site: roadmap Reader → shipped; guide/receiving + reading pages
  reflect the real reader (URL line, drawer, trust badges, live follow);
  PRD decision-log/status note.

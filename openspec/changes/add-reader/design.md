# Design

## Server lives in `cli/internal/cmd`

The HTTP layer reuses what `add` already has (gitRepo, loadRefContent, error
conventions) and `serve` owns its lifecycle, so it goes in the same package
(`http.go` + `ui/` embed) instead of a new package that would need the git
helper extracted. TestErrorCodeIndex already greps this package, so any new
code stays documented.

## Trust is computed per request, server-side

`GET /api/plate` re-reads the plate and recomputes trust for every ref on
every call (and the UI refetches on SSE events), so the reader always shows
trust against the file as it is *now*. No caching: plates are small (≤12
nibbles) and local disk reads are cheap. The reader never sees hashes it
would have to interpret — it gets `{level, line, shift}`.

## The wait loop stays the single source of "done"

`POST /api/review` only writes `review.json` (atomically, tmp+rename, flock'd
like `add`). The existing 250ms poll loop notices the file and ends the
process — one code path whether the review came from the reader, a script,
or by hand. The HTTP server is shut down when the loop returns.

## SSE by polling, no fsnotify

The events endpoint polls the plate dir at the same 250ms cadence and diffs
a tiny snapshot (nibble count, sealed, review). Zero dependencies, same
latency budget as the wait loop (spec: within 2s). Events: `nibble`,
`sealed`, `review`.

## UI: vanilla TS, one output file, committed and embedded

- `reader/` holds `src/app.ts`, `tsconfig.json`, `package.json` with a pinned
  `typescript` devDependency; `npm run build` emits
  `cli/internal/cmd/ui/app.js`.
- `index.html` and `style.css` are authored directly in `ui/`; only `app.js`
  is generated. The compiled file is committed so `go install` and CI need no
  Node; a CI job rebuilds and fails on drift.
- No framework, no bundler: the shell is one file of DOM code against the
  JSON API. The canvas is a translated/scaled div; the "camera" is a CSS
  transform transition centering the active nibble card.

## API shapes

```
GET /api/plate → { "title", "about", "repo", "head_sha", "open", "total",
                   "review": {...}|null,
                   "nibbles": [{ "n", "caption", "because", "visual",
                     "refs": [{ "ref", "path", "start", "end", "anchor",
                                "trust": {"level","line","shift"} }] }] }
GET /api/code?n=2&ref=0 → { "ref", "path", "trust", "lines":
                   [{"no", "text", "in"}] }   // ±3 context lines
POST /api/review { "verdict", "comments": [{"target","text"}] }
                 → 200 {"ok":true} | 409 review.exists | 400 review.verdict.unknown
GET /api/events  → SSE: event nibble {"n":4} | sealed {"total":3} | review {"verdict":"changes"}
```

Errors use the CLI's `{"error":{"code","message"}}` shape with protocol codes.
Statuses: 400 validation, 404 unknown nibble/ref index, 409 `review.exists`.

// highlight.ts — language resolution from a path, and per-line HTML out of
// the vendored highlight.js. Tests run against the real grammars, loaded by
// run-node.cjs exactly as the browser loads them.

t("langOf: every mapped extension resolves to its language", () => {
  eq(langOf("internal/pool.go"), "go");
  eq(langOf("src/app.ts"), "typescript");
  eq(langOf("src/Card.tsx"), "typescript");
  eq(langOf("lib/util.js"), "javascript");
  eq(langOf("lib/Card.jsx"), "javascript");
  eq(langOf("scripts/gen.mjs"), "javascript");
  eq(langOf("scripts/run.cjs"), "javascript");
  eq(langOf("tools/fmt.py"), "python");
  eq(langOf("plate.json"), "json");
  eq(langOf(".github/workflows/ci.yaml"), "yaml");
  eq(langOf("config.yml"), "yaml");
  eq(langOf("README.md"), "markdown");
  eq(langOf("bin/setup.sh"), "bash");
  eq(langOf("bin/setup.bash"), "bash");
  eq(langOf("rc.zsh"), "bash");
  eq(langOf("ui/style.css"), "css");
  eq(langOf("docs/index.html"), "xml");
  eq(langOf("docs/page.htm"), "xml");
  eq(langOf("feed.xml"), "xml");
  eq(langOf("db/schema.sql"), "sql");
});

t("langOf: case-insensitive extension, unknown means no language", () => {
  eq(langOf("CMD/MAIN.GO"), "go");
  eq(langOf("notes.xyz"), null);
  eq(langOf("Makefile"), null, "no extension");
  eq(langOf("archive.tar.gz"), null);
  eq(langOf(""), null);
});

// --- highlightLines: per-line HTML out, line count always preserved ---

t("highlightLines: unknown language stays plain, fully escaped", () => {
  eq(highlightLines("notes.xyz", ["<b>", "a & b"]), ["&lt;b&gt;", "a &amp; b"]);
});

t("highlightLines: a missing hljs global degrades to escaped plain text", () => {
  const g = globalThis as { hljs?: unknown };
  const saved = g.hljs;
  try {
    g.hljs = undefined;
    eq(highlightLines("internal/pool.go", ["x := 1 // hi", "<b>"]), ["x := 1 // hi", "&lt;b&gt;"]);
  } finally {
    g.hljs = saved;
  }
});

t("highlightLines: one HTML string per input line, empty lines kept", () => {
  const out = highlightLines("src/app.ts", ["const a = 1;", "", "const b = 2;"]);
  eq(out.length, 3);
  ok(out[0].includes(">const</span>"), "keyword colored: " + out[0]);
  ok(out[1] === "" || !out[1].includes("</span>" + "x"), "empty line stays a line");
});

t("highlightLines: code text inside tokens is escaped", () => {
  const out = highlightLines("cmd/main.go", ['fmt.Println("<a> & b")']);
  eq(out.length, 1);
  ok(out[0].includes("&lt;a&gt; &amp; b"), "escaped inside the string token: " + out[0]);
  ok(!out[0].includes("<a>"), "no raw tag leaks");
});

// --- the spec's language scenarios, against the real grammars ---

const hasCm = (s: string) => s.includes("hljs-comment");
const hasKw = (s: string) => s.includes("hljs-keyword");
const hasStr = (s: string) => s.includes("hljs-string");

t("language follows the file path: // comments and keywords are Go's, not Python's", () => {
  const line = "return price // hot path";
  const go = highlightLines("internal/pool.go", [line])[0];
  ok(hasCm(go), "go comment: " + go);
  ok(hasKw(go), "go keyword: " + go);
  const py = highlightLines("internal/pool.py", [line])[0];
  ok(!hasCm(py), "// is not a python comment: " + py);
});

t("css: #fff is not a comment, /* brand */ is", () => {
  const out = highlightLines("ui/style.css", ["color: #fff; /* brand */"])[0];
  const cmAt = out.indexOf("hljs-comment");
  ok(cmAt !== -1, "block comment found: " + out);
  ok(out.indexOf("#fff") < cmAt, "#fff sits outside the comment token: " + out);
});

t("yaml # comment, sql -- comment, markdown heading", () => {
  // real line shapes: .github/workflows/release.yml, a query, this repo's README
  ok(hasCm(highlightLines("ci.yaml", ["go-version: '1.23'  # pinned"])[0]), "yaml comment");
  ok(hasCm(highlightLines("q.sql", ["SELECT 1; -- count them"])[0]), "sql comment");
  const md = highlightLines("README.md", ["## What it does"])[0];
  ok(md.includes("hljs-section"), "markdown heading token: " + md);
});

t("python # comment and triple-quoted string across lines", () => {
  ok(hasCm(highlightLines("fmt.py", ["x = 1  # offset"])[0]), "python comment");
  const out = highlightLines("fmt.py", ['s = """first', "middle", 'last"""', "done = True"]);
  ok(hasStr(out[1]), "middle line still string: " + out[1]);
  ok(hasStr(out[2]), "closing line still string: " + out[2]);
  ok(!hasStr(out[3]), "after the string, back to code: " + out[3]);
});

t("go raw string spans lines, every covered line colored", () => {
  const out = highlightLines("tpl.go", ["tpl := `first", "second", "third`", "x := 1"]);
  ok(hasStr(out[1]) && hasStr(out[2]), "raw string middle+end: " + out[1]);
  ok(!hasStr(out[3]), "after the raw string: " + out[3]);
});

t("ts block comment opened on line 3 closes on line 6; line 7 is code", () => {
  const lines = ["const a = 1;", "const b = 2;", "/* the plan:", "step one,", "then step", "two */", "const c = 3;"];
  const out = highlightLines("src/app.ts", lines);
  for (const i of [2, 3, 4, 5]) ok(hasCm(out[i]), `line ${i + 1} in the comment: ` + out[i]);
  ok(!hasCm(out[6]), "line 7 out of the comment: " + out[6]);
});

t("elision resets state: a new call starts clean", () => {
  // the segment after the gap starts inside what WAS a comment; a fresh
  // call must not carry the previous segment's state
  const before = highlightLines("src/app.ts", ["/* opened and never closed"]);
  ok(hasCm(before[0]), "first segment is a comment");
  const after = highlightLines("src/app.ts", ["const x = 1;"]);
  ok(!hasCm(after[0]), "second segment starts clean: " + after[0]);
  ok(hasKw(after[0]), "and highlights as code: " + after[0]);
});

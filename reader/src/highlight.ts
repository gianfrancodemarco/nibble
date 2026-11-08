// Per-language syntax highlighting: the seam between the served file path
// and the vendored highlight.js bundle. Pure and DOM-free so the node test
// build exercises it against the real grammars. The path decides the
// language — never content sniffing — and anything unmapped renders as
// plain escaped text.

// The vendored bundle (cli/internal/cmd/ui/highlight.min.js) defines a
// global `hljs`. It can be absent — a packaging mistake must degrade to
// plain text, never break the page.
interface HljsResult { value: string; }
interface Hljs {
  getLanguage(name: string): unknown;
  highlight(code: string, opts: { language: string; ignoreIllegals: boolean }): HljsResult;
}

// langOf: the highlight.js language name for a file path, or null for
// anything the reader does not highlight. Curation lives here: the bundle
// carries more grammars, but only these ten are ever used.
const HL_LANGS: Record<string, string> = {
  go: "go",
  ts: "typescript", tsx: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python",
  json: "json",
  yaml: "yaml", yml: "yaml",
  md: "markdown",
  sh: "bash", bash: "bash", zsh: "bash",
  css: "css",
  html: "xml", htm: "xml", xml: "xml",
  sql: "sql",
};

function langOf(path: string): string | null {
  const dot = path.lastIndexOf(".");
  if (dot <= 0 || dot === path.length - 1) return null;
  return HL_LANGS[path.slice(dot + 1).toLowerCase()] ?? null;
}

function escPlain(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// splitHighlighted: hljs highlights the excerpt whole (that is what keeps a
// multi-line comment or raw string colored on every line), but the drawer
// renders line divs. Walk the flat span markup, close the open spans at each
// newline and reopen them on the next line, so every returned line is
// well-formed HTML on its own.
function splitHighlighted(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = [];
  let cur = "";
  let i = 0;
  while (i < html.length) {
    const ch = html[i];
    if (ch === "\n") {
      lines.push(cur + "</span>".repeat(open.length));
      cur = open.join("");
      i++;
    } else if (ch === "<") {
      const end = html.indexOf(">", i);
      const tag = html.slice(i, end + 1);
      if (tag.startsWith("</")) open.pop();
      else open.push(tag);
      cur += tag;
      i = end + 1;
    } else {
      cur += ch;
      i++;
    }
  }
  lines.push(cur + "</span>".repeat(open.length));
  return lines;
}

// highlightLines: one call per contiguous excerpt — cross-line state lives
// inside the single hljs call, and an elided gap resets it because the next
// segment is its own call. Any doubt (no language, no bundle, a line-count
// mismatch) returns plainly escaped lines: line numbers must never shift.
// An empty line comes back as a single space so its row keeps its height.
function highlightLines(path: string, lines: string[]): string[] {
  const lang = langOf(path);
  const engine = (globalThis as { hljs?: Hljs }).hljs;
  const plain = (): string[] => lines.map((l) => escPlain(l) || " ");
  if (!lang || !engine || !engine.getLanguage(lang)) return plain();
  const out = splitHighlighted(engine.highlight(lines.join("\n"), { language: lang, ignoreIllegals: true }).value);
  return out.length === lines.length ? out.map((l) => l || " ") : plain();
}

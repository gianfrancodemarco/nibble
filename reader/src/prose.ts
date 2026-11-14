// Prose — the reader's tiny markdown, now with anchor links. Nibble titles
// and descriptions may name visual elements with [phrase](@id) (validated
// against the visual by the CLI; the reader trusts what it is served). This
// file is pure string logic, part of the node test build: no DOM access.

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// inline formatting over escaped text: bold/code/italic only, by design.
function mdLite(s: string): string {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*([^*]+)\*/g, "<i>$1</i>");
}

// One grammar with the Go validator (protocol prose.go): [phrase](@id), the
// id in the ref-anchor charset; backtick code spans shield their content.
const PROSE_LINK_RE = /\[([^\]]*)\]\(@([A-Za-z0-9_-]+)\)/g;
const CODE_SPAN_RE = /`[^`]*`/g;

// maskCodeSpans blanks code spans without shifting offsets, so link matches
// can be read back out of the original string.
function maskCodeSpans(md: string): string {
  return md.replace(CODE_SPAN_RE, (m) => " ".repeat(m.length));
}

// linkIds: the anchor ids a prose string links, in order.
function linkIds(md: string): string[] {
  const out: string[] = [];
  const masked = maskCodeSpans(md);
  for (const m of masked.matchAll(PROSE_LINK_RE)) out.push(m[2]);
  return out;
}

// proseToHtml renders nibble prose: mdLite plus the link rule. A link whose
// element is drawn at the current dial level becomes an interactive phrase;
// an undrawn one stays readable but inert (spec: prose links follow the
// dial). The id charset is attribute-safe by construction.
function proseToHtml(md: string, drawn: (id: string) => boolean): string {
  const masked = maskCodeSpans(md);
  let out = "";
  let at = 0;
  for (const m of masked.matchAll(PROSE_LINK_RE)) {
    const start = m.index!;
    out += mdLite(md.slice(at, start));
    const phrase = mdLite(md.slice(start + 1, start + 1 + m[1].length));
    out += drawn(m[2])
      ? `<a class="plink" data-link-anchor="${m[2]}" tabindex="0">${phrase}</a>`
      : `<span class="plink-inert">${phrase}</span>`;
    at = start + m[0].length;
  }
  return out + mdLite(md.slice(at));
}

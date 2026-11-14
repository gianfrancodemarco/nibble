// Prose anchor links: [phrase](@id) rendering and scanning (src/prose.ts).

const drawnAll = (_id: string): boolean => true;
const drawnNone = (_id: string): boolean => false;

t("linkIds finds ids in order", () => {
  eq(linkIds("[a](@x) then [b](@y)"), ["x", "y"]);
  eq(linkIds("no links here"), []);
});

t("linkIds ignores url links and code spans", () => {
  eq(linkIds("see [RFC](https://example.com)"), []);
  eq(linkIds("run `[x](@y)` verbatim"), []);
  eq(linkIds("`a](` then [real](@node)"), ["node"]);
});

t("proseToHtml renders a drawn link as an interactive phrase", () => {
  eq(
    proseToHtml("the [cache](@cache) misses", drawnAll),
    `the <a class="plink" data-link-anchor="cache" tabindex="0">cache</a> misses`,
  );
});

t("proseToHtml renders an undrawn link as inert text", () => {
  eq(
    proseToHtml("the [cache](@cache) misses", drawnNone),
    `the <span class="plink-inert">cache</span> misses`,
  );
});

t("proseToHtml escapes text and phrase", () => {
  eq(proseToHtml("a <b> & c", drawnAll), "a &lt;b&gt; &amp; c");
  eq(
    proseToHtml("[<i> & co](@x)", drawnAll),
    `<a class="plink" data-link-anchor="x" tabindex="0">&lt;i&gt; &amp; co</a>`,
  );
});

t("proseToHtml keeps bold, code and italic around and inside phrases", () => {
  eq(proseToHtml("**bold** and `code`", drawnAll), "<b>bold</b> and <code>code</code>");
  eq(
    proseToHtml("[**hot** path](@hot)", drawnAll),
    `<a class="plink" data-link-anchor="hot" tabindex="0"><b>hot</b> path</a>`,
  );
});

t("proseToHtml leaves code-span link text literal", () => {
  eq(proseToHtml("run `[x](@y)` verbatim", drawnAll), "run <code>[x](@y)</code> verbatim");
});

t("proseToHtml leaves url links as plain text", () => {
  eq(proseToHtml("see [RFC 42](https://example.com)", drawnAll), "see [RFC 42](https://example.com)");
});

t("mdLite still renders plain prose", () => {
  eq(mdLite("**b** `c` *i*"), "<b>b</b> <code>c</code> <i>i</i>");
  eq(mdLite("a < b"), "a &lt; b");
});

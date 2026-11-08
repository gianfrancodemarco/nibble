// The visual host — the seam between the shell and the per-kind renderers.
// Renderers register themselves in visualRenderers (one file per kind,
// concatenated by tsc in tsconfig order), mark addressable elements with
// data-anchor, and ask the host for code chips. Selection, comment targets
// and the drawer affordance are wired once, here. No top-level DOM access:
// this file is also part of the node-run test build.

interface AnchoredRef {
  anchor?: string;
  // display metadata renderers may show next to resolved code
  path?: string;
  trust?: { level: string; shift: number };
}
interface VisualSelection { card: number; id: string }

// The detail dial: two positions in v0.1. Overview draws only unlevelled
// elements; standard draws everything. Deep arrives in v0.2.
type DialLevel = "overview" | "standard";
const DIAL_DEFAULT: DialLevel = "standard";

function dialToggle(level: DialLevel): DialLevel {
  return level === "standard" ? "overview" : "standard";
}

// visibleAt: is an element with this `level` hint drawn at the dial level?
// Absent means overview — drawn everywhere.
function visibleAt(level: DialLevel, elLevel?: "standard"): boolean {
  return level === "standard" || elLevel === undefined;
}

// LevelledText is a plate's or nibble's description: the overview is the skim
// text, standard the fuller story shown at the dial's standard level.
interface LevelledText { overview: string; standard?: string }

// descriptionAt picks the description variant for a dial level. Fallback is
// downward only: standard falls back to overview; the overview never shows
// the long text. Null means nothing to show.
function descriptionAt(d: LevelledText | undefined, level: DialLevel): string | null {
  if (!d) return null;
  return level === "standard" ? d.standard ?? d.overview : d.overview;
}

interface RenderCtx {
  n: number; // nibble number, 1-based
  anchored: Map<string, number>; // anchor id → nibble ref index
  refs: readonly AnchoredRef[];
  level?: DialLevel; // absent means standard
  visited?: ReadonlySet<string>; // the host's per-session visited element ids
}

// --- visited dependents: session state, never persisted, never posted ---

// One set for the whole session: the same element id on two nibbles is the
// same thing looked at once. Renderers read it through RenderCtx.visited and
// re-badge in place on the "visitedchange" event; it never reaches the plate
// or the review.
const hostVisited = new Set<string>();

// markVisited records that the reader looked at an element. Returns whether
// that changed anything, so callers only re-badge on first visits.
function markVisited(id: string): boolean {
  if (hostVisited.has(id)) return false;
  hostVisited.add(id);
  return true;
}

// selectAndVisit: the selection click path. Selecting an element counts as
// looking at it — even a toggle-off looked first.
function selectAndVisit(cur: VisualSelection | null, card: number, id: string): VisualSelection | null {
  markVisited(id);
  return nextSelection(cur, card, id);
}

// openAndVisit: the code-chip path. Opening an element's code counts as
// looking at it; an id without code resolves to nothing and visits nothing.
function openAndVisit(ctx: RenderCtx, id: string): { n: number; ref: number } | null {
  const act = codeActivation(ctx, id);
  if (act) markVisited(id);
  return act;
}

// reviewBody builds the exact JSON the review POST sends: the comments,
// nothing else — visited state stays in this tab. No comments means done.
function reviewBody(comments: readonly { target?: string; text: string }[]): string {
  return JSON.stringify({ comments });
}

type RendererOf<K extends Visual["kind"]> = (v: Extract<Visual, { kind: K }>, ctx: RenderCtx) => Element;
const visualRenderers: { [K in Visual["kind"]]?: RendererOf<K> } = {};

// --- syntax highlight for the code drawers (pure seam, tested) ---
// A tiny line tokenizer, language-agnostic by design: comments, strings,
// numbers, a shared keyword set and call-position identifiers cover the
// TS/Go/Python-ish code plates usually quote; anything unrecognised stays
// plain text. Returns HTML with everything escaped.

const HL_KEYWORDS = new Set([
  // ts/js
  "const", "let", "var", "function", "return", "if", "else", "for", "while",
  "do", "new", "await", "async", "import", "from", "export", "default",
  "type", "interface", "class", "extends", "implements", "throw", "try",
  "catch", "finally", "switch", "case", "break", "continue", "typeof",
  "instanceof", "in", "of", "void", "delete", "yield", "static", "public",
  "private", "protected", "readonly", "enum", "null", "undefined", "true",
  "false", "this",
  // go
  "func", "package", "defer", "go", "chan", "range", "struct", "nil",
  "select", "fallthrough", "goto",
  // python
  "def", "elif", "None", "True", "False", "not", "and", "or", "is",
  "lambda", "with", "as", "pass", "raise", "global",
]);

function hlEsc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlightCode(line: string): string {
  const re = /(\/\/.*$|#.*$)|("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`(?:[^`\\]|\\.)*`?)|(\b\d[\w.]*)|([A-Za-z_$][\w$]*)/g;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    out += hlEsc(line.slice(last, m.index));
    const [, cm, str, num, id] = m;
    if (cm !== undefined) out += `<span class="cm">${hlEsc(cm)}</span>`;
    else if (str !== undefined) out += `<span class="str">${hlEsc(str)}</span>`;
    else if (num !== undefined) out += `<span class="num">${hlEsc(num)}</span>`;
    else if (HL_KEYWORDS.has(id)) out += `<span class="kw">${hlEsc(id)}</span>`;
    else if (/^\s*\(/.test(line.slice(re.lastIndex))) out += `<span class="fn">${hlEsc(id)}</span>`;
    else out += hlEsc(id);
    last = re.lastIndex;
  }
  out += hlEsc(line.slice(last));
  return out || " ";
}

// --- pure seam logic (covered by test/host.test.ts) ---

function anchorRefIndex(refs: readonly AnchoredRef[]): Map<string, number> {
  const m = new Map<string, number>();
  refs.forEach((r, i) => {
    if (r.anchor && !m.has(r.anchor)) m.set(r.anchor, i);
  });
  return m;
}

function nextSelection(cur: VisualSelection | null, card: number, id: string): VisualSelection | null {
  if (cur && cur.card === card && cur.id === id) return null;
  return { card, id };
}

function commentTarget(n: number, sel: VisualSelection | null, card: number): string {
  return sel && sel.card === card ? `n${n}:${sel.id}` : `n${n}`;
}

// anchorDrawnAt: is the element with this stable id drawn at the dial level?
// Ids that never carry a level (actors, compare sides, state names) are
// always drawn; an id the visual does not declare is not drawn.
function anchorDrawnAt(v: Visual, id: string, level: DialLevel): boolean {
  if (v.kind === "map") {
    const n = v.nodes.find((x) => x.id === id);
    return n !== undefined && visibleAt(level, n.level);
  }
  if (v.kind === "sequence") {
    if (v.actors.some((a) => a.id === id)) return true;
    const s = v.steps.find((x) => x.id === id);
    return s !== undefined && visibleAt(level, s.level);
  }
  if (v.kind === "timeline") {
    const lane = v.lanes.find((l) => l.id === id);
    if (lane) return visibleAt(level, lane.level);
    const laneHidden = (laneId: string) => {
      const l = v.lanes.find((x) => x.id === laneId);
      return l !== undefined && !visibleAt(level, l.level);
    };
    const inSet = (events: TimelineEvents | undefined) =>
      events?.find((e) => e.id === id);
    const e = inSet(v.events) ?? v.states?.reduce<ReturnType<typeof inSet>>((hit, s) => hit ?? inSet(s.events), undefined);
    if (e) return visibleAt(level, e.level) && !laneHidden(e.lane);
    return v.states?.some((s) => s.name === id) ?? false;
  }
  return id === "before" || id === "after";
}

// selectionAfterDial: a selection survives a dial turn only while its element
// is still drawn; otherwise it clears (and the comment target falls back).
function selectionAfterDial(
  sel: VisualSelection | null,
  visualOf: (card: number) => Visual | null,
  level: DialLevel,
): VisualSelection | null {
  if (!sel) return null;
  const v = visualOf(sel.card);
  if (!v) return null;
  return anchorDrawnAt(v, sel.id, level) ? sel : null;
}

// --- SVG helpers shared by the renderers ---

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  text?: string,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

// What activating an element's code affordance resolves to: the exact
// (nibble, ref index) pair the drawer endpoint takes, or null when the id
// carries no anchored ref.
function codeActivation(ctx: RenderCtx, id: string): { n: number; ref: number } | null {
  const refIdx = ctx.anchored.get(id);
  return refIdx === undefined ? null : { n: ctx.n, ref: refIdx };
}

// A small "code" pill renderers place inside an element whose id a nibble
// ref anchors. Clicking it opens the drawer on that ref (wired below);
// returns null when the id carries no code.
function codeChip(ctx: RenderCtx, id: string, x: number, y: number): SVGGElement | null {
  const act = codeActivation(ctx, id);
  if (!act) return null;
  const g = svgEl("g", {
    class: "code-chip", "data-code": act.ref, "data-n": act.n,
    transform: `translate(${x} ${y})`, role: "button", tabindex: 0,
  });
  g.appendChild(svgEl("title", {}, "open the code this element references"));
  g.appendChild(svgEl("rect", { x: 0, y: -9, width: 26, height: 15, rx: 7.5 }));
  g.appendChild(svgEl("text", { x: 13, y: 3, "text-anchor": "middle" }, "</>"));
  return g;
}

// HTML flavour of the code chip, for renderers whose chrome is HTML.
function codeChipHTML(ctx: RenderCtx, id: string): HTMLButtonElement | null {
  const act = codeActivation(ctx, id);
  if (!act) return null;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "code-chip-h";
  b.dataset.code = String(act.ref);
  b.dataset.n = String(act.n);
  b.textContent = "</>";
  b.title = "open the code this side references";
  return b;
}

// --- dispatch + shell wiring ---

function renderVisualBody(v: Visual, ctx: RenderCtx): Element | null {
  const r = visualRenderers[v.kind] as ((v: Visual, ctx: RenderCtx) => Element) | undefined;
  return r ? r(v, ctx) : null;
}

let hostSelection: VisualSelection | null = null;

interface HostWiring {
  openRef: (n: number, ref: number) => void;
  onTarget: () => void; // re-derive the comment target from hostSelection
}

function applySelection(strip: HTMLElement): void {
  strip.querySelectorAll<HTMLElement>(".nibble").forEach((card) => {
    const idx = Number(card.dataset.i);
    const selId = hostSelection && hostSelection.card === idx ? hostSelection.id : null;
    card.classList.toggle("has-sel", selId !== null);
    card.querySelectorAll("[data-anchor]").forEach((el) => {
      el.classList.toggle("sel", selId !== null && el.getAttribute("data-anchor") === selId);
    });
    const body = card.querySelector(".visual-body");
    if (body) body.dispatchEvent(new CustomEvent("anchorselection", { detail: { id: selId } }));
  });
}

// applyVisited: tell every rendered visual to re-badge in place — class
// toggles on fixed positions, never a re-render.
function applyVisited(strip: HTMLElement): void {
  strip.querySelectorAll(".visual-body").forEach((body) => {
    body.dispatchEvent(new CustomEvent("visitedchange", { detail: { visited: hostVisited as ReadonlySet<string> } }));
  });
}

function clearVisualSelection(strip: HTMLElement, wiring: HostWiring): void {
  if (!hostSelection) return;
  hostSelection = null;
  applySelection(strip);
  wiring.onTarget();
}

function wireVisualHost(strip: HTMLElement, wiring: HostWiring): void {
  strip.addEventListener("click", (e) => {
    const t = e.target as Element | null;
    if (!t) return;
    const chip = t.closest("[data-code]");
    if (chip) {
      e.stopPropagation();
      const anchorId = chip.closest("[data-anchor]")?.getAttribute("data-anchor");
      if (anchorId && markVisited(anchorId)) applyVisited(strip);
      wiring.openRef(Number(chip.getAttribute("data-n")), Number(chip.getAttribute("data-code")));
      return;
    }
    const el = t.closest("[data-anchor]");
    const card = t.closest<HTMLElement>(".nibble");
    if (!card) return;
    if (el) {
      const id = el.getAttribute("data-anchor");
      if (id) {
        const first = !hostVisited.has(id);
        hostSelection = selectAndVisit(hostSelection, Number(card.dataset.i), id);
        applySelection(strip);
        if (first) applyVisited(strip);
        wiring.onTarget();
      }
    } else if (hostSelection && hostSelection.card === Number(card.dataset.i)) {
      // background click inside the card clears its selection
      clearVisualSelection(strip, wiring);
    }
  });
  strip.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const chip = (e.target as Element | null)?.closest?.("[data-code]");
    if (chip) {
      e.preventDefault();
      const anchorId = chip.closest("[data-anchor]")?.getAttribute("data-anchor");
      if (anchorId && markVisited(anchorId)) applyVisited(strip);
      wiring.openRef(Number(chip.getAttribute("data-n")), Number(chip.getAttribute("data-code")));
    }
  });
}

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

// --- prose ↔ visual links: the two-way hover handshake ---

// hoverCounterpart: what the other side of the handshake is, as a selector
// scoped to the hovered node's card. A prose phrase (data-link-anchor)
// lights its element; an addressable element (data-anchor) lights every
// phrase that names it; anything else lights nothing. Ids are in the
// ref-anchor charset, so they are selector-safe.
function hoverCounterpart(linkAnchor: string | null, anchor: string | null): string | null {
  if (linkAnchor) return `[data-anchor="${linkAnchor}"]`;
  if (anchor) return `.plink[data-link-anchor="${anchor}"]`;
  return null;
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

// codeChipSelector: the card-scoped selector for an anchored element's code
// chip. Chips carry data-for so the chip is findable from the element's id
// alone — the compare renderer places its chip beside, not inside, the
// [data-anchor] node. Ids share the ref-anchor charset: selector-safe.
function codeChipSelector(id: string): string {
  return `[data-code][data-for="${id}"]`;
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
    class: "code-chip", "data-code": act.ref, "data-n": act.n, "data-for": id,
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
  b.dataset.for = id;
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
    // linked phrases follow the selection, so prose and picture read as one
    card.querySelectorAll(".plink").forEach((el) => {
      el.classList.toggle("sel", selId !== null && el.getAttribute("data-link-anchor") === selId);
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

// HostController: what the shell may drive from outside the strip — the
// chat panel's target chips and reply links select through the same path
// a click takes, so targets and visited state cannot diverge.
interface HostController {
  // select the element; force keeps an existing selection instead of
  // toggling it off
  select: (card: HTMLElement, id: string, force?: boolean) => void;
}

function wireVisualHost(strip: HTMLElement, wiring: HostWiring): HostController {
  // selectId: the one selection path — element clicks and prose-link clicks
  // both land here, so targets and visited state cannot diverge.
  const selectId = (card: HTMLElement, id: string, force = false): void => {
    const idx = Number(card.dataset.i);
    if (force && hostSelection && hostSelection.card === idx && hostSelection.id === id) return;
    const first = !hostVisited.has(id);
    hostSelection = selectAndVisit(hostSelection, idx, id);
    applySelection(strip);
    if (first) applyVisited(strip);
    wiring.onTarget();
    // a fresh selection also opens the element's code, when it carries any;
    // a toggle-off never does, and the chip's own path stays select-free
    if (hostSelection) openCodeOf(card, id);
  };
  // openCodeOf: open the code an element carries, if any
  const openCodeOf = (card: HTMLElement, id: string): void => {
    const chip = card.querySelector(codeChipSelector(id));
    if (chip) wiring.openRef(Number(chip.getAttribute("data-n")), Number(chip.getAttribute("data-code")));
  };
  // A sequence step revealed — by click, space or the ▸ ◂ controls — is
  // selected and its code opens, every time: a step is a place in the
  // story and its code comes with it, even when the step was already the
  // selection or the drawer had been closed.
  strip.addEventListener("seqstep", (e) => {
    const id = (e as CustomEvent<{ id: string | null }>).detail.id;
    const card = (e.target as Element | null)?.closest?.<HTMLElement>(".nibble");
    if (!id || !card) return;
    const idx = Number(card.dataset.i);
    const again = hostSelection !== null && hostSelection.card === idx && hostSelection.id === id;
    selectId(card, id, true);
    if (again) openCodeOf(card, id);
  });
  strip.addEventListener("click", (e) => {
    if (e.defaultPrevented) return; // a renderer handled the click itself
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
    // either side of the prose ↔ visual handshake selects the element
    const el = t.closest("[data-anchor]") ?? t.closest(".plink[data-link-anchor]");
    const card = t.closest<HTMLElement>(".nibble");
    if (!card) return;
    if (el) {
      const id = el.getAttribute("data-anchor") ?? el.getAttribute("data-link-anchor");
      if (id) selectId(card, id);
    } else if (hostSelection && hostSelection.card === Number(card.dataset.i)) {
      // background click inside the card clears its selection
      clearVisualSelection(strip, wiring);
    }
  });
  strip.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const t = e.target as Element | null;
    const chip = t?.closest?.("[data-code]");
    if (chip) {
      e.preventDefault();
      const anchorId = chip.closest("[data-anchor]")?.getAttribute("data-anchor");
      if (anchorId && markVisited(anchorId)) applyVisited(strip);
      wiring.openRef(Number(chip.getAttribute("data-n")), Number(chip.getAttribute("data-code")));
      return;
    }
    // Enter on a focused prose link selects, like clicking it (a .plink is
    // an <a> without href, so the browser gives it no default activation)
    if (e.key !== "Enter") return;
    const pl = t?.closest?.(".plink[data-link-anchor]");
    const card = t?.closest?.<HTMLElement>(".nibble");
    const id = pl?.getAttribute("data-link-anchor");
    if (pl && card && id) {
      e.preventDefault();
      selectId(card, id);
    }
  });

  // The two-way hover: a prose phrase lights its element, an element lights
  // its phrases. Idempotent relight (clear, then mark) on delegated events,
  // so rebuilt cards and live arrivals need no re-wiring; keyboard focus
  // takes the same path as the pointer.
  let litNode: Element | null = null;
  const hoverNode = (t: EventTarget | null): Element | null =>
    t instanceof Element ? t.closest("[data-link-anchor], [data-anchor]") : null;
  const relight = (node: Element | null): void => {
    if (node === litNode) return;
    strip.querySelectorAll(".lit").forEach((el) => el.classList.remove("lit"));
    litNode = node;
    if (!node) return;
    const sel = hoverCounterpart(node.getAttribute("data-link-anchor"), node.getAttribute("data-anchor"));
    const card = node.closest(".nibble");
    if (!sel || !card) return;
    card.querySelectorAll(sel).forEach((el) => el.classList.add("lit"));
  };
  strip.addEventListener("mouseover", (e) => relight(hoverNode(e.target)));
  strip.addEventListener("mouseout", (e) => {
    if (!hoverNode((e as MouseEvent).relatedTarget)) relight(null);
  });
  strip.addEventListener("focusin", (e) => relight(hoverNode(e.target)));
  strip.addEventListener("focusout", (e) => {
    if (!hoverNode((e as FocusEvent).relatedTarget)) relight(null);
  });
  return { select: selectId };
}

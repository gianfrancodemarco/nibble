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
      wiring.openRef(Number(chip.getAttribute("data-n")), Number(chip.getAttribute("data-code")));
      return;
    }
    const el = t.closest("[data-anchor]");
    const card = t.closest<HTMLElement>(".nibble");
    if (!card) return;
    if (el) {
      const id = el.getAttribute("data-anchor");
      if (id) {
        hostSelection = nextSelection(hostSelection, Number(card.dataset.i), id);
        applySelection(strip);
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
      wiring.openRef(Number(chip.getAttribute("data-n")), Number(chip.getAttribute("data-code")));
    }
  });
}

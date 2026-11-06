// map — services and modules as tiered columns. Layout is pure (tested in
// test/map.test.ts); rendering builds SVG on top of it and registers with
// the host.

interface LaidOutNode { id: string; x: number; y: number; w: number; h: number; }
interface MapLayout { w: number; h: number; nodes: LaidOutNode[]; }

const MAP_TIERS = ["edge", "service", "data"] as const;

function layoutMap(v: MapVisual): MapLayout {
  const PAD = 24, VGAP = 22, HGAP = 90, NODE_H = 46;
  const nodeW = (n: MapNode) => Math.max(96, 20 + n.label.length * 7.5 + 40);
  const colOf = (n: MapNode) => n.tier ?? "service";
  const present = MAP_TIERS.filter((t) => v.nodes.some((n) => colOf(n) === t));

  // Within a column: declaration order, with group members pulled together
  // at the first member's position.
  const cols = present.map((tier) => {
    const list = v.nodes.filter((n) => colOf(n) === tier);
    const ordered: MapNode[] = [];
    const used = new Set<string>();
    for (const n of list) {
      if (used.has(n.id)) continue;
      if (n.group) {
        for (const m of list) {
          if (m.group === n.group && !used.has(m.id)) { ordered.push(m); used.add(m.id); }
        }
      } else {
        ordered.push(n);
        used.add(n.id);
      }
    }
    return ordered;
  });

  const colW = cols.map((c) => Math.max(...c.map(nodeW)));
  const colH = cols.map((c) => c.length * NODE_H + (c.length - 1) * VGAP);
  const h = Math.max(...colH) + PAD * 2;
  const nodes: LaidOutNode[] = [];
  let x = PAD;
  cols.forEach((c, i) => {
    let y = Math.round((h - colH[i]) / 2);
    for (const n of c) {
      nodes.push({ id: n.id, x, y, w: nodeW(n), h: NODE_H });
      y += NODE_H + VGAP;
    }
    x += colW[i] + HGAP;
  });
  return { w: x - HGAP + PAD, h, nodes };
}

// mapDrawnBoxes: the laid-out boxes drawn at a dial level. Layout is always
// computed from the full document, so a box never moves between levels — the
// dial only changes which boxes are drawn.
function mapDrawnBoxes(v: MapVisual, level: DialLevel): LaidOutNode[] {
  const drawn = new Set(v.nodes.filter((n) => visibleAt(level, n.level)).map((n) => n.id));
  return layoutMap(v).nodes.filter((b) => drawn.has(b.id));
}

// mapDrawnEdgeIdx: indices into v.edges of the edges drawn at a dial level —
// the edge's own level, and both endpoints, must be visible.
function mapDrawnEdgeIdx(v: MapVisual, level: DialLevel): number[] {
  const drawn = new Set(v.nodes.filter((n) => visibleAt(level, n.level)).map((n) => n.id));
  const out: number[] = [];
  (v.edges ?? []).forEach((e, i) => {
    if (visibleAt(level, e.level) && drawn.has(e.from) && drawn.has(e.to)) out.push(i);
  });
  return out;
}

// --- rendering ---

function mapEdgeEnds(a: LaidOutNode, b: LaidOutNode): { x1: number; y1: number; x2: number; y2: number; horizontal: boolean } {
  if (b.x >= a.x + a.w) return { x1: a.x + a.w, y1: a.y + a.h / 2, x2: b.x - 7, y2: b.y + b.h / 2, horizontal: true };
  if (a.x >= b.x + b.w) return { x1: a.x, y1: a.y + a.h / 2, x2: b.x + b.w + 7, y2: b.y + b.h / 2, horizontal: true };
  if (b.y > a.y) return { x1: a.x + a.w / 2, y1: a.y + a.h, x2: b.x + b.w / 2, y2: b.y - 7, horizontal: false };
  return { x1: a.x + a.w / 2, y1: a.y, x2: b.x + b.w / 2, y2: b.y + b.h + 7, horizontal: false };
}

let mapIdSeq = 0;

function renderMapVisual(v: MapVisual, ctx: RenderCtx): Element {
  const level = ctx.level ?? "standard";
  const l = layoutMap(v); // full document: positions never depend on the dial
  const drawnNodes = new Set(mapDrawnBoxes(v, level).map((b) => b.id));
  const drawnEdges = new Set(mapDrawnEdgeIdx(v, level));
  const uid = `map${++mapIdSeq}`;
  const svg = svgEl("svg", {
    viewBox: `0 0 ${l.w} ${l.h}`, class: "vis-map",
    preserveAspectRatio: "xMidYMid meet", role: "img",
  });

  const defs = svgEl("defs");
  for (const [name, cls] of [["arr", "arr"], ["arrhl", "arr hl"]] as const) {
    const m = svgEl("marker", {
      id: `${uid}-${name}`, viewBox: "0 0 10 10", refX: 9, refY: 5,
      markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse",
    });
    m.appendChild(svgEl("path", { d: "M 0 0 L 10 5 L 0 10 z", class: cls }));
    defs.appendChild(m);
  }
  svg.appendChild(defs);

  const byId = new Map(l.nodes.map((n) => [n.id, n]));
  const edgesG = svgEl("g");
  (v.edges ?? []).forEach((e, ei) => {
    if (!drawnEdges.has(ei)) return;
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) return; // validation forbids this; stay defensive
    const { x1, y1, x2, y2, horizontal } = mapEdgeEnds(a, b);
    const d = horizontal
      ? `M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`
      : `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`;
    const g = svgEl("g", { class: `edge ${e.style ?? "flow"}`, "data-from": e.from, "data-to": e.to });
    g.appendChild(svgEl("path", { d, "marker-end": `url(#${uid}-arr)` }));
    if (e.label) {
      g.appendChild(svgEl("text", {
        x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 7, "text-anchor": "middle", class: "elabel",
      }, e.label));
    }
    edgesG.appendChild(g);
  });
  svg.appendChild(edgesG);

  const nodesG = svgEl("g");
  for (const n of v.nodes) {
    if (!drawnNodes.has(n.id)) continue;
    const b = byId.get(n.id);
    if (!b) continue;
    const g = svgEl("g", {
      class: "node" + (n.focus ? " focus" : ""),
      "data-anchor": n.id,
      transform: `translate(${b.x} ${b.y})`,
    });
    g.appendChild(svgEl("title", {}, n.detail ? `${n.label} — ${n.detail}` : n.label));
    g.appendChild(svgEl("rect", { width: b.w, height: b.h, rx: 10 }));
    g.appendChild(svgEl("text", { x: 12, y: b.h / 2 + 4.5 }, n.label));
    const chip = codeChip(ctx, n.id, b.w - 34, b.h / 2);
    if (chip) g.appendChild(chip);
    nodesG.appendChild(g);
  }
  svg.appendChild(nodesG);

  // Neighbourhood highlight: the host dims non-selected nodes; edges are
  // ours (they are not addressable anchors).
  svg.addEventListener("anchorselection", (e) => {
    const id = (e as CustomEvent<{ id: string | null }>).detail.id;
    svg.querySelectorAll<SVGGElement>(".edge").forEach((g) => {
      const incident = id !== null && (g.dataset.from === id || g.dataset.to === id);
      g.classList.toggle("hl", incident);
      g.classList.toggle("dim", id !== null && !incident);
      g.querySelector("path")?.setAttribute("marker-end", `url(#${uid}-${incident ? "arrhl" : "arr"})`);
    });
  });

  return svg;
}

visualRenderers.map = renderMapVisual;

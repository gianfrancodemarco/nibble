// map — services and modules as tiered columns. Layout is pure (tested in
// test/map.test.ts); rendering builds SVG on top of it and registers with
// the host.

interface LaidOutNode { id: string; x: number; y: number; w: number; h: number; }
interface RingZone { ring: "changed" | "dependent" | "rest"; x: number; y: number; w: number; h: number; }
interface MapLayout { w: number; h: number; nodes: LaidOutNode[]; zones?: RingZone[]; }

const MAP_TIERS = ["edge", "service", "data"] as const;
const MAP_NODE_H = 46;

function mapNodeW(n: MapNode): number {
  return Math.max(96, 20 + n.label.length * 7.5 + 40);
}

// Declaration order, with group members pulled together at the first
// member's position — the ordering discipline tiers and rings share.
function mapGroupOrder(list: MapNode[]): MapNode[] {
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
}

function layoutMap(v: MapVisual): MapLayout {
  const PAD = 24, VGAP = 22, HGAP = 90, NODE_H = MAP_NODE_H;
  const nodeW = mapNodeW;
  const colOf = (n: MapNode) => n.tier ?? "service";
  const present = MAP_TIERS.filter((t) => v.nodes.some((n) => colOf(n) === t));

  const cols = present.map((tier) => mapGroupOrder(v.nodes.filter((n) => colOf(n) === tier)));

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

// isRinged: a blast-radius map is one where every node declares its ring.
// Validation makes rings all-or-nothing, so any mixed document (which the
// protocol rejects) falls back to the tiered layout.
function isRinged(v: MapVisual): boolean {
  return v.nodes.every((n) => n.ring !== undefined);
}

// mapLayoutOf: the one layout dispatch — concentric rings for a ringed map,
// tiered columns otherwise.
function mapLayoutOf(v: MapVisual): MapLayout {
  return isRinged(v) ? layoutRingMap(v) : layoutMap(v);
}

// layoutRingMap: three concentric rectangular bands read inside-out — changed
// at the centre, dependents around it, the rest outside. Bands are stacks of
// rows (at most RING_ROW nodes each, so a crowded ring wraps instead of
// growing sideways); declaration order within a ring, exactly like columns
// in the tiered layout.
const RING_ROW = 3;

function layoutRingMap(v: MapVisual): MapLayout {
  const PAD = 10, ZPAD = 18, LABEL_H = 26, VGAP = 20, HGAP = 52, NODE_H = MAP_NODE_H;
  const ringOf = (ring: RingZone["ring"]) => mapGroupOrder(v.nodes.filter((n) => n.ring === ring));
  const chunk = (list: MapNode[]): MapNode[][] => {
    const out: MapNode[][] = [];
    for (let i = 0; i < list.length; i += RING_ROW) out.push(list.slice(i, i + RING_ROW));
    return out;
  };
  const split = (list: MapNode[]): [MapNode[][], MapNode[][]] => {
    const top = Math.ceil(list.length / 2);
    return [chunk(list.slice(0, top)), chunk(list.slice(top))];
  };
  const changed = chunk(ringOf("changed"));
  const [depTop, depBot] = split(ringOf("dependent"));
  const [restTop, restBot] = split(ringOf("rest"));
  const rowW = (list: MapNode[]) =>
    list.length ? list.reduce((s, n) => s + mapNodeW(n), 0) + (list.length - 1) * HGAP : 0;
  const stackW = (rows: MapNode[][]) => Math.max(0, ...rows.map(rowW));

  // Widths inside-out: each zone wraps the widest row it holds.
  const cW = stackW(changed) + 2 * ZPAD;
  const dW = Math.max(cW, stackW(depTop), stackW(depBot)) + 2 * ZPAD;
  const rW = Math.max(dW, stackW(restTop), stackW(restBot)) + 2 * ZPAD;
  const w = rW + 2 * PAD;

  // Positions top-down: restTop / depTop / changed / depBot / restBot, each
  // row centered, each zone reserving room for its label. placeStack returns
  // the y just below what it placed.
  const nodes: LaidOutNode[] = [];
  const placeStack = (rows: MapNode[][], y: number): number => {
    for (const row of rows) {
      let x = (w - rowW(row)) / 2;
      for (const n of row) {
        nodes.push({ id: n.id, x: Math.round(x), y, w: mapNodeW(n), h: NODE_H });
        x += mapNodeW(n) + HGAP;
      }
      y += NODE_H + VGAP;
    }
    return rows.length ? y - VGAP : y;
  };
  const rTop = PAD;
  let y = rTop + LABEL_H;
  if (restTop.length) y = placeStack(restTop, y) + VGAP;
  const dTop = y;
  y += LABEL_H;
  if (depTop.length) y = placeStack(depTop, y) + VGAP;
  const cTop = y;
  y = placeStack(changed, cTop + LABEL_H) + ZPAD;
  const cBot = y;
  if (depBot.length) y = placeStack(depBot, y + VGAP);
  const dBot = y + ZPAD;
  y = dBot;
  if (restBot.length) y = placeStack(restBot, y + VGAP);
  const rBot = y + ZPAD;

  const zones: RingZone[] = [
    { ring: "rest", x: PAD, y: rTop, w: rW, h: rBot - rTop },
    { ring: "dependent", x: (w - dW) / 2, y: dTop, w: dW, h: dBot - dTop },
    { ring: "changed", x: (w - cW) / 2, y: cTop, w: cW, h: cBot - cTop },
  ];
  return { w, h: rBot + PAD, nodes, zones };
}

// mapUnvisitedIds: the dependent nodes still carrying a badge — unvisited
// dependents of a ringed map, in declaration order. Only dependents badge:
// changed is what you came to read, rest is context; level plays no part,
// badge state is derived from the full document and the visited set alone.
function mapUnvisitedIds(v: MapVisual, visited: ReadonlySet<string>): string[] {
  if (!isRinged(v)) return [];
  return v.nodes.filter((n) => n.ring === "dependent" && !visited.has(n.id)).map((n) => n.id);
}

// unvisitedCounter: the text pinned to the dependents zone label. Null when
// the map is not ringed or has no dependents; reads done at zero.
function unvisitedCounter(v: MapVisual, visited: ReadonlySet<string>): string | null {
  if (!isRinged(v)) return null;
  const deps = v.nodes.filter((n) => n.ring === "dependent").length;
  if (deps === 0) return null;
  const un = mapUnvisitedIds(v, visited).length;
  return un > 0 ? `${un} of ${deps} unvisited` : "all visited ✓";
}

// mapDrawnBoxes: the laid-out boxes drawn at a dial level. Layout is always
// computed from the full document, so a box never moves between levels — the
// dial only changes which boxes are drawn.
function mapDrawnBoxes(v: MapVisual, level: DialLevel): LaidOutNode[] {
  const drawn = new Set(v.nodes.filter((n) => visibleAt(level, n.level)).map((n) => n.id));
  return mapLayoutOf(v).nodes.filter((b) => drawn.has(b.id));
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
  const l = mapLayoutOf(v); // full document: positions never depend on the dial
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

  // Ring zones: labelled rounded rects behind everything, outermost first.
  // The dependents label carries the unvisited counter, updated in place.
  const visited = ctx.visited ?? new Set<string>();
  const unvisited = new Set(mapUnvisitedIds(v, visited));
  let counterEl: SVGTextElement | null = null;
  if (l.zones) {
    const zonesG = svgEl("g", { class: "zones" });
    for (const z of l.zones) {
      const g = svgEl("g", { class: `zone ${z.ring}` });
      g.appendChild(svgEl("rect", { x: z.x, y: z.y, width: z.w, height: z.h, rx: 12 }));
      const label = z.ring === "dependent" ? "dependents" : z.ring;
      const labelEl = svgEl("text", { x: z.x + 12, y: z.y + 17, class: "zlabel" }, label);
      g.appendChild(labelEl);
      if (z.ring === "dependent") {
        const count = unvisitedCounter(v, visited);
        if (count) {
          counterEl = svgEl("text", {
            x: z.x + z.w - 12, y: z.y + 17, "text-anchor": "end",
            class: "zcount" + (unvisited.size === 0 ? " done" : ""),
          }, count);
          g.appendChild(counterEl);
        }
      }
      zonesG.appendChild(g);
    }
    svg.appendChild(zonesG);
  }

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
    g.appendChild(svgEl("title", {}, e.label ?? ""));
    // a horizontal label needs to fit the gap between the boxes, or it would
    // clip behind them (ring rows sit much closer than tier columns)
    const labelFits = !horizontal || Math.abs(x2 - x1) > (e.label?.length ?? 0) * 6.5;
    if (e.label && labelFits) {
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
    const dep = l.zones !== undefined && n.ring === "dependent";
    const g = svgEl("g", {
      class: "node" + (n.focus ? " focus" : "") + (dep ? " dep" : "") + (dep && unvisited.has(n.id) ? " unvisited" : ""),
      "data-anchor": n.id,
      transform: `translate(${b.x} ${b.y})`,
    });
    g.appendChild(svgEl("title", {}, n.detail ? `${n.label} — ${n.detail}` : n.label));
    g.appendChild(svgEl("rect", { width: b.w, height: b.h, rx: 10 }));
    g.appendChild(svgEl("text", { x: 12, y: b.h / 2 + 4.5 }, n.label));
    if (dep) {
      // the unvisited badge: shown by CSS only while the node is .unvisited
      const badge = svgEl("g", { class: "badge" });
      badge.appendChild(svgEl("title", {}, "not looked at yet"));
      badge.appendChild(svgEl("circle", { cx: b.w - 1, cy: 1, r: 5.5 }));
      g.appendChild(badge);
    }
    const chip = codeChip(ctx, n.id, b.w - 34, b.h / 2);
    if (chip) g.appendChild(chip);
    nodesG.appendChild(g);
  }
  svg.appendChild(nodesG);

  // Re-badge in place on visits: class toggles and the counter text — the
  // layout, and so every box position, stays exactly as rendered.
  svg.addEventListener("visitedchange", (e) => {
    const vis = (e as CustomEvent<{ visited: ReadonlySet<string> }>).detail.visited;
    const un = new Set(mapUnvisitedIds(v, vis));
    svg.querySelectorAll<SVGGElement>(".node.dep").forEach((g) => {
      const id = g.getAttribute("data-anchor");
      g.classList.toggle("unvisited", id !== null && un.has(id));
    });
    if (counterEl) {
      counterEl.textContent = unvisitedCounter(v, vis);
      counterEl.classList.toggle("done", un.size === 0);
    }
  });

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

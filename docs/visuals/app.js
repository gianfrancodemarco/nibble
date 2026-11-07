"use strict";
// The visual host — the seam between the shell and the per-kind renderers.
// Renderers register themselves in visualRenderers (one file per kind,
// concatenated by tsc in tsconfig order), mark addressable elements with
// data-anchor, and ask the host for code chips. Selection, comment targets
// and the drawer affordance are wired once, here. No top-level DOM access:
// this file is also part of the node-run test build.
const DIAL_DEFAULT = "standard";
function dialToggle(level) {
    return level === "standard" ? "overview" : "standard";
}
// visibleAt: is an element with this `level` hint drawn at the dial level?
// Absent means overview — drawn everywhere.
function visibleAt(level, elLevel) {
    return level === "standard" || elLevel === undefined;
}
// descriptionAt picks the description variant for a dial level. Fallback is
// downward only: standard falls back to overview; the overview never shows
// the long text. Null means nothing to show.
function descriptionAt(d, level) {
    if (!d)
        return null;
    return level === "standard" ? d.standard ?? d.overview : d.overview;
}
// --- visited dependents: session state, never persisted, never posted ---
// One set for the whole session: the same element id on two nibbles is the
// same thing looked at once. Renderers read it through RenderCtx.visited and
// re-badge in place on the "visitedchange" event; it never reaches the plate
// or the review.
const hostVisited = new Set();
// markVisited records that the reader looked at an element. Returns whether
// that changed anything, so callers only re-badge on first visits.
function markVisited(id) {
    if (hostVisited.has(id))
        return false;
    hostVisited.add(id);
    return true;
}
// selectAndVisit: the selection click path. Selecting an element counts as
// looking at it — even a toggle-off looked first.
function selectAndVisit(cur, card, id) {
    markVisited(id);
    return nextSelection(cur, card, id);
}
// openAndVisit: the code-chip path. Opening an element's code counts as
// looking at it; an id without code resolves to nothing and visits nothing.
function openAndVisit(ctx, id) {
    const act = codeActivation(ctx, id);
    if (act)
        markVisited(id);
    return act;
}
// reviewBody builds the exact JSON the review POST sends: verdict and
// comments, nothing else — visited state stays in this tab.
function reviewBody(verdict, comments) {
    return JSON.stringify({ verdict, comments });
}
const visualRenderers = {};
// --- pure seam logic (covered by test/host.test.ts) ---
function anchorRefIndex(refs) {
    const m = new Map();
    refs.forEach((r, i) => {
        if (r.anchor && !m.has(r.anchor))
            m.set(r.anchor, i);
    });
    return m;
}
function nextSelection(cur, card, id) {
    if (cur && cur.card === card && cur.id === id)
        return null;
    return { card, id };
}
function commentTarget(n, sel, card) {
    return sel && sel.card === card ? `n${n}:${sel.id}` : `n${n}`;
}
// anchorDrawnAt: is the element with this stable id drawn at the dial level?
// Ids that never carry a level (actors, compare sides, state names) are
// always drawn; an id the visual does not declare is not drawn.
function anchorDrawnAt(v, id, level) {
    if (v.kind === "map") {
        const n = v.nodes.find((x) => x.id === id);
        return n !== undefined && visibleAt(level, n.level);
    }
    if (v.kind === "sequence") {
        if (v.actors.some((a) => a.id === id))
            return true;
        const s = v.steps.find((x) => x.id === id);
        return s !== undefined && visibleAt(level, s.level);
    }
    if (v.kind === "timeline") {
        const lane = v.lanes.find((l) => l.id === id);
        if (lane)
            return visibleAt(level, lane.level);
        const laneHidden = (laneId) => {
            const l = v.lanes.find((x) => x.id === laneId);
            return l !== undefined && !visibleAt(level, l.level);
        };
        const inSet = (events) => events?.find((e) => e.id === id);
        const e = inSet(v.events) ?? v.states?.reduce((hit, s) => hit ?? inSet(s.events), undefined);
        if (e)
            return visibleAt(level, e.level) && !laneHidden(e.lane);
        return v.states?.some((s) => s.name === id) ?? false;
    }
    return id === "before" || id === "after";
}
// selectionAfterDial: a selection survives a dial turn only while its element
// is still drawn; otherwise it clears (and the comment target falls back).
function selectionAfterDial(sel, visualOf, level) {
    if (!sel)
        return null;
    const v = visualOf(sel.card);
    if (!v)
        return null;
    return anchorDrawnAt(v, sel.id, level) ? sel : null;
}
// --- SVG helpers shared by the renderers ---
const SVG_NS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs = {}, text) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs))
        el.setAttribute(k, String(v));
    if (text !== undefined)
        el.textContent = text;
    return el;
}
// What activating an element's code affordance resolves to: the exact
// (nibble, ref index) pair the drawer endpoint takes, or null when the id
// carries no anchored ref.
function codeActivation(ctx, id) {
    const refIdx = ctx.anchored.get(id);
    return refIdx === undefined ? null : { n: ctx.n, ref: refIdx };
}
// A small "code" pill renderers place inside an element whose id a nibble
// ref anchors. Clicking it opens the drawer on that ref (wired below);
// returns null when the id carries no code.
function codeChip(ctx, id, x, y) {
    const act = codeActivation(ctx, id);
    if (!act)
        return null;
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
function codeChipHTML(ctx, id) {
    const act = codeActivation(ctx, id);
    if (!act)
        return null;
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
function renderVisualBody(v, ctx) {
    const r = visualRenderers[v.kind];
    return r ? r(v, ctx) : null;
}
let hostSelection = null;
function applySelection(strip) {
    strip.querySelectorAll(".nibble").forEach((card) => {
        const idx = Number(card.dataset.i);
        const selId = hostSelection && hostSelection.card === idx ? hostSelection.id : null;
        card.classList.toggle("has-sel", selId !== null);
        card.querySelectorAll("[data-anchor]").forEach((el) => {
            el.classList.toggle("sel", selId !== null && el.getAttribute("data-anchor") === selId);
        });
        const body = card.querySelector(".visual-body");
        if (body)
            body.dispatchEvent(new CustomEvent("anchorselection", { detail: { id: selId } }));
    });
}
// applyVisited: tell every rendered visual to re-badge in place — class
// toggles on fixed positions, never a re-render.
function applyVisited(strip) {
    strip.querySelectorAll(".visual-body").forEach((body) => {
        body.dispatchEvent(new CustomEvent("visitedchange", { detail: { visited: hostVisited } }));
    });
}
function clearVisualSelection(strip, wiring) {
    if (!hostSelection)
        return;
    hostSelection = null;
    applySelection(strip);
    wiring.onTarget();
}
function wireVisualHost(strip, wiring) {
    strip.addEventListener("click", (e) => {
        const t = e.target;
        if (!t)
            return;
        const chip = t.closest("[data-code]");
        if (chip) {
            e.stopPropagation();
            const anchorId = chip.closest("[data-anchor]")?.getAttribute("data-anchor");
            if (anchorId && markVisited(anchorId))
                applyVisited(strip);
            wiring.openRef(Number(chip.getAttribute("data-n")), Number(chip.getAttribute("data-code")));
            return;
        }
        const el = t.closest("[data-anchor]");
        const card = t.closest(".nibble");
        if (!card)
            return;
        if (el) {
            const id = el.getAttribute("data-anchor");
            if (id) {
                const first = !hostVisited.has(id);
                hostSelection = selectAndVisit(hostSelection, Number(card.dataset.i), id);
                applySelection(strip);
                if (first)
                    applyVisited(strip);
                wiring.onTarget();
            }
        }
        else if (hostSelection && hostSelection.card === Number(card.dataset.i)) {
            // background click inside the card clears its selection
            clearVisualSelection(strip, wiring);
        }
    });
    strip.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ")
            return;
        const chip = e.target?.closest?.("[data-code]");
        if (chip) {
            e.preventDefault();
            const anchorId = chip.closest("[data-anchor]")?.getAttribute("data-anchor");
            if (anchorId && markVisited(anchorId))
                applyVisited(strip);
            wiring.openRef(Number(chip.getAttribute("data-n")), Number(chip.getAttribute("data-code")));
        }
    });
}
// map — services and modules as tiered columns. Layout is pure (tested in
// test/map.test.ts); rendering builds SVG on top of it and registers with
// the host.
const MAP_TIERS = ["edge", "service", "data"];
const MAP_NODE_H = 46;
function mapNodeW(n) {
    return Math.max(96, 20 + n.label.length * 7.5 + 40);
}
// Declaration order, with group members pulled together at the first
// member's position — the ordering discipline tiers and rings share.
function mapGroupOrder(list) {
    const ordered = [];
    const used = new Set();
    for (const n of list) {
        if (used.has(n.id))
            continue;
        if (n.group) {
            for (const m of list) {
                if (m.group === n.group && !used.has(m.id)) {
                    ordered.push(m);
                    used.add(m.id);
                }
            }
        }
        else {
            ordered.push(n);
            used.add(n.id);
        }
    }
    return ordered;
}
function layoutMap(v) {
    const PAD = 24, VGAP = 22, HGAP = 90, NODE_H = MAP_NODE_H;
    const nodeW = mapNodeW;
    const colOf = (n) => n.tier ?? "service";
    const present = MAP_TIERS.filter((t) => v.nodes.some((n) => colOf(n) === t));
    const cols = present.map((tier) => mapGroupOrder(v.nodes.filter((n) => colOf(n) === tier)));
    const colW = cols.map((c) => Math.max(...c.map(nodeW)));
    const colH = cols.map((c) => c.length * NODE_H + (c.length - 1) * VGAP);
    const h = Math.max(...colH) + PAD * 2;
    const nodes = [];
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
function isRinged(v) {
    return v.nodes.every((n) => n.ring !== undefined);
}
// mapLayoutOf: the one layout dispatch — concentric rings for a ringed map,
// tiered columns otherwise.
function mapLayoutOf(v) {
    return isRinged(v) ? layoutRingMap(v) : layoutMap(v);
}
// layoutRingMap: three concentric rectangular bands read inside-out — changed
// at the centre, dependents around it, the rest outside. Bands are stacks of
// rows (at most RING_ROW nodes each, so a crowded ring wraps instead of
// growing sideways); declaration order within a ring, exactly like columns
// in the tiered layout.
const RING_ROW = 3;
function layoutRingMap(v) {
    const PAD = 10, ZPAD = 18, LABEL_H = 26, VGAP = 20, HGAP = 52, NODE_H = MAP_NODE_H;
    const ringOf = (ring) => mapGroupOrder(v.nodes.filter((n) => n.ring === ring));
    const chunk = (list) => {
        const out = [];
        for (let i = 0; i < list.length; i += RING_ROW)
            out.push(list.slice(i, i + RING_ROW));
        return out;
    };
    const split = (list) => {
        const top = Math.ceil(list.length / 2);
        return [chunk(list.slice(0, top)), chunk(list.slice(top))];
    };
    const changed = chunk(ringOf("changed"));
    const [depTop, depBot] = split(ringOf("dependent"));
    const [restTop, restBot] = split(ringOf("rest"));
    const rowW = (list) => list.length ? list.reduce((s, n) => s + mapNodeW(n), 0) + (list.length - 1) * HGAP : 0;
    const stackW = (rows) => Math.max(0, ...rows.map(rowW));
    // Widths inside-out: each zone wraps the widest row it holds.
    const cW = stackW(changed) + 2 * ZPAD;
    const dW = Math.max(cW, stackW(depTop), stackW(depBot)) + 2 * ZPAD;
    const rW = Math.max(dW, stackW(restTop), stackW(restBot)) + 2 * ZPAD;
    const w = rW + 2 * PAD;
    // Positions top-down: restTop / depTop / changed / depBot / restBot, each
    // row centered, each zone reserving room for its label. placeStack returns
    // the y just below what it placed.
    const nodes = [];
    const placeStack = (rows, y) => {
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
    if (restTop.length)
        y = placeStack(restTop, y) + VGAP;
    const dTop = y;
    y += LABEL_H;
    if (depTop.length)
        y = placeStack(depTop, y) + VGAP;
    const cTop = y;
    y = placeStack(changed, cTop + LABEL_H) + ZPAD;
    const cBot = y;
    if (depBot.length)
        y = placeStack(depBot, y + VGAP);
    const dBot = y + ZPAD;
    y = dBot;
    if (restBot.length)
        y = placeStack(restBot, y + VGAP);
    const rBot = y + ZPAD;
    const zones = [
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
function mapUnvisitedIds(v, visited) {
    if (!isRinged(v))
        return [];
    return v.nodes.filter((n) => n.ring === "dependent" && !visited.has(n.id)).map((n) => n.id);
}
// unvisitedCounter: the text pinned to the dependents zone label. Null when
// the map is not ringed or has no dependents; reads done at zero.
function unvisitedCounter(v, visited) {
    if (!isRinged(v))
        return null;
    const deps = v.nodes.filter((n) => n.ring === "dependent").length;
    if (deps === 0)
        return null;
    const un = mapUnvisitedIds(v, visited).length;
    return un > 0 ? `${un} of ${deps} unvisited` : "all visited ✓";
}
// mapDrawnBoxes: the laid-out boxes drawn at a dial level. Layout is always
// computed from the full document, so a box never moves between levels — the
// dial only changes which boxes are drawn.
function mapDrawnBoxes(v, level) {
    const drawn = new Set(v.nodes.filter((n) => visibleAt(level, n.level)).map((n) => n.id));
    return mapLayoutOf(v).nodes.filter((b) => drawn.has(b.id));
}
// mapDrawnEdgeIdx: indices into v.edges of the edges drawn at a dial level —
// the edge's own level, and both endpoints, must be visible.
function mapDrawnEdgeIdx(v, level) {
    const drawn = new Set(v.nodes.filter((n) => visibleAt(level, n.level)).map((n) => n.id));
    const out = [];
    (v.edges ?? []).forEach((e, i) => {
        if (visibleAt(level, e.level) && drawn.has(e.from) && drawn.has(e.to))
            out.push(i);
    });
    return out;
}
// --- rendering ---
function mapEdgeEnds(a, b) {
    if (b.x >= a.x + a.w)
        return { x1: a.x + a.w, y1: a.y + a.h / 2, x2: b.x - 7, y2: b.y + b.h / 2, horizontal: true };
    if (a.x >= b.x + b.w)
        return { x1: a.x, y1: a.y + a.h / 2, x2: b.x + b.w + 7, y2: b.y + b.h / 2, horizontal: true };
    if (b.y > a.y)
        return { x1: a.x + a.w / 2, y1: a.y + a.h, x2: b.x + b.w / 2, y2: b.y - 7, horizontal: false };
    return { x1: a.x + a.w / 2, y1: a.y, x2: b.x + b.w / 2, y2: b.y + b.h + 7, horizontal: false };
}
let mapIdSeq = 0;
function renderMapVisual(v, ctx) {
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
    for (const [name, cls] of [["arr", "arr"], ["arrhl", "arr hl"]]) {
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
    const visited = ctx.visited ?? new Set();
    const unvisited = new Set(mapUnvisitedIds(v, visited));
    let counterEl = null;
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
        if (!drawnEdges.has(ei))
            return;
        const a = byId.get(e.from);
        const b = byId.get(e.to);
        if (!a || !b)
            return; // validation forbids this; stay defensive
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
        if (!drawnNodes.has(n.id))
            continue;
        const b = byId.get(n.id);
        if (!b)
            continue;
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
        if (chip)
            g.appendChild(chip);
        nodesG.appendChild(g);
    }
    svg.appendChild(nodesG);
    // Re-badge in place on visits: class toggles and the counter text — the
    // layout, and so every box position, stays exactly as rendered.
    svg.addEventListener("visitedchange", (e) => {
        const vis = e.detail.visited;
        const un = new Set(mapUnvisitedIds(v, vis));
        svg.querySelectorAll(".node.dep").forEach((g) => {
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
        const id = e.detail.id;
        svg.querySelectorAll(".edge").forEach((g) => {
            const incident = id !== null && (g.dataset.from === id || g.dataset.to === id);
            g.classList.toggle("hl", incident);
            g.classList.toggle("dim", id !== null && !incident);
            g.querySelector("path")?.setAttribute("marker-end", `url(#${uid}-${incident ? "arrhl" : "arr"})`);
        });
    });
    return svg;
}
visualRenderers.map = renderMapVisual;
// sequence — lifelines and messages, stepped one at a time. Layout and the
// step-state machine are pure (tested in test/sequence.test.ts).
const SEQ_TOP = 46;
const SEQ_STEP_GAP = 46;
function seqAdvance(shown, delta, total) {
    return Math.max(0, Math.min(total, shown + delta));
}
// seqDrawnSteps: indices into v.steps of the steps drawn at a dial level.
// Stepping advances through these only; positions come from the full layout.
function seqDrawnSteps(v, level) {
    const out = [];
    v.steps.forEach((s, i) => {
        if (visibleAt(level, s.level))
            out.push(i);
    });
    return out;
}
function layoutSequence(v) {
    const PAD = 24;
    let x = PAD;
    const actors = v.actors.map((a) => {
        const w = Math.max(104, a.label.length * 7.5 + 28);
        const cx = x + w / 2;
        x += w + 40;
        return { id: a.id, label: a.label, x: cx, w };
    });
    const steps = v.steps.map((_, i) => ({ y: SEQ_TOP + 34 + i * SEQ_STEP_GAP }));
    return {
        w: x - 40 + PAD,
        h: SEQ_TOP + 34 + v.steps.length * SEQ_STEP_GAP + PAD,
        topH: SEQ_TOP,
        actors,
        steps,
    };
}
let seqIdSeq = 0;
function renderSequenceVisual(v, ctx) {
    const level = ctx.level ?? "standard";
    const l = layoutSequence(v); // full document: step rows never move
    const drawn = seqDrawnSteps(v, level);
    const posOf = new Map(drawn.map((idx, pos) => [idx, pos]));
    const uid = `seq${++seqIdSeq}`;
    const svg = svgEl("svg", {
        viewBox: `0 0 ${l.w} ${l.h}`, class: "vis-seq",
        preserveAspectRatio: "xMidYMid meet", role: "img",
    });
    const defs = svgEl("defs");
    const marker = (name, path, cls) => {
        const m = svgEl("marker", {
            id: `${uid}-${name}`, viewBox: "0 0 10 10", refX: 9, refY: 5,
            markerWidth: 7.5, markerHeight: 7.5, orient: "auto-start-reverse",
        });
        m.appendChild(svgEl("path", { d: path, class: cls }));
        defs.appendChild(m);
    };
    marker("call", "M 0 0 L 10 5 L 0 10 z", "arr fill");
    marker("async", "M 0 0 L 10 5 L 0 10", "arr open");
    svg.appendChild(defs);
    const byId = new Map(l.actors.map((a) => [a.id, a]));
    const bottom = l.h - 16;
    // lifelines + actor boxes
    const actorsG = svgEl("g");
    for (const a of l.actors) {
        actorsG.appendChild(svgEl("line", { x1: a.x, y1: SEQ_TOP, x2: a.x, y2: bottom, class: "lifeline" }));
        const g = svgEl("g", { class: "actor", "data-anchor": a.id, transform: `translate(${a.x - a.w / 2} ${SEQ_TOP - 34})` });
        g.appendChild(svgEl("title", {}, a.label));
        g.appendChild(svgEl("rect", { width: a.w, height: 30, rx: 8 }));
        g.appendChild(svgEl("text", { x: a.w / 2, y: 19.5, "text-anchor": "middle" }, a.label));
        const chip = codeChip(ctx, a.id, a.w - 32, 15);
        if (chip)
            g.appendChild(chip);
        actorsG.appendChild(g);
    }
    svg.appendChild(actorsG);
    // steps
    const stepsG = svgEl("g");
    v.steps.forEach((s, i) => {
        if (!posOf.has(i))
            return; // hidden at this dial level
        const a = byId.get(s.from);
        const b = byId.get(s.to);
        const y = l.steps[i].y;
        if (!a || !b)
            return; // validation forbids dangling steps
        const g = svgEl("g", { class: `step ${s.kind ?? "call"}`, "data-step": i });
        if (s.id)
            g.setAttribute("data-anchor", s.id);
        const end = s.kind === "async" ? "async" : "call";
        if (a.id === b.id) {
            // self message: a small loop to the right
            const d = `M ${a.x} ${y - 10} C ${a.x + 46} ${y - 12}, ${a.x + 46} ${y + 12}, ${a.x + 7} ${y + 10}`;
            g.appendChild(svgEl("path", { d, class: "msg", "marker-end": `url(#${uid}-${end})` }));
        }
        else {
            const dir = b.x > a.x ? 1 : -1;
            g.appendChild(svgEl("line", {
                x1: a.x, y1: y, x2: b.x - 7 * dir, y2: y, class: "msg", "marker-end": `url(#${uid}-${end})`,
            }));
        }
        const mx = a.id === b.id ? a.x + 52 : (a.x + b.x) / 2;
        const anchor = a.id === b.id ? "start" : "middle";
        g.appendChild(svgEl("text", { x: mx, y: y - 7, "text-anchor": anchor, class: "slabel" }, s.label));
        if (s.alt) {
            g.appendChild(svgEl("text", { x: mx, y: y + 15, "text-anchor": anchor, class: "alt" }, `⑂ ${s.alt}`));
        }
        const chip = codeChip(ctx, s.id ?? "", Math.min(a.x, b.x) - 44, y);
        if (chip)
            g.appendChild(chip);
        stepsG.appendChild(g);
    });
    svg.appendChild(stepsG);
    // step control: ▸ advances, ◂ goes back, clicking a step jumps to it.
    // Stepping walks the drawn subset only.
    let shown = 0;
    const total = drawn.length;
    const ctrl = svgEl("g", { class: "seq-ctrl", transform: `translate(${l.w - 92} ${l.h - 14})` });
    const back = svgEl("text", { x: 0, y: 0, class: "btn", role: "button" }, "◂");
    const fwd = svgEl("text", { x: 18, y: 0, class: "btn", role: "button" }, "▸");
    const counter = svgEl("text", { x: 40, y: 0, class: "count" }, "");
    ctrl.append(back, fwd, counter);
    svg.appendChild(ctrl);
    const apply = () => {
        stepsG.querySelectorAll(".step").forEach((g) => {
            const pos = posOf.get(Number(g.getAttribute("data-step"))) ?? -1;
            g.classList.toggle("done", pos >= 0 && pos < shown);
            g.classList.toggle("cur", pos === shown - 1);
        });
        counter.textContent = `${shown}/${total}`;
    };
    const step = (delta) => { shown = seqAdvance(shown, delta, total); apply(); };
    back.addEventListener("click", (e) => { e.stopPropagation(); step(-1); });
    fwd.addEventListener("click", (e) => { e.stopPropagation(); step(1); });
    stepsG.addEventListener("click", (e) => {
        const g = e.target.closest(".step");
        if (!g)
            return;
        const pos = posOf.get(Number(g.getAttribute("data-step")));
        if (pos === undefined)
            return;
        shown = pos + 1;
        apply();
    });
    svg.addEventListener("stepvisual", (e) => {
        step(e.detail.delta);
    });
    apply();
    return svg;
}
visualRenderers.sequence = renderSequenceVisual;
// timeline — lanes on one shared clock, a scrubber, precomputed what-if
// states. Axis math and state normalization are pure (test/timeline.test.ts).
function tlParseAt(at) {
    if (typeof at === "number")
        return at;
    const m = /^(\d+):(\d\d):(\d\d)$/.exec(at);
    if (m)
        return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    const n = Number(at);
    return Number.isFinite(n) ? n : 0;
}
function tlStatesOf(v) {
    if (!v.states || v.states.length === 0) {
        return {
            states: [{ name: "all", label: "", events: v.events ?? [] }],
            defaultIndex: 0,
        };
    }
    const states = v.states.map((s) => ({ name: s.name, label: s.label ?? s.name, events: s.events }));
    const di = v.states.findIndex((s) => s.default === true);
    return { states, defaultIndex: di >= 0 ? di : 0 };
}
function tlAxis(v) {
    const times = [];
    for (const s of tlStatesOf(v).states)
        for (const e of s.events)
            times.push(tlParseAt(e.at));
    if (times.length === 0)
        return { min: 0, max: 1 };
    const min = Math.min(...times);
    const max = Math.max(...times);
    return { min, max: max > min ? max : min + 1 };
}
// tlDrawnLanes: the lanes drawn at a dial level. Lane rows keep the full
// document's positions; a hidden lane leaves its row empty.
function tlDrawnLanes(v, level) {
    return v.lanes.filter((l) => visibleAt(level, l.level));
}
// tlDrawnEvents: the events of one event set drawn at a dial level — the
// event's own level, and its lane, must be visible. The scrubber and space
// stepping walk these only.
function tlDrawnEvents(v, events, level) {
    const hiddenLanes = new Set(v.lanes.filter((l) => !visibleAt(level, l.level)).map((l) => l.id));
    return events.filter((e) => visibleAt(level, e.level) && !hiddenLanes.has(e.lane));
}
function tlWeightR(weight, maxWeight) {
    const FLOOR = 4;
    if (!weight || weight <= 0 || maxWeight <= 0)
        return FLOOR;
    return FLOOR + 10 * Math.sqrt(weight / maxWeight);
}
function tlFmt(seconds, clock) {
    if (!clock)
        return String(Math.round(seconds * 100) / 100);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
// --- rendering ---
function renderTimelineVisual(v, ctx) {
    const level = ctx.level ?? "standard";
    const { states, defaultIndex } = tlStatesOf(v);
    // Geometry (axis, lane rows) comes from the full document, so nothing
    // moves when the dial turns; the level only filters what is drawn.
    const axis = tlAxis(v);
    const drawnLaneIds = new Set(tlDrawnLanes(v, level).map((l) => l.id));
    const clock = states.some((s) => s.events.some((e) => typeof e.at === "string" && e.at.includes(":")));
    const maxWeight = Math.max(0, ...states.flatMap((s) => s.events.map((e) => e.weight ?? 0)));
    const PADL = 16, LANE_H = 64, TOP = 14;
    const labelW = Math.max(...v.lanes.map((l) => l.label.length)) * 7 + 24;
    const plotW = 560;
    const w = PADL + labelW + plotW + 30;
    const h = TOP + v.lanes.length * LANE_H + 30;
    const x = (tsec) => PADL + labelW + ((tsec - axis.min) / (axis.max - axis.min)) * plotW;
    const laneY = new Map(v.lanes.map((l, i) => [l.id, TOP + i * LANE_H + LANE_H / 2]));
    const wrap = document.createElement("div");
    wrap.className = "vis-tl";
    // what-if state toggle (only when the document declares states)
    let stateIdx = defaultIndex;
    let cursor = axis.max;
    const head = document.createElement("div");
    head.className = "tl-head";
    if (v.states && states.length > 1) {
        states.forEach((s, i) => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "tl-state";
            b.textContent = s.label;
            b.addEventListener("click", (e) => {
                e.stopPropagation();
                stateIdx = i;
                drawEvents();
                applyCursor();
                head.querySelectorAll(".tl-state").forEach((el, j) => el.classList.toggle("on", j === stateIdx));
            });
            head.appendChild(b);
        });
    }
    wrap.appendChild(head);
    const svg = svgEl("svg", {
        viewBox: `0 0 ${w} ${h}`, class: "tl-plot",
        preserveAspectRatio: "xMidYMid meet", role: "img",
    });
    // lanes
    const lanesG = svgEl("g");
    v.lanes.forEach((l) => {
        if (!drawnLaneIds.has(l.id))
            return; // hidden at this dial level
        const y = laneY.get(l.id);
        lanesG.appendChild(svgEl("line", { x1: PADL + labelW, y1: y, x2: PADL + labelW + plotW, y2: y, class: "lane" }));
        lanesG.appendChild(svgEl("text", { x: PADL, y: y + 4, class: "lane-label" }, l.label));
    });
    svg.appendChild(lanesG);
    // axis ticks
    const axisG = svgEl("g", { class: "axis" });
    const tickY = TOP + v.lanes.length * LANE_H + 12;
    axisG.appendChild(svgEl("text", { x: PADL + labelW, y: tickY, "text-anchor": "start" }, tlFmt(axis.min, clock)));
    axisG.appendChild(svgEl("text", { x: PADL + labelW + plotW, y: tickY, "text-anchor": "end" }, tlFmt(axis.max, clock)));
    svg.appendChild(axisG);
    // cursor line
    const cursorLine = svgEl("line", { y1: TOP - 6, y2: TOP + v.lanes.length * LANE_H, class: "cursor" });
    svg.appendChild(cursorLine);
    const eventsG = svgEl("g");
    svg.appendChild(eventsG);
    function drawEvents() {
        eventsG.innerHTML = "";
        for (const e of tlDrawnEvents(v, states[stateIdx].events, level)) {
            const y = laneY.get(e.lane);
            if (y === undefined)
                continue; // validation forbids dangling lanes
            const ex = x(tlParseAt(e.at));
            const g = svgEl("g", { class: "ev", "data-at": tlParseAt(e.at) });
            if (e.id)
                g.setAttribute("data-anchor", e.id);
            g.appendChild(svgEl("title", {}, `${tlFmt(tlParseAt(e.at), clock)} — ${e.label}${e.weight ? ` (${e.weight})` : ""}`));
            g.appendChild(svgEl("circle", { cx: ex, cy: y, r: tlWeightR(e.weight, maxWeight) }));
            const above = y - tlWeightR(e.weight, maxWeight) - 6;
            g.appendChild(svgEl("text", { x: ex, y: above, "text-anchor": "middle", class: "ev-label" }, e.label));
            if (e.id) {
                const chip = codeChip(ctx, e.id, ex + 8, y + 16);
                if (chip)
                    g.appendChild(chip);
            }
            eventsG.appendChild(g);
        }
    }
    function applyCursor() {
        const cx = x(cursor);
        cursorLine.setAttribute("x1", String(cx));
        cursorLine.setAttribute("x2", String(cx));
        eventsG.querySelectorAll(".ev").forEach((g) => {
            const at = Number(g.getAttribute("data-at"));
            g.classList.toggle("pending", at > cursor);
        });
        range.value = String(cursor);
    }
    wrap.appendChild(svg);
    // the scrubber: a native range input over the same axis
    const range = document.createElement("input");
    range.type = "range";
    range.className = "tl-scrub";
    range.min = String(axis.min);
    range.max = String(axis.max);
    range.step = String((axis.max - axis.min) / 200);
    range.value = String(cursor);
    range.title = "scrub time";
    range.style.marginLeft = `${((PADL + labelW) / w) * 100}%`;
    range.style.width = `${(plotW / w) * 100}%`;
    range.addEventListener("input", () => {
        cursor = Number(range.value);
        applyCursor();
    });
    range.addEventListener("click", (e) => e.stopPropagation());
    wrap.appendChild(range);
    // space steps the cursor between distinct event times
    wrap.addEventListener("stepvisual", (e) => {
        const delta = e.detail.delta;
        const times = [...new Set(tlDrawnEvents(v, states[stateIdx].events, level).map((ev) => tlParseAt(ev.at)))].sort((a, b) => a - b);
        const next = delta > 0 ? times.find((t) => t > cursor) : [...times].reverse().find((t) => t < cursor);
        cursor = next ?? (delta > 0 ? axis.max : axis.min);
        applyCursor();
    });
    if (head.firstElementChild)
        head.children[stateIdx].classList.add("on");
    drawEvents();
    applyCursor();
    return wrap;
}
visualRenderers.timeline = renderTimelineVisual;
// compare — before vs after, visually paired with a flip. Metric alignment
// and content-kind detection are pure (test/compare.test.ts). Ref sides show
// the code of the nibble ref anchored to the side's id ("before"/"after"),
// fetched from the same endpoint the drawer uses.
function cmpContentKind(side) {
    const c = side.content;
    if ("ref" in c)
        return "ref";
    if ("map" in c)
        return "map";
    return "metrics";
}
function cmpMetricsOf(side) {
    const c = side.content;
    return Array.isArray(c.metrics) ? c.metrics : [];
}
function cmpMetricRows(before, after) {
    const b = cmpMetricsOf(before);
    const a = cmpMetricsOf(after);
    const afterByName = new Map(a.map((m) => [m.name, m]));
    const rows = b.map((m) => ({ name: m.name, before: m, after: afterByName.get(m.name) }));
    for (const m of a) {
        if (!b.some((x) => x.name === m.name))
            rows.push({ name: m.name, after: m });
    }
    return rows;
}
// --- rendering ---
function cmpEsc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function cmpMetricCell(m) {
    if (!m)
        return `<span class="none">—</span>`;
    return `<b>${cmpEsc(String(m.value))}</b>${m.unit ? ` <span class="unit">${cmpEsc(m.unit)}</span>` : ""}`;
}
function cmpSideHead(id, side, ctx) {
    const head = document.createElement("div");
    head.className = "cmp-label";
    const name = document.createElement("span");
    name.setAttribute("data-anchor", id);
    name.textContent = side.label;
    head.appendChild(name);
    const meta = ctx.anchored.has(id) ? ctx.refs[ctx.anchored.get(id)] : undefined;
    if (meta?.trust) {
        const b = document.createElement("span");
        b.className = `trust ${meta.trust.level}`;
        b.textContent = meta.trust.level === "shifted"
            ? `shifted ${meta.trust.shift > 0 ? "+" : ""}${meta.trust.shift}`
            : meta.trust.level;
        head.appendChild(b);
    }
    const chip = codeChipHTML(ctx, id);
    if (chip)
        head.appendChild(chip);
    return head;
}
function cmpPane(id, v, ctx) {
    const side = v[id];
    const pane = document.createElement("div");
    pane.className = `cmp-pane ${id}`;
    pane.appendChild(cmpSideHead(id, side, ctx));
    const kind = cmpContentKind(side);
    if (kind === "map") {
        // nested map, rendered by the map renderer at pane size
        const m = side.content.map;
        if (Array.isArray(m.nodes))
            pane.appendChild(renderMapVisual(m, ctx));
    }
    else if (kind === "ref") {
        const refStr = side.content.ref;
        const body = document.createElement("div");
        body.className = "cmp-code mono";
        const refIdx = ctx.anchored.get(id);
        if (refIdx === undefined) {
            // no nibble ref anchored to this side: the bare ref text
            body.classList.add("bare");
            body.textContent = refStr;
        }
        else {
            body.textContent = refStr; // placeholder until the fetch lands
            void fetch(`api/code?n=${ctx.n}&ref=${refIdx}`)
                .then((r) => (r.ok ? r.json() : null))
                .then((resp) => {
                if (!resp)
                    return;
                if (resp.why) {
                    body.textContent = `⚠ ${resp.why}`;
                    return;
                }
                body.innerHTML = resp.lines
                    .map((l) => `<div class="ln${l.in ? " in" : ""}"><span class="no">${l.no}</span><span>${cmpEsc(l.text) || " "}</span></div>`)
                    .join("");
            })
                .catch(() => undefined);
        }
        pane.appendChild(body);
    }
    else {
        // metrics: this side's column of the shared rows, aligned by row order
        const rows = cmpMetricRows(v.before, v.after);
        const grid = document.createElement("div");
        grid.className = "cmp-metrics";
        grid.innerHTML = rows
            .map((r) => `<div class="mrow"><span class="mname">${cmpEsc(r.name)}</span><span class="mval">${cmpMetricCell(r[id])}</span></div>`)
            .join("");
        pane.appendChild(grid);
    }
    return pane;
}
function renderCompareVisual(v, ctx) {
    const wrap = document.createElement("div");
    wrap.className = "vis-cmp";
    const panes = document.createElement("div");
    panes.className = "cmp-panes";
    panes.appendChild(cmpPane("before", v, ctx));
    panes.appendChild(cmpPane("after", v, ctx));
    wrap.appendChild(panes);
    // the flip: shifts attention between the sides (before → after → both)
    const flip = document.createElement("button");
    flip.type = "button";
    flip.className = "cmp-flip";
    flip.textContent = "⇄ flip";
    const order = ["after", "before", null];
    let i = -1;
    flip.addEventListener("click", (e) => {
        e.stopPropagation();
        i = (i + 1) % order.length;
        panes.classList.toggle("focus-before", order[i] === "before");
        panes.classList.toggle("focus-after", order[i] === "after");
    });
    wrap.appendChild(flip);
    wrap.addEventListener("stepvisual", () => flip.click());
    return wrap;
}
visualRenderers.compare = renderCompareVisual;
// The not-shown ledger card — the last card of a diff plate: the hunks no
// nibble referenced, grouped by file, each openable in the drawer and open
// to review comments. Pure seam functions up top (covered by
// test/ledger.test.ts); DOM rendering below, used by the shell only.
// hunkId is a hunk's stable id on the card — also the second half of its
// comment target, so the agent reads `ledger:src/b.ts:4-9` straight back to
// a place in the diff.
function hunkId(h) {
    return h.end > h.start ? `${h.path}:${h.start}-${h.end}` : `${h.path}:${h.start}`;
}
// ledgerHunkLabel is the row's summary: side, lines, +/− counts.
function ledgerHunkLabel(h) {
    if (h.binary)
        return `${h.side} · binary`;
    const lines = h.end > h.start ? `${h.start}–${h.end}` : `${h.start}`;
    return `${h.side} ${lines} · +${h.added} −${h.removed}`;
}
// groupLedgerHunks groups hunks under their file, first-appearance order,
// keeping each hunk's index into the ledger (what /api/ledger is keyed by).
function groupLedgerHunks(hunks) {
    const groups = [];
    const byPath = new Map();
    hunks.forEach((hunk, i) => {
        let rows = byPath.get(hunk.path);
        if (!rows) {
            rows = [];
            byPath.set(hunk.path, rows);
            groups.push({ path: hunk.path, rows });
        }
        rows.push({ i, hunk });
    });
    return groups;
}
function ledgerFullyCovered(l) {
    return l.shown === l.total;
}
// cardCount: the strip's cards — the nibbles, plus the ledger card when the
// plate carries a ledger (even an empty one: full coverage is still said).
function cardCount(nibbles, ledger) {
    return nibbles + (ledger ? 1 : 0);
}
// ledgerCommentTarget: comments pin to the ledger as a whole, or to one hunk
// selected on the ledger card.
function ledgerCommentTarget(sel, ledgerCard) {
    return sel && sel.card === ledgerCard ? `ledger:${sel.id}` : "ledger";
}
// --- rendering (DOM; the shell appends the result to the strip) ---
// renderLedgerBody builds the ledger card's content. Hunk rows carry
// data-anchor (the host's selection/comment wiring picks them up) and a
// data-ledger-hunk chip the shell wires to the ledger drawer.
function renderLedgerBody(l) {
    const body = document.createElement("div");
    body.className = "ledger-body";
    const count = document.createElement("p");
    count.className = "ledger-count";
    if (ledgerFullyCovered(l)) {
        count.textContent = l.total === 0
            ? "the diff was empty — nothing to show"
            : `every hunk of the diff was shown (${l.shown} of ${l.total})`;
        count.classList.add("covered");
        body.appendChild(count);
        return body;
    }
    count.textContent = `${l.hunks.length} of ${l.total} hunks never came up — worth a look before the verdict`;
    body.appendChild(count);
    for (const g of groupLedgerHunks(l.hunks)) {
        const file = document.createElement("div");
        file.className = "ledger-file";
        const name = document.createElement("div");
        name.className = "ledger-path mono";
        name.textContent = g.path;
        file.appendChild(name);
        for (const { i, hunk } of g.rows) {
            const row = document.createElement("div");
            row.className = "ledger-hunk";
            row.setAttribute("data-anchor", hunkId(hunk));
            row.setAttribute("role", "button");
            row.setAttribute("tabindex", "0");
            const label = document.createElement("span");
            label.textContent = ledgerHunkLabel(hunk);
            row.appendChild(label);
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "code-chip-h";
            chip.dataset.ledgerHunk = String(i);
            chip.textContent = "</>";
            chip.title = "open this hunk's code";
            row.appendChild(chip);
            file.appendChild(row);
        }
        body.appendChild(file);
    }
    return body;
}
// nibble reader shell — pure presentation over the Go server's JSON API.
// Protocol logic (refs, trust, validation) never happens here: the server
// hands us computed trust and resolved code. Hand-written types below cover
// the server's response shapes only; the visual types are generated from
// the protocol JSON Schemas (src/visual/types.gen.d.ts, `npm run gen`).
function flash(msg) {
    const el = document.getElementById("notice");
    if (!el)
        return;
    el.hidden = false;
    el.textContent = msg;
}
const $ = (sel) => {
    const el = document.querySelector(sel);
    if (!el)
        throw new Error(`missing ${sel}`);
    return el;
};
let plate = null;
let active = 0;
let chosen = null;
let justSent = false;
let dialLevel = DIAL_DEFAULT;
const pending = [];
const visualOfCard = (card) => plate?.nibbles[card]?.visual ?? null;
// cards: the nibbles plus the ledger card when the plate carries a ledger
const cards = () => (plate ? cardCount(plate.nibbles.length, plate.ledger) : 0);
const isLedgerCard = (i) => plate?.ledger != null && i === plate.nibbles.length;
// --- tiny markdown: titles and descriptions get bold/code/italic only ---
function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function mdLite(s) {
    return esc(s)
        .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*([^*]+)\*/g, "<i>$1</i>");
}
// --- visual summary: typed card standing in for per-kind rendering ---
function visualSummary(v) {
    let detail = "";
    let anchors = [];
    if (v.kind === "map") {
        detail = `${v.nodes.length} nodes · ${v.edges?.length ?? 0} edges`;
        anchors = v.nodes.map((n) => n.id);
    }
    else if (v.kind === "sequence") {
        detail = `${v.actors.length} actors · ${v.steps.length} steps`;
        anchors = v.actors.map((a) => a.id);
    }
    else if (v.kind === "timeline") {
        const states = v.states?.map((s) => s.name) ?? [];
        detail = `${v.lanes.length} lanes` + (states.length ? ` · states: ${states.join(", ")}` : "");
        anchors = v.lanes.map((l) => l.id);
    }
    else {
        detail = "before / after";
        anchors = ["before", "after"];
    }
    return { kind: v.kind, title: v.title, detail, anchors };
}
// --- render ---
function trustBadge(t) {
    const label = t.level === "shifted" ? `shifted ${t.shift > 0 ? "+" : ""}${t.shift}` : t.level;
    return `<span class="trust ${t.level}">${label}</span>`;
}
function aboutLabel(p) {
    const a = p.about;
    if (a.kind === "pr")
        return `PR #${a.pr}`;
    if (a.kind === "range")
        return a.range ?? "range";
    return a.kind;
}
function render() {
    if (!plate)
        return;
    $("#plate-title").textContent = plate.title;
    $("#plate-meta").textContent = `${aboutLabel(plate)} · ${plate.head_sha.slice(0, 7)}`;
    const plateDesc = descriptionAt(plate.description, dialLevel);
    const pdEl = $("#plate-desc");
    pdEl.hidden = plateDesc === null;
    pdEl.innerHTML = plateDesc === null ? "" : mdLite(plateDesc);
    const notice = $("#notice");
    if (!plate.source.found) {
        notice.hidden = false;
        notice.textContent = `refs unverified — the plate’s root ${plate.source.path} isn’t on this machine; text and visuals only`;
    }
    else if (!plate.source.git && plate.nibbles.some((nb) => nb.refs.some((r) => r.trust.level === "unverified"))) {
        notice.hidden = false;
        notice.textContent = `${plate.source.path} isn’t a git repository — base..head refs are unverified`;
    }
    else {
        notice.hidden = true;
    }
    $("#progress").textContent = plate.open
        ? `${plate.nibbles.length} nibbles · still being written`
        : `${plate.nibbles.length} of ${plate.total}`;
    const strip = $("#strip");
    // Each card is the visual on the left and a lateral bar on the right: the
    // nibble number, the title (the claim) and its description. Code is reached
    // through the visual's </> chips, so there is no separate ref list.
    strip.innerHTML = plate.nibbles
        .map((nb, i) => {
        const vs = visualSummary(nb.visual);
        const desc = descriptionAt(nb.description, dialLevel);
        return `<article class="nibble${i === active ? " active" : ""}" data-i="${i}">
        <div class="visual">
          <div class="vhead"><span class="kind">${esc(vs.kind)}</span></div>
          <span class="soon">${esc(vs.detail)} — this build has no ${esc(vs.kind)} renderer</span>
          ${vs.anchors.length ? `<div class="anchors">${vs.anchors.map((a) => `<span class="anchor">${esc(a)}</span>`).join("")}</div>` : ""}
        </div>
        <aside class="nside">
          <h2>nibble ${nb.n}</h2>
          <p class="ntitle">${mdLite(nb.title)}</p>
          ${desc !== null ? `<p class="desc">${mdLite(desc)}</p>` : ""}
          ${nb.because ? `<p class="because">over budget because: ${esc(nb.because)}</p>` : ""}
        </aside>
      </article>`;
    })
        .join("");
    // The not-shown ledger ends a diff plate: one last card after the nibbles.
    if (plate.ledger) {
        const card = document.createElement("article");
        card.className = "nibble ledger" + (active === plate.nibbles.length ? " active" : "");
        card.dataset.i = String(plate.nibbles.length);
        const slot = document.createElement("div");
        slot.className = "visual rendered";
        const body = renderLedgerBody(plate.ledger);
        body.classList.add("visual-body");
        slot.appendChild(body);
        card.appendChild(slot);
        const side = document.createElement("aside");
        side.className = "nside";
        side.innerHTML = `<h2>not-shown ledger</h2>
      <p class="ntitle">${plate.ledger.hunks.length === 0
            ? "Every hunk of the diff was shown."
            : "What this walkthrough never showed — the rest of the diff, open to comments."}</p>`;
        card.appendChild(side);
        strip.appendChild(card);
    }
    // Per-kind rendering: swap each card's fallback summary for the rendered
    // visual when a renderer for its kind is registered. A selection survives
    // the rebuild only while its element is drawn at the dial level.
    // (a ledger-card selection has no dial levels to survive — it stays)
    hostSelection = hostSelection && isLedgerCard(hostSelection.card)
        ? hostSelection
        : selectionAfterDial(hostSelection, visualOfCard, dialLevel);
    strip.querySelectorAll(".nibble").forEach((card) => {
        card.addEventListener("click", () => setActive(Number(card.dataset.i)));
        const nb = plate.nibbles[Number(card.dataset.i)];
        if (!nb)
            return; // the ledger card renders its own body above
        const body = renderVisualBody(nb.visual, { n: nb.n, anchored: anchorRefIndex(nb.refs), refs: nb.refs, level: dialLevel, visited: hostVisited });
        if (!body)
            return;
        const slot = card.querySelector(".visual");
        if (!slot)
            return;
        slot.classList.add("rendered");
        slot.querySelector(".soon")?.remove();
        slot.querySelector(".anchors")?.remove();
        body.classList.add("visual-body");
        slot.appendChild(body);
    });
    applySelection(strip);
    updateCommentTarget();
    renderReviewBar();
    camera();
}
// --- the detail dial: one plate-wide level, same canvas, same camera ---
function setDial(level) {
    if (level === dialLevel)
        return;
    dialLevel = level;
    document.querySelectorAll("#dial .dial-pos").forEach((b) => {
        b.classList.toggle("on", b.dataset.level === level);
    });
    render(); // redraw in place: layout is computed from the full document
}
// --- camera: an animated transform, never a navigation ---
function updateCommentTarget() {
    if (!plate || cards() === 0)
        return;
    $("#comment-target").textContent = isLedgerCard(active)
        ? ledgerCommentTarget(hostSelection, active)
        : commentTarget(plate.nibbles[active].n, hostSelection, active);
}
function setActive(i) {
    if (!plate)
        return;
    active = Math.max(0, Math.min(cards() - 1, i));
    document.querySelectorAll(".nibble").forEach((card, idx) => {
        card.classList.toggle("active", idx === active);
    });
    updateCommentTarget();
    $("#pos").textContent = `${active + 1} / ${cards()}`;
    camera();
}
function camera() {
    const strip = $("#strip");
    const card = document.querySelectorAll(".nibble")[active];
    if (!card)
        return;
    const canvas = $("#canvas");
    const x = canvas.clientWidth / 2 - card.offsetLeft - card.offsetWidth / 2;
    strip.style.transform = `translateX(${x}px)`;
    $("#pos").textContent = plate ? `${active + 1} / ${cards()}` : "";
}
// --- code drawer ---
async function openDrawer(n, ref) {
    let resp;
    try {
        resp = await fetch(`api/code?n=${n}&ref=${ref}`);
    }
    catch {
        flash("⚠ the plate’s server is gone — serve has exited; re-run nibble serve and reload");
        return;
    }
    if (!resp.ok)
        return;
    const c = (await resp.json());
    $("#drawer-path").textContent = c.path;
    $("#drawer-trust").outerHTML = trustBadge(c.trust).replace('class="trust', 'id="drawer-trust" class="trust');
    const note = $("#drawer-note");
    if (c.why) {
        note.hidden = false;
        note.textContent = `⚠ ${c.why}`;
    }
    else if (c.missing) {
        note.hidden = false;
        note.textContent = "⚠ this file no longer exists in the worktree";
    }
    else if (c.trust.level === "stale") {
        note.hidden = false;
        note.textContent = "⚠ stale: the referenced code has been rewritten — showing what is at the original range now";
    }
    else if (c.trust.level === "shifted") {
        note.hidden = false;
        note.textContent = `code moved to line ${c.trust.line}; showing it there`;
    }
    else {
        note.hidden = true;
    }
    $("#drawer-code").innerHTML = c.lines
        .map((l) => `<div class="ln${l.in ? " in" : ""}"><span class="no">${l.no}</span><span>${esc(l.text) || " "}</span></div>`)
        .join("");
    $("#drawer").hidden = false;
}
// openLedgerDrawer shows one not-shown hunk's code, served by /api/ledger
// from the side (worktree, base rev, range revs) the hunk lives on.
async function openLedgerDrawer(i) {
    let resp;
    try {
        resp = await fetch(`api/ledger?hunk=${i}`);
    }
    catch {
        flash("⚠ the plate’s server is gone — serve has exited; re-run nibble serve and reload");
        return;
    }
    if (!resp.ok)
        return;
    const c = (await resp.json());
    $("#drawer-path").textContent = c.path;
    $("#drawer-trust").outerHTML = `<span id="drawer-trust" class="trust unverified">not shown · ${esc(c.side)}</span>`;
    const note = $("#drawer-note");
    if (c.why) {
        note.hidden = false;
        note.textContent = `⚠ ${c.why}`;
    }
    else if (c.missing) {
        note.hidden = false;
        note.textContent = "⚠ this file is no longer there";
    }
    else {
        note.hidden = false;
        note.textContent = c.side === "base"
            ? "removed code, shown as it was on the base side"
            : "no nibble referenced these lines";
    }
    $("#drawer-code").innerHTML = c.lines
        .map((l) => `<div class="ln${l.in ? " in" : ""}"><span class="no">${l.no}</span><span>${esc(l.text) || " "}</span></div>`)
        .join("");
    $("#drawer").hidden = false;
}
// --- review ---
function renderReviewBar() {
    if (!plate)
        return;
    const bar = $("#reviewbar");
    const submitted = $("#submitted");
    if (plate.review) {
        bar.classList.add("locked");
        submitted.hidden = false;
        const n = plate.review.comments?.length ?? 0;
        const badge = `<span class="trust ${plate.review.verdict === "approve" ? "exact" : "shifted"}">${esc(plate.review.verdict)}</span>`;
        const comments = n ? ` with ${n} comment${n > 1 ? "s" : ""}` : "";
        submitted.innerHTML = justSent
            ? `review sent: ${badge}${comments} — the agent is awake; you can close this tab`
            : `this plate was reviewed: ${badge}${comments} — you are reading it after the fact`;
        return;
    }
    bar.classList.remove("locked");
    submitted.hidden = true;
    $("#pending").innerHTML = pending
        .map((c, i) => `<span class="pin"><b>${esc(c.target ?? "plate")}</b> ${esc(c.text)} <button data-i="${i}" title="remove">×</button></span>`)
        .join("");
    document.querySelectorAll("#pending button").forEach((btn) => {
        btn.addEventListener("click", () => {
            pending.splice(Number(btn.dataset.i), 1);
            renderReviewBar();
        });
    });
}
function addComment() {
    const input = $("#comment");
    const text = input.value.trim();
    if (!text) {
        input.placeholder = "type the comment first, then pin it";
        input.focus();
        return;
    }
    const target = !plate ? `n${active + 1}`
        : isLedgerCard(active) ? ledgerCommentTarget(hostSelection, active)
            : commentTarget(plate.nibbles[active].n, hostSelection, active);
    pending.push({ target, text });
    input.value = "";
    renderReviewBar();
}
async function submit(verdict) {
    let resp;
    try {
        resp = await fetch("api/review", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: reviewBody(verdict, pending),
        });
    }
    catch {
        flash("⚠ could not submit — serve has exited; re-run nibble serve and reload");
        return;
    }
    if (resp.ok || resp.status === 409) {
        justSent = true;
        await loadPlate();
        // The review ended serve; this tab's job is done. Browsers only honor
        // close() for single-entry tabs — the locked state is the fallback.
        setTimeout(() => window.close(), 900);
    }
    else {
        const body = await resp.text();
        flash(`⚠ review rejected: ${body.slice(0, 200)}`);
    }
}
// --- data + live events ---
async function loadPlate() {
    const resp = await fetch("api/plate");
    if (!resp.ok)
        return;
    plate = (await resp.json());
    active = Math.min(active, Math.max(0, cards() - 1));
    render();
}
function listen() {
    const es = new EventSource("api/events");
    es.addEventListener("nibble", () => void loadPlate());
    es.addEventListener("sealed", () => void loadPlate());
    es.addEventListener("review", () => void loadPlate());
}
// --- wire up ---
$("#prev").addEventListener("click", () => setActive(active - 1));
$("#next").addEventListener("click", () => setActive(active + 1));
document.querySelectorAll("#dial .dial-pos").forEach((btn) => {
    btn.addEventListener("click", () => setDial(btn.dataset.level));
});
$("#drawer-close").addEventListener("click", () => ($("#drawer").hidden = true));
const legend = $("#legend");
$("#comment-add").addEventListener("click", addComment);
$("#comment").addEventListener("keydown", (e) => {
    if (e.key === "Enter")
        addComment();
});
// Choosing a verdict is a draft; only "send review" posts it.
document.querySelectorAll(".verdict").forEach((btn) => {
    btn.addEventListener("click", () => {
        chosen = btn.dataset.verdict ?? null;
        document.querySelectorAll(".verdict").forEach((b) => {
            b.classList.toggle("selected", b === btn);
        });
        const send = $("#send");
        send.disabled = false;
        send.textContent = `send review · ${btn.textContent}`;
    });
});
$("#send").addEventListener("click", () => {
    if (chosen)
        void submit(chosen);
});
document.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement)
        return;
    if (e.key === "ArrowLeft")
        setActive(active - 1);
    if (e.key === "ArrowRight")
        setActive(active + 1);
    if (e.key === " ") {
        // space steps the active visual (sequence steps, etc.), shift reverses
        const body = document.querySelector(".nibble.active .visual-body");
        if (body) {
            e.preventDefault();
            body.dispatchEvent(new CustomEvent("stepvisual", { detail: { delta: e.shiftKey ? -1 : 1 } }));
        }
    }
    if (e.key === "d")
        setDial(dialToggle(dialLevel));
    if (e.key === "?")
        legend.classList.toggle("pinned");
    if (e.key === "s" && chosen && plate && !plate.review)
        void submit(chosen);
    if (e.key === "Escape") {
        if (legend.classList.contains("pinned"))
            legend.classList.remove("pinned");
        else if (!$("#drawer").hidden)
            $("#drawer").hidden = true;
        else
            clearVisualSelection($("#strip"), hostWiring);
    }
});
window.addEventListener("resize", camera);
legend.addEventListener("transitionend", camera);
const hostWiring = {
    openRef: (n, ref) => void openDrawer(n, ref),
    onTarget: updateCommentTarget,
};
// Ledger chips open the ledger drawer; registered before the host wiring so
// stopImmediatePropagation keeps a chip click from toggling the row's
// selection, mirroring how code chips behave inside visuals.
$("#strip").addEventListener("click", (e) => {
    const chip = e.target?.closest?.("[data-ledger-hunk]");
    if (!chip)
        return;
    e.stopImmediatePropagation();
    void openLedgerDrawer(Number(chip.getAttribute("data-ledger-hunk")));
});
wireVisualHost($("#strip"), hostWiring);
void loadPlate();
listen();

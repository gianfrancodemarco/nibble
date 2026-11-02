"use strict";
// The visual host — the seam between the shell and the per-kind renderers.
// Renderers register themselves in visualRenderers (one file per kind,
// concatenated by tsc in tsconfig order), mark addressable elements with
// data-anchor, and ask the host for code chips. Selection, comment targets
// and the drawer affordance are wired once, here. No top-level DOM access:
// this file is also part of the node-run test build.
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
                hostSelection = nextSelection(hostSelection, Number(card.dataset.i), id);
                applySelection(strip);
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
            wiring.openRef(Number(chip.getAttribute("data-n")), Number(chip.getAttribute("data-code")));
        }
    });
}
// map — services and modules as tiered columns. Layout is pure (tested in
// test/map.test.ts); rendering builds SVG on top of it and registers with
// the host.
const MAP_TIERS = ["edge", "service", "data"];
function layoutMap(v) {
    const PAD = 24, VGAP = 22, HGAP = 90, NODE_H = 46;
    const nodeW = (n) => Math.max(96, 20 + n.label.length * 7.5 + 40);
    const colOf = (n) => n.tier ?? "service";
    const present = MAP_TIERS.filter((t) => v.nodes.some((n) => colOf(n) === t));
    // Within a column: declaration order, with group members pulled together
    // at the first member's position.
    const cols = present.map((tier) => {
        const list = v.nodes.filter((n) => colOf(n) === tier);
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
    });
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
    const l = layoutMap(v);
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
    const byId = new Map(l.nodes.map((n) => [n.id, n]));
    const edgesG = svgEl("g");
    for (const e of v.edges ?? []) {
        const a = byId.get(e.from);
        const b = byId.get(e.to);
        if (!a || !b)
            continue; // validation forbids this; stay defensive
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
    }
    svg.appendChild(edgesG);
    const nodesG = svgEl("g");
    for (const n of v.nodes) {
        const b = byId.get(n.id);
        if (!b)
            continue;
        const g = svgEl("g", {
            class: "node" + (n.focus ? " focus" : ""),
            "data-anchor": n.id,
            transform: `translate(${b.x} ${b.y})`,
        });
        g.appendChild(svgEl("title", {}, n.detail ? `${n.label} — ${n.detail}` : n.label));
        g.appendChild(svgEl("rect", { width: b.w, height: b.h, rx: 10 }));
        g.appendChild(svgEl("text", { x: 12, y: b.h / 2 + 4.5 }, n.label));
        const chip = codeChip(ctx, n.id, b.w - 34, b.h / 2);
        if (chip)
            g.appendChild(chip);
        nodesG.appendChild(g);
    }
    svg.appendChild(nodesG);
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
    const l = layoutSequence(v);
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
    // step control: ▸ advances, ◂ goes back, clicking a step jumps to it
    let shown = 0;
    const total = v.steps.length;
    const ctrl = svgEl("g", { class: "seq-ctrl", transform: `translate(${l.w - 92} ${l.h - 14})` });
    const back = svgEl("text", { x: 0, y: 0, class: "btn", role: "button" }, "◂");
    const fwd = svgEl("text", { x: 18, y: 0, class: "btn", role: "button" }, "▸");
    const counter = svgEl("text", { x: 40, y: 0, class: "count" }, "");
    ctrl.append(back, fwd, counter);
    svg.appendChild(ctrl);
    const apply = () => {
        stepsG.querySelectorAll(".step").forEach((g) => {
            const i = Number(g.getAttribute("data-step"));
            g.classList.toggle("done", i < shown);
            g.classList.toggle("cur", i === shown - 1);
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
        shown = Number(g.getAttribute("data-step")) + 1;
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
    const { states, defaultIndex } = tlStatesOf(v);
    const axis = tlAxis(v);
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
        for (const e of states[stateIdx].events) {
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
        const times = [...new Set(states[stateIdx].events.map((ev) => tlParseAt(ev.at)))].sort((a, b) => a - b);
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
const pending = [];
// --- tiny markdown: captions are "one or two sentences", bold/code/italic ---
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
    const notice = $("#notice");
    if (!plate.source.found) {
        notice.hidden = false;
        notice.textContent = `refs unverified — the plate’s root ${plate.source.path} isn’t on this machine; captions and visuals only`;
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
    strip.innerHTML = plate.nibbles
        .map((nb, i) => {
        const vs = visualSummary(nb.visual);
        const refs = nb.refs
            .map((r, ri) => `<button class="ref" data-n="${nb.n}" data-ref="${ri}">
            <span>${esc(r.path)}</span><span class="range">:${r.start}${r.end > r.start ? "-" + r.end : ""}</span>
            ${r.anchor ? `<span class="anchor">@${esc(r.anchor)}</span>` : ""}
            ${trustBadge(r.trust)}</button>`)
            .join("");
        return `<article class="nibble${i === active ? " active" : ""}" data-i="${i}">
        <h2>nibble ${nb.n}</h2>
        <div class="visual">
          <div class="vhead"><span class="kind">${esc(vs.kind)}</span><span class="vtitle">${esc(vs.title)}</span></div>
          <span class="soon">${esc(vs.detail)} — this build has no ${esc(vs.kind)} renderer</span>
          ${vs.anchors.length ? `<div class="anchors">${vs.anchors.map((a) => `<span class="anchor">${esc(a)}</span>`).join("")}</div>` : ""}
        </div>
        <p class="caption">${mdLite(nb.caption)}</p>
        ${nb.because ? `<p class="because">over budget because: ${esc(nb.because)}</p>` : ""}
        <div class="refs">${refs}</div>
      </article>`;
    })
        .join("");
    // Per-kind rendering: swap each card's fallback summary for the rendered
    // visual when a renderer for its kind is registered.
    hostSelection = null;
    strip.querySelectorAll(".nibble").forEach((card) => {
        card.addEventListener("click", () => setActive(Number(card.dataset.i)));
        const nb = plate.nibbles[Number(card.dataset.i)];
        const body = renderVisualBody(nb.visual, { n: nb.n, anchored: anchorRefIndex(nb.refs), refs: nb.refs });
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
    strip.querySelectorAll(".ref").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            void openDrawer(Number(btn.dataset.n), Number(btn.dataset.ref));
        });
    });
    renderReviewBar();
    camera();
}
// --- camera: an animated transform, never a navigation ---
function updateCommentTarget() {
    if (!plate || plate.nibbles.length === 0)
        return;
    $("#comment-target").textContent = commentTarget(plate.nibbles[active].n, hostSelection, active);
}
function setActive(i) {
    if (!plate)
        return;
    active = Math.max(0, Math.min(plate.nibbles.length - 1, i));
    document.querySelectorAll(".nibble").forEach((card, idx) => {
        card.classList.toggle("active", idx === active);
    });
    updateCommentTarget();
    $("#pos").textContent = `${active + 1} / ${plate.nibbles.length}`;
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
    $("#pos").textContent = plate ? `${active + 1} / ${plate.nibbles.length}` : "";
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
    pending.push({ target: plate ? commentTarget(plate.nibbles[active].n, hostSelection, active) : `n${active + 1}`, text });
    input.value = "";
    renderReviewBar();
}
async function submit(verdict) {
    let resp;
    try {
        resp = await fetch("api/review", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ verdict, comments: pending }),
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
    active = Math.min(active, Math.max(0, plate.nibbles.length - 1));
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
wireVisualHost($("#strip"), hostWiring);
void loadPlate();
listen();

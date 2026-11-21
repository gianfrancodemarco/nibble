"use strict";
// Per-language syntax highlighting: the seam between the served file path
// and the vendored highlight.js bundle. Pure and DOM-free so the node test
// build exercises it against the real grammars. The path decides the
// language — never content sniffing — and anything unmapped renders as
// plain escaped text.
// langOf: the highlight.js language name for a file path, or null for
// anything the reader does not highlight. Curation lives here: the bundle
// carries more grammars, but only these ten are ever used.
const HL_LANGS = {
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
function langOf(path) {
    const dot = path.lastIndexOf(".");
    if (dot <= 0 || dot === path.length - 1)
        return null;
    return HL_LANGS[path.slice(dot + 1).toLowerCase()] ?? null;
}
function escPlain(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
// splitHighlighted: hljs highlights the excerpt whole (that is what keeps a
// multi-line comment or raw string colored on every line), but the drawer
// renders line divs. Walk the flat span markup, close the open spans at each
// newline and reopen them on the next line, so every returned line is
// well-formed HTML on its own.
function splitHighlighted(html) {
    const lines = [];
    const open = [];
    let cur = "";
    let i = 0;
    while (i < html.length) {
        const ch = html[i];
        if (ch === "\n") {
            lines.push(cur + "</span>".repeat(open.length));
            cur = open.join("");
            i++;
        }
        else if (ch === "<") {
            const end = html.indexOf(">", i);
            const tag = html.slice(i, end + 1);
            if (tag.startsWith("</"))
                open.pop();
            else
                open.push(tag);
            cur += tag;
            i = end + 1;
        }
        else {
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
function highlightLines(path, lines) {
    const lang = langOf(path);
    const engine = globalThis.hljs;
    const plain = () => lines.map((l) => escPlain(l) || " ");
    if (!lang || !engine || !engine.getLanguage(lang))
        return plain();
    const out = splitHighlighted(engine.highlight(lines.join("\n"), { language: lang, ignoreIllegals: true }).value);
    return out.length === lines.length ? out.map((l) => l || " ") : plain();
}
// Prose — the reader's tiny markdown, now with anchor links. Nibble titles
// and descriptions may name visual elements with [phrase](@id) (validated
// against the visual by the CLI; the reader trusts what it is served). This
// file is pure string logic, part of the node test build: no DOM access.
function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
// inline formatting over escaped text: bold/code/italic only, by design.
function mdLite(s) {
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
function maskCodeSpans(md) {
    return md.replace(CODE_SPAN_RE, (m) => " ".repeat(m.length));
}
// linkIds: the anchor ids a prose string links, in order.
function linkIds(md) {
    const out = [];
    const masked = maskCodeSpans(md);
    for (const m of masked.matchAll(PROSE_LINK_RE))
        out.push(m[2]);
    return out;
}
// proseToHtml renders nibble prose: mdLite plus the link rule. A link whose
// element is drawn at the current dial level becomes an interactive phrase;
// an undrawn one stays readable but inert (spec: prose links follow the
// dial). The id charset is attribute-safe by construction.
function proseToHtml(md, drawn) {
    const masked = maskCodeSpans(md);
    let out = "";
    let at = 0;
    for (const m of masked.matchAll(PROSE_LINK_RE)) {
        const start = m.index;
        out += mdLite(md.slice(at, start));
        const phrase = mdLite(md.slice(start + 1, start + 1 + m[1].length));
        out += drawn(m[2])
            ? `<a class="plink" data-link-anchor="${m[2]}" tabindex="0">${phrase}</a>`
            : `<span class="plink-inert">${phrase}</span>`;
        at = start + m[0].length;
    }
    return out + mdLite(md.slice(at));
}
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
// reviewBody builds the exact JSON the review POST sends: the comments,
// nothing else — visited state stays in this tab. No comments means done.
function reviewBody(comments) {
    return JSON.stringify({ comments });
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
// --- prose ↔ visual links: the two-way hover handshake ---
// hoverCounterpart: what the other side of the handshake is, as a selector
// scoped to the hovered node's card. A prose phrase (data-link-anchor)
// lights its element; an addressable element (data-anchor) lights every
// phrase that names it; anything else lights nothing. Ids are in the
// ref-anchor charset, so they are selector-safe.
function hoverCounterpart(linkAnchor, anchor) {
    if (linkAnchor)
        return `[data-anchor="${linkAnchor}"]`;
    if (anchor)
        return `.plink[data-link-anchor="${anchor}"]`;
    return null;
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
// codeChipSelector: the card-scoped selector for an anchored element's code
// chip. Chips carry data-for so the chip is findable from the element's id
// alone — the compare renderer places its chip beside, not inside, the
// [data-anchor] node. Ids share the ref-anchor charset: selector-safe.
function codeChipSelector(id) {
    return `[data-code][data-for="${id}"]`;
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
        class: "code-chip", "data-code": act.ref, "data-n": act.n, "data-for": id,
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
    b.dataset.for = id;
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
        // linked phrases follow the selection, so prose and picture read as one
        card.querySelectorAll(".plink").forEach((el) => {
            el.classList.toggle("sel", selId !== null && el.getAttribute("data-link-anchor") === selId);
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
    // selectId: the one selection path — element clicks and prose-link clicks
    // both land here, so targets and visited state cannot diverge.
    const selectId = (card, id, force = false) => {
        const idx = Number(card.dataset.i);
        if (force && hostSelection && hostSelection.card === idx && hostSelection.id === id)
            return;
        const first = !hostVisited.has(id);
        hostSelection = selectAndVisit(hostSelection, idx, id);
        applySelection(strip);
        if (first)
            applyVisited(strip);
        wiring.onTarget();
        // a fresh selection also opens the element's code, when it carries any;
        // a toggle-off never does, and the chip's own path stays select-free
        if (hostSelection) {
            const chip = card.querySelector(codeChipSelector(id));
            if (chip)
                wiring.openRef(Number(chip.getAttribute("data-n")), Number(chip.getAttribute("data-code")));
        }
    };
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
        // either side of the prose ↔ visual handshake selects the element
        const el = t.closest("[data-anchor]") ?? t.closest(".plink[data-link-anchor]");
        const card = t.closest(".nibble");
        if (!card)
            return;
        if (el) {
            const id = el.getAttribute("data-anchor") ?? el.getAttribute("data-link-anchor");
            if (id)
                selectId(card, id);
        }
        else if (hostSelection && hostSelection.card === Number(card.dataset.i)) {
            // background click inside the card clears its selection
            clearVisualSelection(strip, wiring);
        }
    });
    strip.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ")
            return;
        const t = e.target;
        const chip = t?.closest?.("[data-code]");
        if (chip) {
            e.preventDefault();
            const anchorId = chip.closest("[data-anchor]")?.getAttribute("data-anchor");
            if (anchorId && markVisited(anchorId))
                applyVisited(strip);
            wiring.openRef(Number(chip.getAttribute("data-n")), Number(chip.getAttribute("data-code")));
            return;
        }
        // Enter on a focused prose link selects, like clicking it (a .plink is
        // an <a> without href, so the browser gives it no default activation)
        if (e.key !== "Enter")
            return;
        const pl = t?.closest?.(".plink[data-link-anchor]");
        const card = t?.closest?.(".nibble");
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
    let litNode = null;
    const hoverNode = (t) => t instanceof Element ? t.closest("[data-link-anchor], [data-anchor]") : null;
    const relight = (node) => {
        if (node === litNode)
            return;
        strip.querySelectorAll(".lit").forEach((el) => el.classList.remove("lit"));
        litNode = node;
        if (!node)
            return;
        const sel = hoverCounterpart(node.getAttribute("data-link-anchor"), node.getAttribute("data-anchor"));
        const card = node.closest(".nibble");
        if (!sel || !card)
            return;
        card.querySelectorAll(sel).forEach((el) => el.classList.add("lit"));
    };
    strip.addEventListener("mouseover", (e) => relight(hoverNode(e.target)));
    strip.addEventListener("mouseout", (e) => {
        if (!hoverNode(e.relatedTarget))
            relight(null);
    });
    strip.addEventListener("focusin", (e) => relight(hoverNode(e.target)));
    strip.addEventListener("focusout", (e) => {
        if (!hoverNode(e.relatedTarget))
            relight(null);
    });
    return { select: selectId };
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
    const PAD = 24, HGAP = 90, NODE_H = MAP_NODE_H;
    const nodeW = mapNodeW;
    const colOf = (n) => n.tier ?? "service";
    const present = MAP_TIERS.filter((t) => v.nodes.some((n) => colOf(n) === t));
    const cols = present.map((tier) => mapGroupOrder(v.nodes.filter((n) => colOf(n) === tier)));
    // An edge between two nodes of the same column runs vertically through the
    // row gap, which then has to hold an arrowhead and a label beside the line;
    // a plain stack stays tight.
    const colIdx = new Map();
    cols.forEach((c, i) => c.forEach((n) => colIdx.set(n.id, i)));
    const VGAP = (v.edges ?? []).some((e) => colIdx.has(e.from) && colIdx.get(e.from) === colIdx.get(e.to)) ? 58 : 22;
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
// mapEdgeSide: an edge that has a twin running the other way between the
// same two nodes bends to one side (-1 or 1, the earlier-declared one
// first) so the pair reads as two arrows instead of one line drawn twice,
// with the labels on opposite sides. A lone edge is straight (0).
function mapEdgeSide(edges, ei) {
    const e = edges[ei];
    const twin = edges.findIndex((o, i) => i !== ei && o.from === e.to && o.to === e.from);
    if (twin < 0)
        return 0;
    return twin > ei ? -1 : 1;
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
        // A twin pair bends apart: each curve bows out of the straight line by
        // BOW on its own side, and its label follows it there.
        const side = mapEdgeSide(v.edges ?? [], ei);
        const BOW = 18 * side;
        const d = horizontal
            ? `M ${x1} ${y1 + BOW / 2} C ${(x1 + x2) / 2} ${y1 + BOW}, ${(x1 + x2) / 2} ${y2 + BOW}, ${x2} ${y2 + BOW / 2}`
            : `M ${x1 + BOW / 2} ${y1} C ${x1 + BOW} ${(y1 + y2) / 2}, ${x2 + BOW} ${(y1 + y2) / 2}, ${x2 + BOW / 2} ${y2}`;
        const g = svgEl("g", { class: `edge ${e.style ?? "flow"}`, "data-from": e.from, "data-to": e.to });
        g.appendChild(svgEl("path", { d, "marker-end": `url(#${uid}-arr)` }));
        g.appendChild(svgEl("title", {}, e.label ?? ""));
        // A horizontal label sits above its edge and must fit the gap between
        // the boxes, or it would clip behind them (ring rows sit much closer
        // than tier columns). A vertical label can never fit the row gap above
        // the line, so it sits beside the line instead, vertically centred in
        // the gap — never under a box.
        if (e.label) {
            if (horizontal) {
                if (Math.abs(x2 - x1) > e.label.length * 6.5) {
                    // above the line, or below it for the twin that bows downwards
                    const below = side > 0;
                    g.appendChild(svgEl("text", {
                        x: (x1 + x2) / 2, y: (y1 + y2) / 2 + BOW + (below ? 14 : -7), "text-anchor": "middle", class: "elabel",
                    }, e.label));
                }
            }
            else {
                const left = side < 0;
                g.appendChild(svgEl("text", {
                    x: (x1 + x2) / 2 + BOW + (left ? -8 : 8), y: (y1 + y2) / 2 + 3.5, "text-anchor": left ? "end" : "start", class: "elabel",
                }, e.label));
            }
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
            // A centred label would clip past the plot edges near either end of the
            // axis, so it flips to grow inward instead.
            const half = e.label.length * 3.4;
            const right = PADL + labelW + plotW;
            const anchor = ex + half > right + 24 ? "end" : ex - half < PADL + labelW - 8 ? "start" : "middle";
            g.appendChild(svgEl("text", { x: ex, y: above, "text-anchor": anchor, class: "ev-label" }, e.label));
            if (e.id) {
                // the chip sits to the event's right unless that would leave the plot
                const chip = codeChip(ctx, e.id, ex + 34 > right + 24 ? ex - 34 : ex + 8, y + 16);
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
                const hl = highlightLines(resp.path, resp.lines.map((l) => l.text));
                body.innerHTML = resp.lines
                    .map((l, i) => `<div class="ln${l.in ? " in" : ""}"><span class="no">${l.no}</span><span>${hl[i]}</span></div>`)
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
// fileRowId is a row's stable id on the card — also the second half of its
// comment target, so the agent reads `ledger:src/b.ts` straight back to a
// file of the diff. Deleted-lines rows carry #base: same file, other side.
function fileRowId(row) {
    return row.side === "base" ? `${row.path}#base` : row.path;
}
// ledgerFileLabel is the row's summary: side, the uncovered hunks' line
// ranges (first three, then a count), summed +/− over the whole file. A
// fully covered row lists no ranges; binary files have no lines to range.
function ledgerFileLabel(row) {
    if (row.binary)
        return `${row.side} · binary`;
    const range = (h) => h.end > h.start ? `${h.start}–${h.end}` : `${h.start}`;
    const unshown = row.hunks.filter((h) => !h.covered);
    let ranges = unshown.slice(0, 3).map(range).join(", ");
    if (unshown.length > 3)
        ranges += ` +${unshown.length - 3} more`;
    const where = ranges ? ` ${ranges}` : "";
    return `${row.side}${where} · +${row.added} −${row.removed}`;
}
// ledgerBadge marks how much of a row the walkthrough showed: everything,
// a part, or nothing (no badge — the row speaks for itself).
function ledgerBadge(row) {
    if (row.coveredCount === row.hunks.length)
        return "shown";
    if (row.coveredCount > 0)
        return `${row.coveredCount}/${row.hunks.length} shown`;
    return "";
}
// ledgerTree nests the file rows under their directories, first-appearance
// order, collapsing every directory that holds nothing but one directory.
function ledgerTree(rows) {
    const root = { name: "", dirs: [], files: [] };
    for (const row of rows) {
        const parts = row.path.split("/");
        let dir = root;
        for (const part of parts.slice(0, -1)) {
            let next = dir.dirs.find((d) => d.name === part);
            if (!next) {
                next = { name: part, dirs: [], files: [] };
                dir.dirs.push(next);
            }
            dir = next;
        }
        dir.files.push({ name: parts[parts.length - 1], row });
    }
    const collapse = (dir) => {
        while (dir.dirs.length === 1 && dir.files.length === 0 && dir.name !== "") {
            dir = { ...dir.dirs[0], name: `${dir.name}/${dir.dirs[0].name}` };
        }
        dir.dirs = dir.dirs.map(collapse);
        return dir;
    };
    root.dirs = root.dirs.map(collapse);
    return root;
}
// ledgerFileRows groups hunks into one row per (path, side) pair,
// first-appearance order.
function ledgerFileRows(hunks) {
    const rows = [];
    const byKey = new Map();
    for (const hunk of hunks) {
        const key = `${hunk.side}\n${hunk.path}`;
        let row = byKey.get(key);
        if (!row) {
            row = { path: hunk.path, side: hunk.side, binary: false, added: 0, removed: 0, coveredCount: 0, hunks: [] };
            byKey.set(key, row);
            rows.push(row);
        }
        row.hunks.push(hunk);
        row.added += hunk.added;
        row.removed += hunk.removed;
        row.binary = row.binary || hunk.binary === true;
        if (hunk.covered)
            row.coveredCount++;
    }
    return rows;
}
function ledgerFullyCovered(l) {
    return l.shown === l.total;
}
// cardCount: the strip's cards — the nibbles, plus the ledger card when the
// plate carries a ledger (even an empty one: full coverage is still said).
function cardCount(nibbles, ledger) {
    return nibbles + (ledger ? 1 : 0);
}
// ledgerCommentTarget: comments pin to the ledger as a whole, or to one
// file row selected on the ledger card.
function ledgerCommentTarget(sel, ledgerCard) {
    return sel && sel.card === ledgerCard ? `ledger:${sel.id}` : "ledger";
}
// --- rendering (DOM; the shell appends the result to the strip) ---
// renderLedgerBody builds the ledger card's content. File rows carry
// data-anchor (the host's selection/comment wiring picks them up) and a
// data-ledger-path chip the shell wires to the ledger drawer.
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
        if (l.hunks.length > 0) {
            body.appendChild(renderLedgerDir(ledgerTree(ledgerFileRows(l.hunks)), true));
        }
        return body;
    }
    count.textContent = `${l.total - l.shown} of ${l.total} hunks never came up — worth a look before you answer`;
    body.appendChild(count);
    body.appendChild(renderLedgerDir(ledgerTree(ledgerFileRows(l.hunks)), true));
    return body;
}
// renderLedgerDir renders one directory of the ledger tree: its name, its
// subdirectories, then its file rows.
function renderLedgerDir(dir, root) {
    const el = document.createElement("div");
    el.className = root ? "ledger-tree" : "ledger-dir";
    if (!root) {
        const name = document.createElement("div");
        name.className = "ledger-dirname mono";
        name.textContent = dir.name + "/";
        el.appendChild(name);
    }
    for (const sub of dir.dirs)
        el.appendChild(renderLedgerDir(sub, false));
    for (const f of dir.files) {
        const row = document.createElement("div");
        row.className = "ledger-file";
        row.setAttribute("data-anchor", fileRowId(f.row));
        row.setAttribute("role", "button");
        row.setAttribute("tabindex", "0");
        const name = document.createElement("span");
        name.className = "ledger-path mono";
        name.textContent = f.name + (f.row.side === "base" ? " (deleted lines)" : "");
        row.appendChild(name);
        const badge = ledgerBadge(f.row);
        if (badge) {
            const b = document.createElement("span");
            b.className = "ledger-badge" + (badge === "shown" ? " covered" : "");
            b.textContent = badge;
            row.appendChild(b);
        }
        const label = document.createElement("span");
        label.className = "ledger-meta";
        label.textContent = ledgerFileLabel(f.row);
        row.appendChild(label);
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "code-chip-h";
        chip.dataset.ledgerPath = f.row.path;
        chip.dataset.ledgerSide = f.row.side;
        chip.textContent = "</>";
        chip.title = "open this file's hunks";
        row.appendChild(chip);
        el.appendChild(row);
    }
    return el;
}
// Live reading: the pure decisions behind streaming, kept out of the DOM so
// the node test build can exercise them. app.ts owns the wiring.
function progressLabel(open, nibbles, total) {
    if (open) {
        return { text: `${nibbles} nibble${nibbles === 1 ? "" : "s"} · still being written`, live: true };
    }
    return { text: `${nibbles} of ${total} · sealed`, live: false };
}
function plateShape(nibbles, open, thread, ledger) {
    return { nibbles: nibbles.map((n) => JSON.stringify(n)), open, thread: JSON.stringify(thread ?? null), ledger };
}
// arrivalPlan: append only when the shown plate is a strict prefix of the
// new one — new nibbles at the end, or the ledger card (and sealed state)
// arriving at the seal. A reload where only the thread differs (a reply, a
// new round) patches the conversation in place; the strip is untouched.
// Anything else that differs rebuilds wholesale; identical shapes do
// nothing.
function arrivalPlan(prev, next) {
    if (!prev)
        return "rebuild";
    const threadMoved = prev.thread !== next.thread;
    const cardsPlan = cardsArrivalPlan(prev, next);
    if (!threadMoved)
        return cardsPlan;
    return cardsPlan === "none" ? "thread" : "rebuild";
}
function cardsArrivalPlan(prev, next) {
    if (next.nibbles.length < prev.nibbles.length)
        return "rebuild";
    for (let i = 0; i < prev.nibbles.length; i++) {
        if (prev.nibbles[i] !== next.nibbles[i])
            return "rebuild";
    }
    if (prev.ledger && !next.ledger)
        return "rebuild";
    // The ledger card sits after the last nibble: nibbles arriving once it is
    // on screen would land at its index, so that malformed stream rebuilds.
    if (prev.ledger && next.nibbles.length > prev.nibbles.length)
        return "rebuild";
    const grew = next.nibbles.length > prev.nibbles.length || (!prev.ledger && next.ledger);
    if (grew || prev.open !== next.open)
        return "append";
    return "none";
}
function latestWins() {
    let seq = 0;
    return {
        begin: () => ++seq,
        isCurrent: (token) => token === seq,
    };
}
// --- stepping the camera ---
// stepCard: the card a step lands on — clamped to the strip, and 0 on an
// empty strip (the ghost holds the camera until the first card lands).
function stepCard(active, delta, count) {
    if (count <= 0)
        return 0;
    return Math.max(0, Math.min(count - 1, active + delta));
}
// The chat: the pure decisions behind the conversation panel — reassembling
// threads from the server's rounds, placing drafts, mapping targets to
// cards and elements, counting badges, and wording the turn. No DOM here:
// the node test build exercises it; app.ts owns the rendering.
const NEW_THREAD = "new:";
// buildThreads reassembles the conversation: one thread per opener in the
// order the openers were written, replies and follow-ups interleaved round
// by round, drafts appended to the thread they continue — or grouped by
// target into a new thread at the end when no sent thread exists for it.
function buildThreads(thread, drafts) {
    const out = [];
    const index = new Map();
    const agentTurn = thread?.turn === "agent";
    for (const r of thread?.rounds ?? []) {
        r.comments.forEach((c, i) => {
            const key = c.thread ?? c.id;
            let ti = index.get(key);
            if (ti === undefined) {
                ti = out.length;
                index.set(key, ti);
                const th = { key, id: key, target: c.target ?? "", messages: [], awaiting: false };
                if (c.ref) {
                    th.ref = c.ref;
                    th.lines = c.ref.ref;
                }
                out.push(th);
            }
            const th = out[ti];
            th.messages.push({ from: "reader", round: r.n, id: c.id, text: c.text });
            if (c.reply) {
                th.messages.push({
                    from: "agent", round: r.n, text: c.reply.text, refs: c.reply.refs,
                    because: c.reply.because, at: { round: r.n, comment: i + 1 },
                });
                th.awaiting = false;
            }
            else {
                th.awaiting = agentTurn;
            }
        });
    }
    for (const d of drafts) {
        let ti;
        if (d.thread !== undefined)
            ti = index.get(d.thread);
        if (ti === undefined) {
            const key = d.thread !== undefined ? d.thread : NEW_THREAD + (d.target ?? "") + "|" + (d.ref ?? "");
            ti = index.get(key);
            if (ti === undefined) {
                ti = out.length;
                index.set(key, ti);
                const th = { key, id: null, target: d.target ?? "", messages: [], awaiting: false };
                if (d.ref)
                    th.lines = d.ref;
                out.push(th);
            }
        }
        out[ti].messages.push({ from: "draft", text: d.text, draftKey: d.key });
    }
    return out;
}
// sentThreadOn: the sent thread (opener id) a place already has, if any — a
// new message there continues it rather than opening a second. A place is
// a target plus the lines: other lines of the same element are elsewhere.
function sentThreadOn(threads, target, lines) {
    for (const th of threads) {
        if (th.id !== null && th.target === target && (th.lines ?? "") === (lines ?? ""))
            return th.id;
    }
    return null;
}
// draftComments turns drafts into the review's comments: a follow-up carries
// its thread and no target of its own; an opener carries its target and, on
// lines, the ref the reader built — the server verifies and fingerprints it.
function draftComments(drafts) {
    return drafts.map((d) => {
        if (d.thread !== undefined)
            return { thread: d.thread, text: d.text };
        return { ...(d.target ? { target: d.target } : {}), ...(d.ref ? { ref: { ref: d.ref } } : {}), text: d.text };
    });
}
// selectLine: the gutter's reducer. A click selects one line; with shift it
// extends the selection to a contiguous range either way; clicking the
// only selected line clears; clicking inside a range narrows to that line.
function selectLine(cur, no, extend) {
    if (cur && extend)
        return { start: Math.min(cur.start, no), end: Math.max(cur.end, no) };
    if (cur && cur.start === no && cur.end === no)
        return null;
    return { start: no, end: no };
}
// lineRef: the ref string for selected lines of a drawer — its address
// (from the server) and the numbers it showed; the server parses it.
function lineRef(at, sel) {
    return sel.end > sel.start ? `${at}:${sel.start}-${sel.end}` : `${at}:${sel.start}`;
}
// linesLabel: `<path>:<range>` out of a ref string, for a chip or a label —
// the only grammar the reader reads, and only to show it.
function linesLabel(ref) {
    const m = /^diff:([^@\s]+)@[^:\s]*:(\d+(?:-\d+)?)/.exec(ref);
    if (m)
        return `${m[1]}:${m[2]}`;
    const i = ref.indexOf(" ");
    return i > 0 ? ref.slice(0, i) : ref;
}
// destinationLabel: what the composer says it writes — a new thread on the
// lines in the target, or a reply in the thread there.
function destinationLabel(kind, target, lines) {
    const name = target || "plate";
    if (kind === "reply")
        return lines ? `reply in ${name} · ${linesLabel(lines)}` : `reply in ${name}`;
    return lines ? `new thread on ${linesLabel(lines)} in ${name}` : `new thread on ${name}`;
}
// drawerBadges: for a drawer showing `at`'s lines, the threads on lines of
// it — badged on the first shown line of each thread's trust-resolved
// range (shifted follows the code; stale keeps the original range, which is
// what the drawer shows for it too).
function drawerBadges(threads, at, shown) {
    const out = new Map();
    for (const th of threads) {
        const r = th.ref;
        if (!r || r.at !== at)
            continue;
        const start = r.trust.level === "shifted" ? r.trust.line : r.start;
        const end = start + (r.end - r.start);
        const first = shown.find((no) => no >= start && no <= end);
        if (first === undefined)
            continue;
        const cur = out.get(first);
        if (cur)
            cur.count += th.messages.length;
        else
            out.set(first, { count: th.messages.length, key: th.key });
    }
    return out;
}
// --- targets → the plate ---
// cardOfTarget: which card a target lives on — nibble N for n<N>…, the
// ledger card for ledger…, the first card for an untargeted comment, null
// for a nibble the plate does not have.
function cardOfTarget(target, nibbles, hasLedger) {
    if (!target)
        return nibbles > 0 || hasLedger ? 0 : null;
    if (target.startsWith("ledger"))
        return hasLedger ? nibbles : null;
    const m = /^n(\d+)(?::|$)/.exec(target);
    if (!m)
        return null;
    const n = Number(m[1]);
    return n >= 1 && n <= nibbles ? n - 1 : null;
}
// anchorOfTarget: the element id a target names on its card, or null for a
// whole-card target (n2, ledger, untargeted).
function anchorOfTarget(target) {
    if (!target)
        return null;
    if (target.startsWith("ledger:"))
        return target.slice("ledger:".length) || null;
    const i = target.indexOf(":");
    return i > 0 ? target.slice(i + 1) || null : null;
}
function badgeCounts(threads, nibbles, hasLedger) {
    const cards = new Map();
    const elements = new Map();
    const keys = new Map();
    for (const th of threads) {
        const card = cardOfTarget(th.target, nibbles, hasLedger);
        if (card === null)
            continue;
        const n = th.messages.length;
        cards.set(card, (cards.get(card) ?? 0) + n);
        const id = anchorOfTarget(th.target);
        if (id) {
            const k = `${card}:${id}`;
            elements.set(k, (elements.get(k) ?? 0) + n);
            if (!keys.has(k))
                keys.set(k, th.key);
        }
    }
    return { cards, elements, keys };
}
// Worded as a chat, not a ledger: no round numbers, just whose turn it is.
function turnLabel(thread, justSent) {
    const last = thread && thread.rounds.length ? thread.rounds[thread.rounds.length - 1] : null;
    if (!thread || !last)
        return { text: "write on anything, then send", locked: false };
    if (last.comments.length === 0) {
        // done is no end: the agent moved on, the chat stays open
        return { text: justSent ? "sent done — the agent moved on; write again any time" : "done was sent — write again any time", locked: false };
    }
    if (thread.turn === "agent") {
        const of = last.comments.length;
        const answered = last.comments.filter((c) => c.reply).length;
        const head = justSent ? "sent — the agent is answering" : "the agent is answering";
        return { text: `${head} · ${answered} of ${of}`, locked: true };
    }
    return { text: "your turn — reply, or write elsewhere", locked: false };
}
// sendLabel: what the send button does right now — this message, plus any
// held drafts. There is no done button: silence is done.
function sendLabel(drafts) {
    return drafts ? `Send ${drafts > 1 ? `+${drafts}` : "+1"}` : "Send";
}
// composerLock: before the first card lands there is nothing to write on,
// whatever the turn says — the composer waits, locked, and says why.
function composerLock(cards, turn) {
    if (cards === 0)
        return { text: "the first nibble hasn't landed yet — the chat opens with it", locked: true };
    return turn;
}
// railSegments: the top bar's rail — each card as a numbered, clickable
// segment: the active one marked, the visited ones distinct from those
// still ahead, and the card's message count as a badge.
function railSegments(cards, active, read, counts) {
    return cards.map((c, i) => {
        const badge = counts.get(i) ?? 0;
        return {
            label: c.label,
            state: i === active ? "on" : read.has(i) ? "read" : "",
            badge,
            title: badge ? `${c.name} · ${badge} message${badge > 1 ? "s" : ""}` : c.name,
        };
    });
}
// The shell's pure decisions, kept out of the DOM so the node test build
// can exercise them: what esc closes first, the fullscreen stage's
// controls, and the fold on the plate description. app.ts owns the wiring.
// escAction: the outermost thing esc closes — the help first, then what the
// drawer holds, the drawer itself, the fullscreen stage, and last the
// selection (which is the reading, not a layer over it).
function escAction(l) {
    if (l.help)
        return "help";
    if (l.lines)
        return "lines";
    if (l.drawer)
        return "drawer";
    if (l.fullscreen)
        return "fullscreen";
    if (l.selection)
        return "selection";
    return "none";
}
// fsStage: the stage's own controls — where the card stands in the strip,
// and whether there is a card either side. The caption is the card's own
// title: nothing is copied.
function fsStage(active, cards) {
    if (cards <= 0)
        return { count: "", prevDisabled: true, nextDisabled: true };
    const i = Math.max(0, Math.min(cards - 1, active));
    return { count: `${i + 1} / ${cards}`, prevDisabled: i <= 0, nextDisabled: i >= cards - 1 };
}
// --- the plate description's fold ---
// foldLabel: the toggle beside the one-line plate description — none when
// the text fits its line, else what pressing it does. The shell measures
// the overflow; the decision lives here.
function foldLabel(open, overflows) {
    if (open)
        return "less";
    return overflows ? "more" : null;
}
function shortcutKey(e, inField) {
    if (inField || e.metaKey || e.ctrlKey || e.altKey)
        return null;
    return e.key;
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
let justSent = false;
let dialLevel = DIAL_DEFAULT;
// the chat: drafts typed but not sent, the focused thread, the panel state
const drafts = [];
let draftSeq = 0;
let focusedThread = null;
let chatOpen = true; // the chat is a full-height column; it collapses to a rail
// the drawer: the address of the lines it shows (for naming a range and
// matching threads to it), which target its lines belong to, and the
// reader's line selection — all reset when the content changes
let drawerAt = null;
let drawerTarget = null; // a reply ref's drawer belongs to its thread's target
let drawerLines = null;
let drawerQuery = null; // what the drawer shows; re-opening the same code keeps the selection
const read = new Set(); // cards visited, for the rail only
let knownCards = 0; // cards already on screen, for the arrival animation
let painted = false; // first paint done — later cards are arrivals, animated
let fsOn = false; // fullscreen: the active card covers the window
let plateDescOpen = false; // the plate description unfolded from its one line
// a navigation in flight: the card the camera is heading for, so the cards
// it passes on the way never become active
let scrollTarget = null;
let scrollTimer = 0;
const visualOfCard = (card) => plate?.nibbles[card]?.visual ?? null;
// cards: the nibbles plus the ledger card when the plate carries a ledger
const cards = () => (plate ? cardCount(plate.nibbles.length, plate.ledger) : 0);
const isLedgerCard = (i) => plate?.ledger != null && i === plate.nibbles.length;
// tiny markdown (esc, mdLite) and anchor-linked prose live in src/prose.ts,
// shared with the node test build.
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
// buildNibbleCard: one card — the visual on the left and a lateral bar on
// the right: the nibble number, the title (the claim) and its description.
// Code is reached through the visual's </> chips, so there is no ref list.
function buildNibbleCard(nb, i) {
    const vs = visualSummary(nb.visual);
    const desc = descriptionAt(nb.description, dialLevel);
    // Prose anchor links resolve against what the dial actually draws: an
    // undrawn target renders inert, and a dial turn rebuilds the strip, so
    // links re-evaluate for free.
    const drawn = (id) => anchorDrawnAt(nb.visual, id, dialLevel);
    const tpl = document.createElement("template");
    tpl.innerHTML = `<article class="nibble${i === active ? " active" : ""}${fsOn && i === active ? " fs" : ""}" data-i="${i}">
    <div class="nbody">
      <div class="visual">
        <div class="vhead"><span class="kind">${esc(vs.kind)}</span></div>
        ${expandButton()}
        <span class="soon">${esc(vs.detail)} — this build has no ${esc(vs.kind)} renderer</span>
        ${vs.anchors.length ? `<div class="anchors">${vs.anchors.map((a) => `<span class="anchor">${esc(a)}</span>`).join("")}</div>` : ""}
      </div>
      <aside class="nside">
        <h2>nibble ${nb.n}</h2>
        <p class="ntitle">${proseToHtml(nb.title, drawn)}</p>
        ${desc !== null ? `<p class="desc">${proseToHtml(desc, drawn)}</p>` : ""}
        ${nb.because ? `<p class="because">over budget because: ${esc(nb.because)}</p>` : ""}
      </aside>
    </div>
  </article>`;
    return tpl.content.firstElementChild;
}
// expandButton: ⤢ on a visual — fullscreen (f)
function expandButton() {
    return `<button type="button" class="expand" title="fullscreen (f)" aria-label="fullscreen">⤢</button>`;
}
function buildLedgerCard(ledger, i) {
    const card = document.createElement("article");
    card.className = "nibble ledger" + (active === i ? " active" : "") + (fsOn && active === i ? " fs" : "");
    card.dataset.i = String(i);
    const nbody = document.createElement("div");
    nbody.className = "nbody";
    const slot = document.createElement("div");
    slot.className = "visual rendered";
    slot.innerHTML = expandButton();
    const body = renderLedgerBody(ledger);
    body.classList.add("visual-body");
    slot.appendChild(body);
    nbody.appendChild(slot);
    const side = document.createElement("aside");
    side.className = "nside";
    side.innerHTML = `<h2>not-shown ledger</h2>
    <p class="ntitle">${ledger.hunks.length === 0
        ? "Every hunk of the diff was shown."
        : "What this walkthrough never showed — the rest of the diff, open to comments."}</p>`;
    nbody.appendChild(side);
    card.appendChild(nbody);
    return card;
}
// mountCard: the per-card wiring — click to activate, and the per-kind
// renderer swapping the fallback summary for the rendered visual when one
// is registered for its kind.
function mountCard(card) {
    card.addEventListener("click", () => setActive(Number(card.dataset.i)));
    const nb = plate?.nibbles[Number(card.dataset.i)];
    if (!nb)
        return; // the ledger card renders its own body in buildLedgerCard
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
}
// syncGhost: while the agent is still writing, the strip ends with one
// non-interactive skeleton card — where the next nibble will land. It is not
// a .nibble, so the rail, the counts and navigation never see it; arrivals
// insert before it and the seal removes it.
function syncGhost() {
    const strip = $("#strip");
    let g = strip.querySelector(".ghost");
    if (!plate?.open) {
        g?.remove();
        return;
    }
    if (!g) {
        g = document.createElement("article");
        g.className = "ghost";
        g.setAttribute("aria-hidden", "true");
        g.innerHTML = `<div class="gmap">
        <span class="gnode"></span><span class="gedge"></span><span class="gnode"></span><span class="gedge"></span><span class="gnode"></span>
      </div>
      <div class="gbars"><span class="gbar"></span><span class="gbar short"></span></div>
      <p class="gnote"><span class="pulse"></span>the agent is writing the next nibble…</p>`;
    }
    strip.appendChild(g); // re-appending keeps it last after arrivals
}
// renderProgress: where the plate stands — a pulsing live marker while the
// agent is still writing, the final count once sealed.
function renderProgress() {
    if (!plate)
        return;
    const pl = progressLabel(plate.open, plate.nibbles.length, plate.total);
    $("#progress").innerHTML = (pl.live ? `<span class="pulse"></span>` : "") + esc(pl.text);
}
function render() {
    if (!plate)
        return;
    closeDrawer(); // the strip rebuild would destroy a drawer left in a card
    $("#plate-title").textContent = plate.title;
    $("#plate-meta").textContent = `${aboutLabel(plate)} · ${plate.head_sha.slice(0, 7)}`;
    const plateDesc = descriptionAt(plate.description, dialLevel);
    $("#plate-desc").hidden = plateDesc === null;
    $("#plate-desc-text").innerHTML = plateDesc === null ? "" : mdLite(plateDesc);
    foldPlateDesc();
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
    renderProgress();
    const strip = $("#strip");
    watcher.disconnect(); // the old cards go with the strip
    strip.innerHTML = "";
    plate.nibbles.forEach((nb, i) => strip.appendChild(buildNibbleCard(nb, i)));
    // The not-shown ledger ends a diff plate: one last card after the nibbles.
    if (plate.ledger)
        strip.appendChild(buildLedgerCard(plate.ledger, plate.nibbles.length));
    // A selection survives the rebuild only while its element is drawn at the
    // dial level. (a ledger-card selection has no dial levels to survive)
    hostSelection = hostSelection && isLedgerCard(hostSelection.card)
        ? hostSelection
        : selectionAfterDial(hostSelection, visualOfCard, dialLevel);
    strip.querySelectorAll(".nibble").forEach(mountCard);
    watchCards();
    // A card that streamed in after the first paint slides into place — only
    // indexes beyond the known count are new. The camera stays where it is:
    // arrivals never steal it. (live arrivals take appendCards instead; this
    // covers a rebuild that also carries new cards)
    const total = cards();
    if (painted && total > knownCards) {
        const all = strip.querySelectorAll(".nibble");
        for (let i = knownCards; i < total; i++)
            all[i]?.classList.add("in");
        requestAnimationFrame(() => requestAnimationFrame(() => {
            all.forEach((c) => c.classList.remove("in"));
        }));
    }
    knownCards = total;
    painted = true;
    syncGhost();
    applySelection(strip);
    renderChat();
    camera();
}
// foldPlateDesc: the plate description is one line under the header, with a
// `more` toggle when it is clipped — so turning the dial, which swaps the
// text, never changes the canvas height under the camera.
function foldPlateDesc() {
    const el = $("#plate-desc");
    const text = $("#plate-desc-text");
    el.classList.toggle("open", plateDescOpen);
    const label = foldLabel(plateDescOpen, text.scrollWidth > text.clientWidth);
    const btn = $("#plate-desc-more");
    btn.hidden = label === null;
    if (label)
        btn.textContent = label;
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
// currentTarget: what a comment pins to right now — the selected element on
// the active card, or the card itself.
function currentTarget() {
    if (!plate)
        return `n${active + 1}`;
    if (isLedgerCard(active))
        return ledgerCommentTarget(hostSelection, active);
    const nb = plate.nibbles[active];
    return nb ? commentTarget(nb.n, hostSelection, active) : ""; // an empty strip: nothing to point at yet
}
// currentLines: the ref string of the drawer's selected lines, if any —
// the most specific pointer the reader has made.
function currentLines() {
    return drawerAt !== null && drawerLines ? lineRef(drawerAt, drawerLines) : undefined;
}
// placeTarget: the target a new thread would open on — while lines are
// selected in the drawer, the drawer's own target when it has a fixed one
// (a thread's, a ledger file's side), else the live selection or the card.
function placeTarget() {
    return drawerLines && drawerTarget !== null ? drawerTarget : currentTarget();
}
// onSelectionMoved: the chat follows the selection — the thread on the
// selected thing (and lines) is focused, or the composer offers a new one
// there.
function onSelectionMoved() {
    if (!plate)
        return;
    const target = placeTarget();
    const lines = currentLines();
    const th = buildThreads(plate.thread, drafts).find((t) => t.target === target && (t.lines ?? "") === (lines ?? ""));
    focusedThread = th ? th.key : null;
    renderChat();
}
// setActive: the card becomes the active one. By default the camera goes to
// it; `move` is false when the camera is already there — the reader scrolled
// the strip and the watcher is telling us which card they landed on.
function setActive(i, move = true) {
    if (!plate)
        return;
    const next = stepCard(i, 0, cards());
    const moved = next !== active;
    if (moved)
        closeDrawer(); // the drawer shows the active card's code
    active = next;
    document.querySelectorAll(".nibble").forEach((card, idx) => {
        card.classList.toggle("active", idx === active);
        card.classList.toggle("fs", fsOn && idx === active);
    });
    // The chat follows the camera, not a click on the card already in view:
    // re-activating the active card must not drop a focused thread.
    if (moved)
        onSelectionMoved();
    if (move)
        camera();
    else
        rail();
    if (fsOn)
        paintStage();
}
// camera: the canvas's scroll position. A navigation scrolls smoothly to
// the card and the snap points hold it there; a relayout (the chat changing
// width, the window resizing) jumps, because the card must stay centred
// through the resize rather than lurch and slide back. In fullscreen the
// active card is out of the strip's flow: the camera catches up when the
// card comes back.
function camera(animate = true) {
    rail();
    if (fsOn)
        return;
    const strip = $("#strip");
    // An empty strip still has the ghost: center it, or the placeholder hugs
    // the left edge until the first nibble lands.
    const card = document.querySelectorAll(".nibble")[active]
        ?? strip.querySelector(".ghost");
    if (!card)
        return;
    const canvas = $("#canvas");
    const left = card.offsetLeft + card.offsetWidth / 2 - canvas.clientWidth / 2;
    const smooth = animate && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (smooth) {
        scrollTarget = active;
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(settleCamera, 1200);
    }
    canvas.scrollTo({ left, behavior: smooth ? "smooth" : "instant" });
}
// settleCamera: once a scroll has ended (the browser says so, or the timer
// gives up waiting), the camera and the active card must agree. A smooth
// navigation can be cut short — the browser's own focus scroll lands on top
// of it when the reader tabs into a neighbour, and the strip snaps to
// whatever card is nearest. Keyboard focus in the active card means the
// reader meant that card: recentre it. Otherwise the card nearest the
// centre is where the reader scrolled to: it becomes active.
function settleCamera() {
    clearTimeout(scrollTimer);
    scrollTarget = null;
    if (fsOn || !plate)
        return;
    const canvas = $("#canvas");
    const mid = canvas.scrollLeft + canvas.clientWidth / 2;
    let nearest = -1;
    let gap = Infinity;
    document.querySelectorAll(".nibble").forEach((c, i) => {
        const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
        if (d < gap) {
            gap = d;
            nearest = i;
        }
    });
    if (nearest < 0)
        return;
    const activeCard = document.querySelectorAll(".nibble")[active];
    const focusInActive = !!activeCard && activeCard.contains(document.activeElement);
    if (nearest !== active && !focusInActive)
        setActive(nearest, false);
    else if (nearest !== active || gap > 2)
        camera(false);
}
// The watcher: whichever card is mostly in view is the active one — a swipe,
// a drag or a focus scroll move the camera, and the shell follows. A
// navigation in flight is ignored until it lands, so the cards passed on
// the way never flash active.
const watcher = new IntersectionObserver((entries) => {
    if (fsOn)
        return;
    for (const en of entries) {
        if (!en.isIntersecting || en.intersectionRatio < 0.6)
            continue;
        const i = Number(en.target.dataset.i);
        if (scrollTarget !== null) {
            if (i === scrollTarget)
                scrollTarget = null;
            continue;
        }
        if (i !== active)
            setActive(i, false);
    }
}, { root: $("#canvas"), threshold: [0.6] });
function watchCards() {
    document.querySelectorAll("#strip .nibble").forEach((c) => watcher.observe(c));
}
// cardLabel: how the rail and the step buttons name a card.
function cardLabel(i) {
    if (!plate)
        return "";
    return isLedgerCard(i) ? "not-shown ledger" : `nibble ${plate.nibbles[i]?.n ?? i + 1}`;
}
// cardShort: the rail's one-glyph name for a card — the nibble's number,
// a list mark for the ledger.
function cardShort(i) {
    if (!plate)
        return "";
    return isLedgerCard(i) ? "≡" : String(plate.nibbles[i]?.n ?? i + 1);
}
// rail: one numbered segment per card in the top bar — read, active, or
// still ahead, with the card's message count as a badge; each one a button
// that takes the camera there. Segments reconcile in place: rewriting them
// would kill their transitions, and an arriving card's segment must join
// without the others flashing. The step buttons at the canvas edges follow
// the same count.
function rail() {
    read.add(active);
    const el = $("#rail");
    const want = cards();
    while (el.children.length > want)
        el.lastElementChild.remove();
    while (el.children.length < want) {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.card = String(el.children.length);
        el.appendChild(b);
    }
    const counts = plate ? badgeCounts(threads(), plate.nibbles.length, plate.ledger != null).cards : new Map();
    const names = Array.from({ length: want }, (_, i) => ({ label: cardShort(i), name: cardLabel(i) }));
    railSegments(names, active, read, counts).forEach((seg, i) => {
        const b = el.children[i];
        b.className = seg.state;
        b.title = b.ariaLabel = seg.title;
        b.textContent = seg.label;
        if (seg.badge) {
            const badge = document.createElement("span");
            badge.className = "rail-badge";
            badge.textContent = String(seg.badge);
            b.appendChild(badge);
        }
    });
    $("#prev").disabled = active <= 0;
    $("#next").disabled = active >= want - 1;
}
// --- fullscreen: the active card over the whole window ---
// The card itself leaves the strip's flow and covers the window: nothing is
// moved or copied, so the visual's state — a sequence step, the timeline
// cursor, a selection, the open drawer — is exactly what it was, and chips,
// badges and prose links keep their wiring. Stepping hands the class to the
// next card; the strip underneath catches up when the mode ends.
function setFullscreen(on) {
    if (on === fsOn || !plate || cards() === 0)
        return;
    fsOn = on;
    document.body.classList.toggle("fs", on);
    document.querySelectorAll(".nibble").forEach((card, idx) => card.classList.toggle("fs", on && idx === active));
    if (on) {
        paintStage();
        if (document.fullscreenEnabled && !document.fullscreenElement)
            document.documentElement.requestFullscreen().catch(() => { });
    }
    else {
        camera(false); // the card is back in the flow where it was: recentre on the spot
        if (document.fullscreenElement)
            document.exitFullscreen().catch(() => { });
    }
}
// paintStage: the stage's own controls — the count, the edge buttons.
function paintStage() {
    const st = fsStage(active, cards());
    $("#fs-count").textContent = st.count;
    $("#fs-prev").disabled = st.prevDisabled;
    $("#fs-next").disabled = st.nextDisabled;
}
// --- code drawer: one element, mounted inside the active card while open ---
// attachDrawer moves the drawer into the active card, so the evidence reads
// as part of the nibble rather than a panel over it.
function attachDrawer() {
    const d = $("#drawer");
    const card = document.querySelector(".nibble.active");
    if (card)
        card.appendChild(d);
    d.hidden = false;
}
// closeDrawer re-homes the drawer to the body: a strip rebuild or a card
// change must never destroy the one drawer element.
function closeDrawer() {
    const d = $("#drawer");
    d.hidden = true;
    document.body.appendChild(d);
    drawerQuery = null;
    resetDrawerLines(null, null);
}
// resetDrawerLines: new content, no selection — and the composer follows.
function resetDrawerLines(at, target) {
    const had = drawerLines !== null;
    drawerAt = at;
    drawerTarget = target;
    drawerLines = null;
    if (had)
        onSelectionMoved();
}
async function openDrawer(n, ref) {
    await openCode(`n=${n}&ref=${ref}`, null); // lines here follow the card's live selection
}
// openReplyRef: a reply's ref opens in the drawer inside the thread's card;
// lines selected there belong to the thread's target.
async function openReplyRef(card, round, comment, ref, target, key) {
    setActive(card);
    await openCode(`round=${round}&comment=${comment}&ref=${ref}`, target);
    focusThread(key); // the camera move must not drop the thread being read
}
// openCommentLines: a line thread's chip opens the drawer on the lines the
// comment is about, inside the thread's card.
async function openCommentLines(th) {
    if (!th.id)
        return;
    await openCode(`comment=${th.id}`, th.target);
}
// openCode fills the drawer from /api/code. target is what lines selected
// in it belong to when that is fixed (a thread's target); null means the
// card's live selection — the nibble, or the selected element.
async function openCode(query, target) {
    let resp;
    try {
        resp = await fetch(`api/code?${query}`);
    }
    catch {
        flash("⚠ the plate’s server is gone — serve has exited; re-run nibble serve and reload");
        return;
    }
    if (!resp.ok)
        return;
    const c = (await resp.json());
    $("#drawer-path").textContent = c.path;
    const lit = c.lines.filter((l) => l.in);
    $("#drawer-range").textContent = lit.length === 0 ? ""
        : lit[0].no === lit[lit.length - 1].no ? String(lit[0].no)
            : `${lit[0].no}–${lit[lit.length - 1].no}`;
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
    const hl = highlightLines(c.path, c.lines.map((l) => l.text));
    $("#drawer-code").innerHTML = c.lines
        .map((l, i) => `<div class="ln${l.in ? " in" : ""}" data-no="${l.no}"><span class="no" role="button" tabindex="0" title="select this line to comment on it (shift-click for a range)">${l.no}</span><span>${hl[i]}</span></div>`)
        .join("");
    if (drawerQuery === query && !$("#drawer").hidden)
        paintDrawerLines(); // the same code again: keep the lines
    else
        resetDrawerLines(c.at, target);
    drawerQuery = query;
    attachDrawer();
    applyDrawerBadges();
}
// openLedgerDrawer shows one file's not-shown hunks, served by /api/ledger
// from the side (worktree, base rev, range revs) the hunks live on, with the
// hunk lines highlighted and the stretches between distant hunks elided.
async function openLedgerDrawer(path, side) {
    let resp;
    try {
        resp = await fetch(`api/ledger?file=${encodeURIComponent(path)}&side=${encodeURIComponent(side)}`);
    }
    catch {
        flash("⚠ the plate’s server is gone — serve has exited; re-run nibble serve and reload");
        return;
    }
    if (!resp.ok)
        return;
    const c = (await resp.json());
    $("#drawer-path").textContent = c.path;
    $("#drawer-range").textContent = "";
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
        const anyIn = c.lines.some((l) => l.in);
        note.textContent = !anyIn
            ? "every changed line in this file was shown by the walkthrough"
            : c.side === "base"
                ? "removed code, shown as it was on the base side"
                : "no nibble referenced the highlighted lines";
    }
    // Highlight per contiguous segment: an elided gap starts a fresh
    // highlighting state, so a construct cut by the elision cannot discolor
    // what follows.
    const parts = [];
    let seg = [];
    const flushSeg = () => {
        if (seg.length === 0)
            return;
        const hl = highlightLines(c.path, seg.map((l) => l.text));
        seg.forEach((l, i) => parts.push(`<div class="ln${l.in ? " in" : ""}" data-no="${l.no}"><span class="no" role="button" tabindex="0" title="select this line to comment on it (shift-click for a range)">${l.no}</span><span>${hl[i]}</span></div>`));
        seg = [];
    };
    let prev = 0;
    for (const l of c.lines) {
        if (prev > 0 && l.no > prev + 1) {
            flushSeg();
            parts.push(`<div class="ln gap"><span class="no">⋯</span><span></span></div>`);
        }
        prev = l.no;
        seg.push(l);
    }
    flushSeg();
    $("#drawer-code").innerHTML = parts.join("");
    const query = `ledger:${path}#${side}`;
    if (drawerQuery === query && !$("#drawer").hidden)
        paintDrawerLines();
    else
        resetDrawerLines(c.at, `ledger:${path}${side === "base" ? "#base" : ""}`);
    drawerQuery = query;
    attachDrawer();
    applyDrawerBadges();
}
// --- the review gutter: lines selected in the drawer, threads on lines ---
// toggleLine: the gutter's click — select, extend with shift, clear.
function toggleLine(no, extend) {
    drawerLines = selectLine(drawerLines, no, extend);
    paintDrawerLines();
    onSelectionMoved();
}
function paintDrawerLines() {
    document.querySelectorAll("#drawer-code .ln").forEach((row) => {
        const no = Number(row.dataset.no);
        row.classList.toggle("sel", drawerLines !== null && no >= drawerLines.start && no <= drawerLines.end);
    });
}
// applyDrawerBadges: a message count in the gutter on the first shown line
// of every thread on lines of what the drawer shows — derived on each
// render, never stored.
function applyDrawerBadges() {
    const code = $("#drawer-code");
    code.querySelectorAll(".msg-badge").forEach((b) => b.remove());
    if (drawerAt === null || !plate)
        return;
    const rows = Array.from(code.querySelectorAll(".ln[data-no]"));
    const shown = rows.map((r) => Number(r.dataset.no));
    const badges = drawerBadges(threads(), drawerAt, shown);
    for (const row of rows) {
        const b = badges.get(Number(row.dataset.no));
        if (!b)
            continue;
        const el = document.createElement("button");
        el.type = "button";
        el.className = "msg-badge msg-badge-h gutter-badge";
        el.textContent = String(b.count);
        el.title = `${b.count} message${b.count > 1 ? "s" : ""} on these lines — open the thread`;
        el.dataset.badgeKey = b.key;
        row.querySelector(".no").appendChild(el);
    }
}
// --- the chat: threads pinned to things, the agent's replies in place ---
function threads() {
    return plate ? buildThreads(plate.thread, drafts) : [];
}
// setChatOpen: open is a full-height column, closed a slim rail. The canvas
// takes the width either way; the camera recentres once the panel settles.
function setChatOpen(open) {
    if (open === chatOpen)
        return;
    chatOpen = open;
    $("#chat").classList.toggle("collapsed", !open);
    renderChat();
    if (open)
        $("#composer-text").focus();
}
// focusComposer: `c` opens the chat if needed and puts the cursor in it.
function focusComposer() {
    setChatOpen(true);
    $("#composer-text").focus();
}
// focusThread: the thread the composer writes into, scrolled into view.
function focusThread(key) {
    focusedThread = key;
    renderChat();
    if (key)
        document.querySelector(`#threads .thread[data-key="${key}"]`)?.scrollIntoView({ block: "nearest" });
}
// goToThread: a thread's chip moves the camera to its card and selects its
// element, exactly as clicking the element would.
function goToThread(th) {
    if (!plate)
        return;
    const card = cardOfTarget(th.target, plate.nibbles.length, plate.ledger != null);
    if (card === null)
        return;
    setActive(card);
    const id = anchorOfTarget(th.target);
    const cardEl = document.querySelectorAll(".nibble")[card];
    if (id && cardEl && cardEl.querySelector(`[data-anchor="${id}"]`))
        host.select(cardEl, id, true);
    if (th.ref)
        void openCommentLines(th);
    focusThread(th.key);
}
// composerDestination: what a typed message becomes — a follow-up in the
// focused (or the selection's) sent thread, or an opener on the selection.
function composerDestination() {
    const ths = threads();
    if (focusedThread) {
        const th = ths.find((t) => t.key === focusedThread);
        if (th) {
            if (th.id)
                return { label: destinationLabel("reply", th.target, th.lines), thread: th.id };
            const d = { label: destinationLabel("new", th.target, th.lines), target: th.target };
            if (th.lines)
                d.ref = th.lines;
            return d;
        }
    }
    const target = placeTarget();
    const lines = currentLines();
    const sent = sentThreadOn(ths, target, lines);
    if (sent)
        return { label: destinationLabel("reply", target, lines), thread: sent };
    const d = { label: destinationLabel("new", target, lines), target };
    if (lines)
        d.ref = lines;
    return d;
}
// holdDraft keeps the typed message as a draft bubble; the send button
// posts the round.
// composerTurn: whose move it is, and whether there is anything to write on.
function composerTurn() {
    return composerLock(cards(), turnLabel(plate?.thread ?? null, justSent));
}
function holdDraft() {
    const ta = $("#composer-text");
    const text = ta.value.trim();
    if (!text || !plate || composerTurn().locked)
        return false;
    const dest = composerDestination();
    const d = { key: ++draftSeq, text };
    if (dest.thread !== undefined)
        d.thread = dest.thread;
    else {
        if (dest.target)
            d.target = dest.target;
        if (dest.ref)
            d.ref = dest.ref;
    }
    drafts.push(d);
    ta.value = "";
    focusedThread = dest.thread ?? (dest.target !== undefined ? NEW_THREAD + dest.target + "|" + (dest.ref ?? "") : null);
    const sent = threads().find((t) => t.id === dest.thread);
    if (sent)
        focusedThread = sent.key;
    renderChat();
    return true;
}
// sendNow: this message and every held draft go out as the round, at once.
// There is no done button: with nothing typed and nothing held, nothing
// happens — silence is done.
function sendNow() {
    if (holdDraft() || drafts.length)
        void submit();
}
function removeDraft(key) {
    const i = drafts.findIndex((d) => d.key === key);
    if (i >= 0)
        drafts.splice(i, 1);
    renderChat();
}
// renderChat draws the panel — header, threads, composer — and the badges
// on the plate. Thread-only reloads call it alone: the strip, the camera,
// the selection and the drawer are never touched here.
function renderChat() {
    if (!plate)
        return;
    const ths = threads();
    const turn = composerTurn();
    const nibbleCount = plate.nibbles.length;
    const hasLedger = plate.ledger != null;
    $("#chat-turn").textContent = turn.text;
    const send = $("#composer-send");
    send.innerHTML = `${esc(sendLabel(drafts.length))} <small>⌘⏎</small>`;
    send.disabled = turn.locked;
    send.title = turn.locked ? turn.text : "send this message and every draft; the agent wakes (⌘⏎)";
    // the header: the count and a live marker while the agent is answering
    const total = ths.reduce((n, t) => n + t.messages.length, 0);
    for (const id of ["#chat-count", "#rail-count"]) {
        const count = $(id);
        count.hidden = total === 0;
        count.textContent = String(total);
    }
    for (const id of ["#chat-live", "#rail-live"])
        $(id).hidden = plate.thread.turn !== "agent";
    const list = $("#threads");
    const scroll = list.scrollTop;
    list.innerHTML = "";
    if (ths.length === 0) {
        list.innerHTML = `<p class="chat-empty">Nothing here yet. Select a node, a step or a file row and write below — or comment on the whole nibble.</p>`;
    }
    for (const th of ths) {
        const card = cardOfTarget(th.target, nibbleCount, hasLedger);
        const el = document.createElement("section");
        el.className = "thread" + (th.key === focusedThread ? " focused" : "");
        el.dataset.key = th.key;
        if (card !== null)
            el.dataset.card = String(card);
        const drawn = (id) => {
            const v = card === null ? null : visualOfCard(card);
            return v !== null && anchorDrawnAt(v, id, dialLevel);
        };
        const lines = th.ref
            ? `<button type="button" class="mref tlines" title="${esc(th.ref.ref)} — open these lines in the drawer"><span class="mono">${esc(th.ref.path)}:${th.ref.start}${th.ref.end > th.ref.start ? `–${th.ref.end}` : ""}</span>${trustBadge(th.ref.trust)}</button>`
            : th.lines ? `<span class="mref tlines unsent" title="${esc(th.lines)}"><span class="mono">${esc(linesLabel(th.lines))}</span></span>` : "";
        const head = `<header><button type="button" class="tchip mono" title="go to it on the plate">${esc(th.target || "plate")}</button>${lines}</header>`;
        const msgs = th.messages.map((m) => {
            if (m.from === "draft") {
                return `<div class="msg draft"><span class="who">you · unsent</span><p>${esc(m.text)}</p><button type="button" class="rm" data-draft="${m.draftKey}" title="remove this draft">×</button></div>`;
            }
            if (m.from === "reader") {
                return `<div class="msg reader"><span class="who">you</span><p>${esc(m.text)}</p></div>`;
            }
            const refs = (m.refs ?? []).map((r, i) => `<button type="button" class="mref" data-round="${m.at?.round}" data-comment="${m.at?.comment}" data-ref="${i}" title="${esc(r.ref)}"><span class="mono">${esc(r.path)}:${r.start}${r.end > r.start ? `–${r.end}` : ""}</span>${trustBadge(r.trust)}</button>`).join("");
            return `<div class="msg agent"><span class="who">agent</span><div class="mtext">${proseToHtml(m.text, drawn)}</div>${refs ? `<div class="mrefs">${refs}</div>` : ""}${m.because ? `<p class="because">over budget because: ${esc(m.because)}</p>` : ""}</div>`;
        }).join("");
        const awaiting = th.awaiting ? `<div class="msg awaiting"><span class="pulse"></span>awaiting the agent's reply…</div>` : "";
        el.innerHTML = head + `<div class="msgs">${msgs}${awaiting}</div>`;
        list.appendChild(el);
    }
    list.scrollTop = scroll;
    const dest = composerDestination();
    $("#composer-on").textContent = turn.locked ? turn.text : dest.label;
    const ta = $("#composer-text");
    ta.disabled = turn.locked;
    ta.placeholder = turn.locked ? "the agent is answering…" : "disagree on the thing itself…";
    $("#composer-hold").disabled = turn.locked;
    applyBadges(ths);
    applyDrawerBadges();
    rail(); // the segments wear the counts
}
// applyBadges: a message count on every element and card with a thread —
// derived on each render, never stored, never posted.
function applyBadges(ths) {
    if (!plate)
        return;
    const strip = $("#strip");
    strip.querySelectorAll(".msg-badge").forEach((b) => b.remove());
    const counts = badgeCounts(ths, plate.nibbles.length, plate.ledger != null);
    strip.querySelectorAll(".nibble").forEach((card) => {
        const i = Number(card.dataset.i);
        const n = counts.cards.get(i) ?? 0;
        const h2 = card.querySelector(".nside h2");
        if (h2 && n) {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "msg-badge card-badge";
            b.textContent = `${n} message${n > 1 ? "s" : ""}`;
            b.title = "open the conversation on this card";
            b.dataset.badgeCard = String(i);
            h2.appendChild(b);
        }
        counts.elements.forEach((count, k) => {
            const sep = k.indexOf(":");
            if (Number(k.slice(0, sep)) !== i)
                return;
            const id = k.slice(sep + 1);
            const el = card.querySelector(`.visual-body [data-anchor="${id}"]`);
            if (!el)
                return;
            const key = counts.keys.get(k) ?? "";
            if (el instanceof SVGGraphicsElement) {
                const bb = el.getBBox();
                // on the element's top-right corner, inset so the border stays whole
                const g = svgEl("g", { class: "msg-badge", "data-badge-key": key, transform: `translate(${bb.x + bb.width - 6} ${bb.y + 6})`, role: "button", tabindex: 0 });
                g.appendChild(svgEl("title", {}, `${count} message${count > 1 ? "s" : ""} — open the thread`));
                g.appendChild(svgEl("circle", { r: 8 }));
                g.appendChild(svgEl("text", { y: 3.5, "text-anchor": "middle" }, String(count)));
                el.appendChild(g);
            }
            else {
                const b = document.createElement("button");
                b.type = "button";
                b.className = "msg-badge msg-badge-h";
                b.textContent = String(count);
                b.title = `${count} message${count > 1 ? "s" : ""} — open the thread`;
                b.dataset.badgeKey = key;
                el.appendChild(b);
            }
        });
    });
}
async function submit() {
    if (!plate || drafts.length === 0 || composerTurn().locked)
        return;
    let resp;
    try {
        resp = await fetch("api/review", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: reviewBody(draftComments(drafts)),
        });
    }
    catch {
        flash("⚠ could not send — serve has exited; re-run nibble serve and reload");
        return;
    }
    if (resp.ok || resp.status === 409) {
        // The round ended serve; the agent is awake. The tab stays: it
        // reconnects when the plate is served again on this address.
        drafts.length = 0;
        justSent = true;
        await loadPlate();
    }
    else {
        const body = await resp.text();
        flash(`⚠ review rejected: ${body.slice(0, 200)}`);
    }
}
// --- data + live events ---
// Reloads are latest-wins: every SSE event fires one, and an older response
// resolving last must not paint — the count would walk backwards.
const loads = latestWins();
let shownShape = null; // the plate the strip currently shows
async function loadPlate() {
    const token = loads.begin();
    const resp = await fetch("api/plate");
    if (!resp.ok)
        return;
    const next = (await resp.json());
    if (!loads.isCurrent(token))
        return;
    const prev = shownShape;
    shownShape = plateShape(next.nibbles, next.open, next.thread, next.ledger != null);
    const plan = arrivalPlan(prev, shownShape);
    const prevCards = prev ? prev.nibbles.length + (prev.ledger ? 1 : 0) : 0;
    plate = next;
    if (plan === "none")
        return;
    if (plan === "thread") {
        // only the conversation moved: the panel and the badges, nothing else
        renderChat();
        return;
    }
    if (plan === "append") {
        appendCards(prevCards);
        renderChat();
        return;
    }
    active = Math.min(active, Math.max(0, cards() - 1));
    render();
}
// appendCards: new cards at the end of a live plate join the strip in place.
// Nothing else is touched — the drawer, the selection, the popover and the
// camera all survive the arrival. (the mockups: "arrivals never steal the
// camera — you keep reading")
function appendCards(from) {
    if (!plate)
        return;
    const strip = $("#strip");
    const fresh = [];
    for (let i = from; i < plate.nibbles.length; i++)
        fresh.push(buildNibbleCard(plate.nibbles[i], i));
    if (plate.ledger && from <= plate.nibbles.length)
        fresh.push(buildLedgerCard(plate.ledger, plate.nibbles.length));
    const ghost = strip.querySelector(".ghost");
    for (const card of fresh) {
        card.classList.add("in");
        strip.insertBefore(card, ghost); // a null ghost appends
        mountCard(card);
    }
    watchCards();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        for (const card of fresh)
            card.classList.remove("in");
    }));
    knownCards = cards();
    syncGhost();
    renderProgress();
    rail();
    // There was nothing to read yet, so there is no camera to steal: the first
    // card claims it from the ghost.
    if (from === 0)
        camera();
}
function listen() {
    const es = new EventSource("api/events");
    es.addEventListener("nibble", () => void loadPlate());
    es.addEventListener("sealed", () => void loadPlate());
    es.addEventListener("review", () => void loadPlate());
    // The EventSource retries forever and errors on every transient reconnect,
    // so the error alone proves nothing. Probe the plate once per episode: a
    // dead fetch means serve is gone — say so instead of silently going
    // stale, then keep probing: when the plate is served again on this
    // address (the agent re-serving after its replies), pick it up.
    let probing = false;
    let dead = false;
    let dropped = false; // the stream broke at least once since it last opened
    const back = () => {
        dead = false;
        const el = document.getElementById("notice");
        if (el) {
            el.hidden = true;
            el.textContent = "";
        }
        void loadPlate();
    };
    es.addEventListener("error", () => {
        dropped = true;
        if (probing || dead)
            return;
        probing = true;
        fetch("api/plate").then(() => { probing = false; }, // still there — a reconnect, stay quiet
        () => {
            probing = false;
            dead = true;
            flash(justSent
                ? "the agent is awake and has your round — this tab reconnects when it serves the plate again (if it relays a new link, open that instead)"
                : "⚠ the plate’s server is gone — serve has exited; re-run nibble serve and this tab reconnects");
            const poll = setInterval(() => {
                fetch("api/plate").then((r) => { if (r.ok) {
                    clearInterval(poll);
                    back();
                } }, () => { });
            }, 2000);
        });
    });
    // a stream that reopens after a drop missed whatever was emitted while
    // it was down — a reply landing right after the serve → keeper hand-over,
    // typically — so reload once, whether or not the plate ever looked dead
    es.addEventListener("open", () => {
        if (dead)
            back();
        else if (dropped)
            void loadPlate();
        dropped = false;
    });
}
// --- wire up ---
document.querySelectorAll("#dial .dial-pos").forEach((btn) => {
    btn.addEventListener("click", () => setDial(btn.dataset.level));
});
// The help: a popover over the canvas — ? or the button up top; esc, the
// button again or a click elsewhere closes it.
const help = $("#help");
function toggleHelp(on = help.hidden) {
    help.hidden = !on;
    $("#helpbtn").setAttribute("aria-expanded", String(on));
}
$("#helpbtn").addEventListener("click", () => toggleHelp());
document.addEventListener("click", (e) => {
    if (!help.hidden && !e.target?.closest?.("#help, #helpbtn"))
        toggleHelp(false);
});
$("#plate-desc-more").addEventListener("click", () => {
    plateDescOpen = !plateDescOpen;
    foldPlateDesc();
});
$("#drawer-close").addEventListener("click", closeDrawer);
// The review gutter: a line number selects the line, shift extends the
// range; a badge in the gutter opens its thread instead.
$("#drawer-code").addEventListener("click", (e) => {
    const t = e.target;
    const badge = t?.closest?.(".gutter-badge");
    if (badge) {
        e.preventDefault();
        setChatOpen(true);
        focusThread(badge.dataset.badgeKey ?? null);
        return;
    }
    const no = t?.closest?.(".ln[data-no] .no");
    if (!no)
        return;
    e.preventDefault(); // a shift-click must not select text
    toggleLine(Number(no.closest(".ln").dataset.no), e.shiftKey);
});
$("#drawer-code").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ")
        return;
    const no = e.target?.closest?.(".ln[data-no] .no");
    if (!no || e.target.closest(".gutter-badge"))
        return;
    e.preventDefault();
    toggleLine(Number(no.closest(".ln").dataset.no), e.shiftKey);
});
// The composer: send posts this message and every held draft (⌘⏎, the
// default) — that is what wakes the agent; hold keeps a draft for the next
// send (⇧⌘⏎). There is no done button: silence is done.
$("#chat-rail").addEventListener("click", () => setChatOpen(true));
$("#chat-close").addEventListener("click", () => setChatOpen(false));
$("#composer-hold").addEventListener("click", () => { holdDraft(); });
$("#composer-send").addEventListener("click", sendNow);
$("#composer-text").addEventListener("keydown", (e) => {
    if (e.key === "Escape")
        setChatOpen(false);
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (e.shiftKey)
            holdDraft();
        else
            sendNow();
    }
});
// Inside the panel: chips go to the plate, drafts can be removed, reply refs
// open the drawer, reply links light and select the thread's visual.
const threadList = $("#threads");
const cardOfThreadEl = (el) => {
    const idx = el.closest(".thread")?.dataset.card;
    return idx === undefined ? null : document.querySelectorAll(".nibble")[Number(idx)] ?? null;
};
threadList.addEventListener("click", (e) => {
    const t = e.target;
    if (!t)
        return;
    const section = t.closest(".thread");
    if (!section)
        return;
    const th = threads().find((x) => x.key === section.dataset.key);
    const rm = t.closest("[data-draft]");
    if (rm) {
        removeDraft(Number(rm.dataset.draft));
        return;
    }
    if (t.closest(".tchip")) {
        if (th)
            goToThread(th);
        return;
    }
    if (t.closest(".tlines")) {
        if (th && th.ref)
            goToThread(th);
        return;
    }
    const mref = t.closest(".mref");
    if (mref && section.dataset.card !== undefined && th) {
        void openReplyRef(Number(section.dataset.card), Number(mref.dataset.round), Number(mref.dataset.comment), Number(mref.dataset.ref), th.target, th.key);
        return;
    }
    const link = t.closest(".plink[data-link-anchor]");
    const cardEl = cardOfThreadEl(t);
    if (link && cardEl) {
        const id = link.getAttribute("data-link-anchor");
        if (id) {
            setActive(Number(cardEl.dataset.i));
            host.select(cardEl, id, true);
        }
        return;
    }
    focusThread(section.dataset.key ?? null);
});
// hovering a reply's phrase lights the element on the thread's card
const lightFromPanel = (t, on) => {
    const link = t instanceof Element ? t.closest(".plink[data-link-anchor]") : null;
    if (!link)
        return;
    const cardEl = cardOfThreadEl(link);
    const id = link.getAttribute("data-link-anchor");
    if (!cardEl || !id)
        return;
    cardEl.querySelectorAll(`[data-anchor="${id}"]`).forEach((el) => el.classList.toggle("lit", on));
};
threadList.addEventListener("mouseover", (e) => lightFromPanel(e.target, true));
threadList.addEventListener("mouseout", (e) => lightFromPanel(e.target, false));
// Stepping: the arrow keys, home/end, the buttons at the canvas edges and
// on the stage, the rail's segments — every one a camera move. A trackpad
// swipe scrolls the strip natively, the snap points stop it one card on,
// and the watcher makes that card active.
$("#prev").addEventListener("click", () => setActive(active - 1));
$("#next").addEventListener("click", () => setActive(active + 1));
$("#fs-prev").addEventListener("click", () => setActive(active - 1));
$("#fs-next").addEventListener("click", () => setActive(active + 1));
$("#fs-close").addEventListener("click", () => setFullscreen(false));
$("#rail").addEventListener("click", (e) => {
    const seg = e.target?.closest?.("[data-card]");
    if (seg)
        setActive(Number(seg.dataset.card));
});
// A neighbour peeking at the edge is a button: a click on it anywhere brings
// it in and does nothing else — its chips and nodes answer once it is the
// active card. (capture: the click never reaches them)
$("#strip").addEventListener("click", (e) => {
    const card = e.target?.closest?.(".nibble");
    if (card && Number(card.dataset.i) !== active) {
        e.stopPropagation();
        setActive(Number(card.dataset.i));
    }
}, true);
// Keyboard focus landing in another card (tabbing through its chips) takes
// the camera there — on the next frame, after the browser's own focus
// scroll, which would otherwise land on top of ours and leave the canvas
// snapped to the wrong card.
$("#strip").addEventListener("focusin", (e) => {
    const card = e.target?.closest?.(".nibble");
    if (card && Number(card.dataset.i) !== active)
        requestAnimationFrame(() => setActive(Number(card.dataset.i)));
});
// Fullscreen: ⤢ on the visual, or a double-click on it (not on a thing in it).
$("#strip").addEventListener("dblclick", (e) => {
    const t = e.target;
    if (!t?.closest?.(".visual") || t.closest("[data-anchor], [data-code], .plink, button, input, a"))
        return;
    setFullscreen(!fsOn);
});
document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && fsOn)
        setFullscreen(false); // the browser's exit leaves ours too
});
// The single-key shortcuts. A chord with ⌘, ctrl or alt is the browser's
// (copy, paste, find, save), so it passes through untouched: a `c` with ⌘
// held must copy the selection, not focus the composer.
document.addEventListener("keydown", (e) => {
    const key = shortcutKey(e, e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement);
    if (key === null)
        return;
    if (key === "ArrowLeft")
        setActive(active - 1);
    if (key === "ArrowRight")
        setActive(active + 1);
    if (key === "Home")
        setActive(0);
    if (key === "End")
        setActive(cards() - 1);
    if (key === " ") {
        // space steps the active visual (sequence steps, etc.), shift reverses
        const body = document.querySelector(".nibble.active .visual-body");
        if (body) {
            e.preventDefault();
            body.dispatchEvent(new CustomEvent("stepvisual", { detail: { delta: e.shiftKey ? -1 : 1 } }));
        }
    }
    if (key === "d")
        setDial(dialToggle(dialLevel));
    if (key === "c") {
        e.preventDefault(); // or the c itself lands in the focused textarea
        focusComposer();
    }
    if (key === "f")
        setFullscreen(!fsOn);
    if (key === "?")
        toggleHelp();
    if (key === "s")
        void submit();
    if (key === "Escape") {
        const act = escAction({ help: !help.hidden, lines: drawerLines !== null, drawer: !$("#drawer").hidden, fullscreen: fsOn, selection: hostSelection !== null });
        if (act === "help")
            toggleHelp(false);
        else if (act === "lines") {
            drawerLines = null;
            paintDrawerLines();
            onSelectionMoved();
        }
        else if (act === "drawer")
            closeDrawer();
        else if (act === "fullscreen")
            setFullscreen(false);
        else if (act === "selection")
            clearVisualSelection($("#strip"), hostWiring);
    }
});
// Any relayout of the canvas — the window or the chat column changing
// width — recentres the active card on the spot, every frame of a width
// transition included; only navigation animates the strip. The plate
// description's fold follows the width too.
new ResizeObserver(() => { camera(false); foldPlateDesc(); }).observe($("#canvas"));
$("#canvas").addEventListener("scrollend", settleCamera);
const hostWiring = {
    openRef: (n, ref) => void openDrawer(n, ref),
    onTarget: onSelectionMoved,
};
// Ledger chips open the ledger drawer, message badges open the chat on
// their thread; both registered before the host wiring so
// stopImmediatePropagation keeps the click from toggling a selection,
// mirroring how code chips behave inside visuals.
$("#strip").addEventListener("click", (e) => {
    const t = e.target;
    if (t?.closest?.(".expand")) {
        e.stopImmediatePropagation();
        setFullscreen(!fsOn);
        return;
    }
    const chip = t?.closest?.("[data-ledger-path]");
    if (chip) {
        e.stopImmediatePropagation();
        void openLedgerDrawer(chip.getAttribute("data-ledger-path"), chip.getAttribute("data-ledger-side") ?? "head");
        return;
    }
    const badge = t?.closest?.(".msg-badge");
    if (!badge)
        return;
    e.stopImmediatePropagation();
    const key = badge.getAttribute("data-badge-key");
    const cardIdx = badge.getAttribute("data-badge-card");
    setChatOpen(true);
    if (key)
        focusThread(key);
    else if (cardIdx !== null && plate) {
        const th = threads().find((x) => cardOfTarget(x.target, plate.nibbles.length, plate.ledger != null) === Number(cardIdx));
        focusThread(th ? th.key : null);
    }
});
const host = wireVisualHost($("#strip"), hostWiring);
void loadPlate();
listen();

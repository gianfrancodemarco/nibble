// timeline — lanes on one shared clock, a scrubber, precomputed what-if
// states. Axis math and state normalization are pure (test/timeline.test.ts).

interface TlState { name: string; label: string; events: TimelineEvents; }
interface TlStates { states: TlState[]; defaultIndex: number; }

function tlParseAt(at: number | string): number {
  if (typeof at === "number") return at;
  const m = /^(\d+):(\d\d):(\d\d)$/.exec(at);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  const n = Number(at);
  return Number.isFinite(n) ? n : 0;
}

function tlStatesOf(v: TimelineVisual): TlStates {
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

function tlAxis(v: TimelineVisual): { min: number; max: number } {
  const times: number[] = [];
  for (const s of tlStatesOf(v).states) for (const e of s.events) times.push(tlParseAt(e.at));
  if (times.length === 0) return { min: 0, max: 1 };
  const min = Math.min(...times);
  const max = Math.max(...times);
  return { min, max: max > min ? max : min + 1 };
}

function tlWeightR(weight: number | undefined, maxWeight: number): number {
  const FLOOR = 4;
  if (!weight || weight <= 0 || maxWeight <= 0) return FLOOR;
  return FLOOR + 10 * Math.sqrt(weight / maxWeight);
}

function tlFmt(seconds: number, clock: boolean): string {
  if (!clock) return String(Math.round(seconds * 100) / 100);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// --- rendering ---

function renderTimelineVisual(v: TimelineVisual, ctx: RenderCtx): Element {
  const { states, defaultIndex } = tlStatesOf(v);
  const axis = tlAxis(v);
  const clock = states.some((s) => s.events.some((e) => typeof e.at === "string" && e.at.includes(":")));
  const maxWeight = Math.max(0, ...states.flatMap((s) => s.events.map((e) => e.weight ?? 0)));

  const PADL = 16, LANE_H = 64, TOP = 14;
  const labelW = Math.max(...v.lanes.map((l) => l.label.length)) * 7 + 24;
  const plotW = 560;
  const w = PADL + labelW + plotW + 30;
  const h = TOP + v.lanes.length * LANE_H + 30;
  const x = (tsec: number) => PADL + labelW + ((tsec - axis.min) / (axis.max - axis.min)) * plotW;
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
    const y = laneY.get(l.id)!;
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

  function drawEvents(): void {
    eventsG.innerHTML = "";
    for (const e of states[stateIdx].events) {
      const y = laneY.get(e.lane);
      if (y === undefined) continue; // validation forbids dangling lanes
      const ex = x(tlParseAt(e.at));
      const g = svgEl("g", { class: "ev", "data-at": tlParseAt(e.at) });
      if (e.id) g.setAttribute("data-anchor", e.id);
      g.appendChild(svgEl("title", {}, `${tlFmt(tlParseAt(e.at), clock)} — ${e.label}${e.weight ? ` (${e.weight})` : ""}`));
      g.appendChild(svgEl("circle", { cx: ex, cy: y, r: tlWeightR(e.weight, maxWeight) }));
      const above = y - tlWeightR(e.weight, maxWeight) - 6;
      g.appendChild(svgEl("text", { x: ex, y: above, "text-anchor": "middle", class: "ev-label" }, e.label));
      if (e.id) {
        const chip = codeChip(ctx, e.id, ex + 8, y + 16);
        if (chip) g.appendChild(chip);
      }
      eventsG.appendChild(g);
    }
  }

  function applyCursor(): void {
    const cx = x(cursor);
    cursorLine.setAttribute("x1", String(cx));
    cursorLine.setAttribute("x2", String(cx));
    eventsG.querySelectorAll<SVGGElement>(".ev").forEach((g) => {
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
    const delta = (e as CustomEvent<{ delta: number }>).detail.delta;
    const times = [...new Set(states[stateIdx].events.map((ev) => tlParseAt(ev.at)))].sort((a, b) => a - b);
    const next = delta > 0 ? times.find((t) => t > cursor) : [...times].reverse().find((t) => t < cursor);
    cursor = next ?? (delta > 0 ? axis.max : axis.min);
    applyCursor();
  });

  if (head.firstElementChild) (head.children[stateIdx] as HTMLElement).classList.add("on");
  drawEvents();
  applyCursor();
  return wrap;
}

visualRenderers.timeline = renderTimelineVisual;

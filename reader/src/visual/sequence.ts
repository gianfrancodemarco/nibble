// sequence — lifelines and messages, stepped one at a time. Layout and the
// step-state machine are pure (tested in test/sequence.test.ts).

interface SeqLaidActor { id: string; label: string; x: number; w: number; }
interface SeqLaidStep { y: number; }
interface SequenceLayout { w: number; h: number; topH: number; actors: SeqLaidActor[]; steps: SeqLaidStep[]; }

const SEQ_TOP = 46;
const SEQ_STEP_GAP = 46;

function seqAdvance(shown: number, delta: number, total: number): number {
  return Math.max(0, Math.min(total, shown + delta));
}

function layoutSequence(v: SequenceVisual): SequenceLayout {
  const PAD = 24;
  let x = PAD;
  const actors: SeqLaidActor[] = v.actors.map((a) => {
    const w = Math.max(104, a.label.length * 7.5 + 28);
    const cx = x + w / 2;
    x += w + 40;
    return { id: a.id, label: a.label, x: cx, w };
  });
  const steps: SeqLaidStep[] = v.steps.map((_, i) => ({ y: SEQ_TOP + 34 + i * SEQ_STEP_GAP }));
  return {
    w: x - 40 + PAD,
    h: SEQ_TOP + 34 + v.steps.length * SEQ_STEP_GAP + PAD,
    topH: SEQ_TOP,
    actors,
    steps,
  };
}

let seqIdSeq = 0;

function renderSequenceVisual(v: SequenceVisual, ctx: RenderCtx): Element {
  const l = layoutSequence(v);
  const uid = `seq${++seqIdSeq}`;
  const svg = svgEl("svg", {
    viewBox: `0 0 ${l.w} ${l.h}`, class: "vis-seq",
    preserveAspectRatio: "xMidYMid meet", role: "img",
  });

  const defs = svgEl("defs");
  const marker = (name: string, path: string, cls: string) => {
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
    if (chip) g.appendChild(chip);
    actorsG.appendChild(g);
  }
  svg.appendChild(actorsG);

  // steps
  const stepsG = svgEl("g");
  v.steps.forEach((s, i) => {
    const a = byId.get(s.from);
    const b = byId.get(s.to);
    const y = l.steps[i].y;
    if (!a || !b) return; // validation forbids dangling steps
    const g = svgEl("g", { class: `step ${s.kind ?? "call"}`, "data-step": i });
    if (s.id) g.setAttribute("data-anchor", s.id);
    const end = s.kind === "async" ? "async" : "call";
    if (a.id === b.id) {
      // self message: a small loop to the right
      const d = `M ${a.x} ${y - 10} C ${a.x + 46} ${y - 12}, ${a.x + 46} ${y + 12}, ${a.x + 7} ${y + 10}`;
      g.appendChild(svgEl("path", { d, class: "msg", "marker-end": `url(#${uid}-${end})` }));
    } else {
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
    if (chip) g.appendChild(chip);
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
    stepsG.querySelectorAll<SVGGElement>(".step").forEach((g) => {
      const i = Number(g.getAttribute("data-step"));
      g.classList.toggle("done", i < shown);
      g.classList.toggle("cur", i === shown - 1);
    });
    counter.textContent = `${shown}/${total}`;
  };
  const step = (delta: number) => { shown = seqAdvance(shown, delta, total); apply(); };
  back.addEventListener("click", (e) => { e.stopPropagation(); step(-1); });
  fwd.addEventListener("click", (e) => { e.stopPropagation(); step(1); });
  stepsG.addEventListener("click", (e) => {
    const g = (e.target as Element).closest<SVGGElement>(".step");
    if (!g) return;
    shown = Number(g.getAttribute("data-step")) + 1;
    apply();
  });
  svg.addEventListener("stepvisual", (e) => {
    step((e as CustomEvent<{ delta: number }>).detail.delta);
  });
  apply();

  return svg;
}

visualRenderers.sequence = renderSequenceVisual;

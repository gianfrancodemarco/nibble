// compare — before vs after, visually paired with a flip. Metric alignment
// and content-kind detection are pure (test/compare.test.ts). Ref sides show
// the code of the nibble ref anchored to the side's id ("before"/"after"),
// fetched from the same endpoint the drawer uses.

interface CmpMetric { name: string; value: number; unit?: string; }
interface CmpRow { name: string; before?: CmpMetric; after?: CmpMetric; }

function cmpContentKind(side: CompareSide): "ref" | "map" | "metrics" {
  const c = side.content as Record<string, unknown>;
  if ("ref" in c) return "ref";
  if ("map" in c) return "map";
  return "metrics";
}

function cmpMetricsOf(side: CompareSide): CmpMetric[] {
  const c = side.content as { metrics?: CmpMetric[] };
  return Array.isArray(c.metrics) ? c.metrics : [];
}

function cmpMetricRows(before: CompareSide, after: CompareSide): CmpRow[] {
  const b = cmpMetricsOf(before);
  const a = cmpMetricsOf(after);
  const afterByName = new Map(a.map((m) => [m.name, m]));
  const rows: CmpRow[] = b.map((m) => ({ name: m.name, before: m, after: afterByName.get(m.name) }));
  for (const m of a) {
    if (!b.some((x) => x.name === m.name)) rows.push({ name: m.name, after: m });
  }
  return rows;
}

// --- rendering ---

function cmpEsc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function cmpMetricCell(m: CmpMetric | undefined): string {
  if (!m) return `<span class="none">—</span>`;
  return `<b>${cmpEsc(String(m.value))}</b>${m.unit ? ` <span class="unit">${cmpEsc(m.unit)}</span>` : ""}`;
}

function cmpSideHead(id: "before" | "after", side: CompareSide, ctx: RenderCtx): HTMLElement {
  const head = document.createElement("div");
  head.className = "cmp-label";
  const name = document.createElement("span");
  name.setAttribute("data-anchor", id);
  name.textContent = side.label;
  head.appendChild(name);
  const meta = ctx.anchored.has(id) ? ctx.refs[ctx.anchored.get(id)!] : undefined;
  if (meta?.trust) {
    const b = document.createElement("span");
    b.className = `trust ${meta.trust.level}`;
    b.textContent = meta.trust.level === "shifted"
      ? `shifted ${meta.trust.shift > 0 ? "+" : ""}${meta.trust.shift}`
      : meta.trust.level;
    head.appendChild(b);
  }
  const chip = codeChipHTML(ctx, id);
  if (chip) head.appendChild(chip);
  return head;
}

function cmpPane(id: "before" | "after", v: CompareVisual, ctx: RenderCtx): HTMLElement {
  const side = v[id];
  const pane = document.createElement("div");
  pane.className = `cmp-pane ${id}`;
  pane.appendChild(cmpSideHead(id, side, ctx));
  const kind = cmpContentKind(side);
  if (kind === "map") {
    // nested map, rendered by the map renderer at pane size
    const m = (side.content as { map: Record<string, unknown> }).map as unknown as MapVisual;
    if (Array.isArray(m.nodes)) pane.appendChild(renderMapVisual(m, ctx));
  } else if (kind === "ref") {
    const refStr = (side.content as { ref: string }).ref;
    const body = document.createElement("div");
    body.className = "cmp-code mono";
    const refIdx = ctx.anchored.get(id);
    if (refIdx === undefined) {
      // no nibble ref anchored to this side: the bare ref text
      body.classList.add("bare");
      body.textContent = refStr;
    } else {
      body.textContent = refStr; // placeholder until the fetch lands
      void fetch(`api/code?n=${ctx.n}&ref=${refIdx}`)
        .then((r) => (r.ok ? (r.json() as Promise<{ why?: string; lines: { no: number; text: string; in: boolean }[] }>) : null))
        .then((resp) => {
          if (!resp) return;
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
  } else {
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

function renderCompareVisual(v: CompareVisual, ctx: RenderCtx): Element {
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
  const order: Array<"after" | "before" | null> = ["after", "before", null];
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

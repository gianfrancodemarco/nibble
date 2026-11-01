// nibble reader shell — pure presentation over the Go server's JSON API.
// Protocol logic (refs, trust, validation) never happens here: the server
// hands us computed trust and resolved code. Hand-written API types below
// cover plate/review only; schema-generated visual types arrive with the
// visual-kinds change.

interface Trust { level: "exact" | "shifted" | "stale" | "unverified"; line: number; shift: number; }
interface Ref {
  ref: string; path: string; start: number; end: number;
  anchor?: string; note?: string; diff?: boolean; trust: Trust;
}
interface NibbleData {
  n: number; caption: string; because?: string;
  visual: Record<string, unknown>; refs: Ref[];
}
interface ReviewComment { target?: string; text: string; }
interface Review { verdict: string; comments?: ReviewComment[]; }
interface Plate {
  title: string; repo: string; head_sha: string;
  about: { kind: string; pr?: number; range?: string };
  source: { path: string; found: boolean; git: boolean };
  open: boolean; total: number; review: Review | null; nibbles: NibbleData[];
}
interface CodeLine { no: number; text: string; in: boolean; }
interface CodeResponse { ref: string; path: string; missing: boolean; why?: string; trust: Trust; lines: CodeLine[]; }

function flash(msg: string): void {
  const el = document.getElementById("notice");
  if (!el) return;
  el.hidden = false;
  el.textContent = msg;
}

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el as T;
};

let plate: Plate | null = null;
let active = 0;
let chosen: string | null = null;
let justSent = false;
const pending: ReviewComment[] = [];

// --- tiny markdown: captions are "one or two sentences", bold/code/italic ---

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function mdLite(s: string): string {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*([^*]+)\*/g, "<i>$1</i>");
}

// --- visual summary: typed card standing in for per-kind rendering ---

function visualSummary(v: Record<string, unknown>): { kind: string; title: string; detail: string; anchors: string[] } {
  const kind = String(v.kind ?? "?");
  const title = String(v.title ?? "");
  const ids = (xs: unknown, key = "id"): string[] =>
    Array.isArray(xs) ? xs.map((x) => String((x as Record<string, unknown>)[key] ?? "")).filter(Boolean) : [];
  let detail = "";
  let anchors: string[] = [];
  if (kind === "map") {
    const nodes = ids(v.nodes);
    const edges = Array.isArray(v.edges) ? v.edges.length : 0;
    detail = `${nodes.length} nodes · ${edges} edges`;
    anchors = nodes;
  } else if (kind === "sequence") {
    const actors = ids(v.actors);
    const steps = Array.isArray(v.steps) ? v.steps.length : 0;
    detail = `${actors.length} actors · ${steps} steps`;
    anchors = actors;
  } else if (kind === "timeline") {
    const lanes = ids(v.lanes);
    const states = ids(v.states, "name");
    detail = `${lanes.length} lanes` + (states.length ? ` · states: ${states.join(", ")}` : "");
    anchors = lanes;
  } else if (kind === "compare") {
    detail = "before / after";
    anchors = ["before", "after"];
  }
  return { kind, title, detail, anchors };
}

// --- render ---

function trustBadge(t: Trust): string {
  const label = t.level === "shifted" ? `shifted ${t.shift > 0 ? "+" : ""}${t.shift}` : t.level;
  return `<span class="trust ${t.level}">${label}</span>`;
}

function aboutLabel(p: Plate): string {
  const a = p.about;
  if (a.kind === "pr") return `PR #${a.pr}`;
  if (a.kind === "range") return a.range ?? "range";
  return a.kind;
}

function render(): void {
  if (!plate) return;
  $("#plate-title").textContent = plate.title;
  $("#plate-meta").textContent = `${aboutLabel(plate)} · ${plate.head_sha.slice(0, 7)}`;
  const notice = $("#notice");
  if (!plate.source.found) {
    notice.hidden = false;
    notice.textContent = `refs unverified — the plate’s root ${plate.source.path} isn’t on this machine; captions and visuals only`;
  } else if (!plate.source.git && plate.nibbles.some((nb) => nb.refs.some((r) => r.trust.level === "unverified"))) {
    notice.hidden = false;
    notice.textContent = `${plate.source.path} isn’t a git repository — base..head refs are unverified`;
  } else {
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
        .map(
          (r, ri) => `<button class="ref" data-n="${nb.n}" data-ref="${ri}">
            <span>${esc(r.path)}</span><span class="range">:${r.start}${r.end > r.start ? "-" + r.end : ""}</span>
            ${r.anchor ? `<span class="anchor">@${esc(r.anchor)}</span>` : ""}
            ${trustBadge(r.trust)}</button>`,
        )
        .join("");
      return `<article class="nibble${i === active ? " active" : ""}" data-i="${i}">
        <h2>nibble ${nb.n}</h2>
        <p class="caption">${mdLite(nb.caption)}</p>
        ${nb.because ? `<p class="because">over budget because: ${esc(nb.because)}</p>` : ""}
        <div class="visual">
          <span class="kind">${esc(vs.kind)}</span><span class="vtitle">${esc(vs.title)}</span>
          <span class="soon">${esc(vs.detail)} — interactive ${esc(vs.kind)} rendering ships with the visual-kinds change</span>
          ${vs.anchors.length ? `<div class="anchors">${vs.anchors.map((a) => `<span class="anchor">${esc(a)}</span>`).join("")}</div>` : ""}
        </div>
        <div class="refs">${refs}</div>
      </article>`;
    })
    .join("");

  strip.querySelectorAll<HTMLElement>(".nibble").forEach((card) => {
    card.addEventListener("click", () => setActive(Number(card.dataset.i)));
  });
  strip.querySelectorAll<HTMLButtonElement>(".ref").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      void openDrawer(Number(btn.dataset.n), Number(btn.dataset.ref));
    });
  });

  renderReviewBar();
  camera();
}

// --- camera: an animated transform, never a navigation ---

function setActive(i: number): void {
  if (!plate) return;
  active = Math.max(0, Math.min(plate.nibbles.length - 1, i));
  document.querySelectorAll<HTMLElement>(".nibble").forEach((card, idx) => {
    card.classList.toggle("active", idx === active);
  });
  $("#comment-target").textContent = `n${active + 1}`;
  $("#pos").textContent = `${active + 1} / ${plate.nibbles.length}`;
  camera();
}

function camera(): void {
  const strip = $("#strip");
  const card = document.querySelectorAll<HTMLElement>(".nibble")[active];
  if (!card) return;
  const canvas = $("#canvas");
  const x = canvas.clientWidth / 2 - card.offsetLeft - card.offsetWidth / 2;
  strip.style.transform = `translateX(${x}px)`;
  $("#pos").textContent = plate ? `${active + 1} / ${plate.nibbles.length}` : "";
}

// --- code drawer ---

async function openDrawer(n: number, ref: number): Promise<void> {
  let resp: Response;
  try {
    resp = await fetch(`api/code?n=${n}&ref=${ref}`);
  } catch {
    flash("⚠ the plate’s server is gone — serve has exited; re-run nibble serve and reload");
    return;
  }
  if (!resp.ok) return;
  const c = (await resp.json()) as CodeResponse;
  $("#drawer-path").textContent = c.path;
  $("#drawer-trust").outerHTML = trustBadge(c.trust).replace('class="trust', 'id="drawer-trust" class="trust');
  const note = $("#drawer-note");
  if (c.why) {
    note.hidden = false;
    note.textContent = `⚠ ${c.why}`;
  } else if (c.missing) {
    note.hidden = false;
    note.textContent = "⚠ this file no longer exists in the worktree";
  } else if (c.trust.level === "stale") {
    note.hidden = false;
    note.textContent = "⚠ stale: the referenced code has been rewritten — showing what is at the original range now";
  } else if (c.trust.level === "shifted") {
    note.hidden = false;
    note.textContent = `code moved to line ${c.trust.line}; showing it there`;
  } else {
    note.hidden = true;
  }
  $("#drawer-code").innerHTML = c.lines
    .map((l) => `<div class="ln${l.in ? " in" : ""}"><span class="no">${l.no}</span><span>${esc(l.text) || " "}</span></div>`)
    .join("");
  ($("#drawer") as HTMLElement).hidden = false;
}

// --- review ---

function renderReviewBar(): void {
  if (!plate) return;
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
  document.querySelectorAll<HTMLButtonElement>("#pending button").forEach((btn) => {
    btn.addEventListener("click", () => {
      pending.splice(Number(btn.dataset.i), 1);
      renderReviewBar();
    });
  });
}

function addComment(): void {
  const input = $<HTMLInputElement>("#comment");
  const text = input.value.trim();
  if (!text) {
    input.placeholder = "type the comment first, then pin it";
    input.focus();
    return;
  }
  pending.push({ target: `n${active + 1}`, text });
  input.value = "";
  renderReviewBar();
}

async function submit(verdict: string): Promise<void> {
  let resp: Response;
  try {
    resp = await fetch("api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verdict, comments: pending }),
    });
  } catch {
    flash("⚠ could not submit — serve has exited; re-run nibble serve and reload");
    return;
  }
  if (resp.ok || resp.status === 409) {
    justSent = true;
    await loadPlate();
    // The review ended serve; this tab's job is done. Browsers only honor
    // close() for single-entry tabs — the locked state is the fallback.
    setTimeout(() => window.close(), 900);
  } else {
    const body = await resp.text();
    flash(`⚠ review rejected: ${body.slice(0, 200)}`);
  }
}

// --- data + live events ---

async function loadPlate(): Promise<void> {
  const resp = await fetch("api/plate");
  if (!resp.ok) return;
  plate = (await resp.json()) as Plate;
  active = Math.min(active, Math.max(0, plate.nibbles.length - 1));
  render();
}

function listen(): void {
  const es = new EventSource("api/events");
  es.addEventListener("nibble", () => void loadPlate());
  es.addEventListener("sealed", () => void loadPlate());
  es.addEventListener("review", () => void loadPlate());
}

// --- wire up ---

$("#prev").addEventListener("click", () => setActive(active - 1));
$("#next").addEventListener("click", () => setActive(active + 1));
$("#drawer-close").addEventListener("click", () => (($("#drawer") as HTMLElement).hidden = true));
const legend = $("#legend");
$("#comment-add").addEventListener("click", addComment);
$<HTMLInputElement>("#comment").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addComment();
});
// Choosing a verdict is a draft; only "send review" posts it.
document.querySelectorAll<HTMLButtonElement>(".verdict").forEach((btn) => {
  btn.addEventListener("click", () => {
    chosen = btn.dataset.verdict ?? null;
    document.querySelectorAll<HTMLButtonElement>(".verdict").forEach((b) => {
      b.classList.toggle("selected", b === btn);
    });
    const send = $<HTMLButtonElement>("#send");
    send.disabled = false;
    send.textContent = `send review · ${btn.textContent}`;
  });
});
$<HTMLButtonElement>("#send").addEventListener("click", () => {
  if (chosen) void submit(chosen);
});
document.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === "ArrowLeft") setActive(active - 1);
  if (e.key === "ArrowRight") setActive(active + 1);
  if (e.key === "?") legend.classList.toggle("pinned");
  if (e.key === "s" && chosen && plate && !plate.review) void submit(chosen);
  if (e.key === "Escape") {
    if (legend.classList.contains("pinned")) legend.classList.remove("pinned");
    else ($("#drawer") as HTMLElement).hidden = true;
  }
});
window.addEventListener("resize", camera);
legend.addEventListener("transitionend", camera);

void loadPlate();
listen();

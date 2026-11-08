// nibble reader shell — pure presentation over the Go server's JSON API.
// Protocol logic (refs, trust, validation) never happens here: the server
// hands us computed trust and resolved code. Hand-written types below cover
// the server's response shapes only; the visual types are generated from
// the protocol JSON Schemas (src/visual/types.gen.d.ts, `npm run gen`).

interface Trust { level: "exact" | "shifted" | "stale" | "unverified"; line: number; shift: number; }
interface Ref {
  ref: string; path: string; start: number; end: number;
  anchor?: string; note?: string; diff?: boolean; trust: Trust;
}
interface NibbleData {
  n: number; title: string; description?: LevelledText; because?: string;
  visual: Visual; refs: Ref[];
}
interface ReviewComment { target?: string; text: string; }
interface Review { comments?: ReviewComment[]; }
interface Plate {
  title: string; description?: LevelledText; repo: string; head_sha: string;
  about: { kind: string; pr?: number; range?: string };
  source: { path: string; found: boolean; git: boolean };
  open: boolean; total: number; review: Review | null; ledger?: LedgerData | null;
  nibbles: NibbleData[];
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
let justSent = false;
let dialLevel: DialLevel = DIAL_DEFAULT;
const pending: ReviewComment[] = [];
const read = new Set<number>(); // cards visited, for the rail only
let knownCards = 0; // cards already on screen, for the arrival animation

const visualOfCard = (card: number): Visual | null => plate?.nibbles[card]?.visual ?? null;
// cards: the nibbles plus the ledger card when the plate carries a ledger
const cards = (): number => (plate ? cardCount(plate.nibbles.length, plate.ledger) : 0);
const isLedgerCard = (i: number): boolean => plate?.ledger != null && i === plate.nibbles.length;

// --- tiny markdown: titles and descriptions get bold/code/italic only ---

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

function visualSummary(v: Visual): { kind: string; title: string; detail: string; anchors: string[] } {
  let detail = "";
  let anchors: string[] = [];
  if (v.kind === "map") {
    detail = `${v.nodes.length} nodes · ${v.edges?.length ?? 0} edges`;
    anchors = v.nodes.map((n) => n.id);
  } else if (v.kind === "sequence") {
    detail = `${v.actors.length} actors · ${v.steps.length} steps`;
    anchors = v.actors.map((a) => a.id);
  } else if (v.kind === "timeline") {
    const states = v.states?.map((s) => s.name) ?? [];
    detail = `${v.lanes.length} lanes` + (states.length ? ` · states: ${states.join(", ")}` : "");
    anchors = v.lanes.map((l) => l.id);
  } else {
    detail = "before / after";
    anchors = ["before", "after"];
  }
  return { kind: v.kind, title: v.title, detail, anchors };
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
  closeDrawer(); // the strip rebuild would destroy a drawer left in a card
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
  // Each card is the visual on the left and a lateral bar on the right: the
  // nibble number, the title (the claim) and its description. Code is reached
  // through the visual's </> chips, so there is no separate ref list.
  strip.innerHTML = plate.nibbles
    .map((nb, i) => {
      const vs = visualSummary(nb.visual);
      const desc = descriptionAt(nb.description, dialLevel);
      return `<article class="nibble${i === active ? " active" : ""}" data-i="${i}">
        <div class="nbody">
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
        </div>
      </article>`;
    })
    .join("");

  // The not-shown ledger ends a diff plate: one last card after the nibbles.
  if (plate.ledger) {
    const card = document.createElement("article");
    card.className = "nibble ledger" + (active === plate.nibbles.length ? " active" : "");
    card.dataset.i = String(plate.nibbles.length);
    const nbody = document.createElement("div");
    nbody.className = "nbody";
    const slot = document.createElement("div");
    slot.className = "visual rendered";
    const body = renderLedgerBody(plate.ledger);
    body.classList.add("visual-body");
    slot.appendChild(body);
    nbody.appendChild(slot);
    const side = document.createElement("aside");
    side.className = "nside";
    side.innerHTML = `<h2>not-shown ledger</h2>
      <p class="ntitle">${plate.ledger.hunks.length === 0
        ? "Every hunk of the diff was shown."
        : "What this walkthrough never showed — the rest of the diff, open to comments."}</p>`;
    nbody.appendChild(side);
    card.appendChild(nbody);
    strip.appendChild(card);
  }

  // Per-kind rendering: swap each card's fallback summary for the rendered
  // visual when a renderer for its kind is registered. A selection survives
  // the rebuild only while its element is drawn at the dial level.
  // (a ledger-card selection has no dial levels to survive — it stays)
  hostSelection = hostSelection && isLedgerCard(hostSelection.card)
    ? hostSelection
    : selectionAfterDial(hostSelection, visualOfCard, dialLevel);
  strip.querySelectorAll<HTMLElement>(".nibble").forEach((card) => {
    card.addEventListener("click", () => setActive(Number(card.dataset.i)));
    const nb = plate!.nibbles[Number(card.dataset.i)];
    if (!nb) return; // the ledger card renders its own body above
    const body = renderVisualBody(nb.visual, { n: nb.n, anchored: anchorRefIndex(nb.refs), refs: nb.refs, level: dialLevel, visited: hostVisited });
    if (!body) return;
    const slot = card.querySelector(".visual");
    if (!slot) return;
    slot.classList.add("rendered");
    slot.querySelector(".soon")?.remove();
    slot.querySelector(".anchors")?.remove();
    body.classList.add("visual-body");
    slot.appendChild(body);
  });
  // A card that streamed in after the first paint slides into place; the
  // strip is rebuilt wholesale, so only indexes beyond the known count are
  // new. The camera stays where it is — arrivals never steal it.
  const total = cards();
  if (knownCards > 0 && total > knownCards) {
    const all = strip.querySelectorAll<HTMLElement>(".nibble");
    for (let i = knownCards; i < total; i++) all[i]?.classList.add("in");
    requestAnimationFrame(() => requestAnimationFrame(() => {
      all.forEach((c) => c.classList.remove("in"));
    }));
  }
  knownCards = total;

  applySelection(strip);
  updateCommentTarget();
  renderReviewBar();
  camera();
}

// --- the detail dial: one plate-wide level, same canvas, same camera ---

function setDial(level: DialLevel): void {
  if (level === dialLevel) return;
  dialLevel = level;
  document.querySelectorAll<HTMLButtonElement>("#dial .dial-pos").forEach((b) => {
    b.classList.toggle("on", b.dataset.level === level);
  });
  render(); // redraw in place: layout is computed from the full document
}

// --- camera: an animated transform, never a navigation ---

// currentTarget: what a comment pins to right now — the selected element on
// the active card, or the card itself.
function currentTarget(): string {
  if (!plate) return `n${active + 1}`;
  return isLedgerCard(active)
    ? ledgerCommentTarget(hostSelection, active)
    : commentTarget(plate.nibbles[active].n, hostSelection, active);
}

// updateCommentTarget keeps an open popover honest when the selection moves
// under it; a closed popover reads the target fresh when it opens.
function updateCommentTarget(): void {
  if (($("#pop") as HTMLElement).hidden) return;
  $("#pop-target").textContent = currentTarget();
}

function setActive(i: number): void {
  if (!plate) return;
  const next = Math.max(0, Math.min(cards() - 1, i));
  if (next !== active) closeDrawer(); // the drawer shows the active card's code
  active = next;
  document.querySelectorAll<HTMLElement>(".nibble").forEach((card, idx) => {
    card.classList.toggle("active", idx === active);
  });
  updateCommentTarget();
  camera();
}

function camera(): void {
  const strip = $("#strip");
  const card = document.querySelectorAll<HTMLElement>(".nibble")[active];
  if (!card) return;
  const canvas = $("#canvas");
  const x = canvas.clientWidth / 2 - card.offsetLeft - card.offsetWidth / 2;
  strip.style.transform = `translateX(${x}px)`;
  rail();
}

// rail: one segment per card in the top bar — read, active, or still ahead
function rail(): void {
  read.add(active);
  const segs: string[] = [];
  for (let i = 0; i < cards(); i++) {
    segs.push(`<i class="${i === active ? "on" : read.has(i) ? "read" : ""}"></i>`);
  }
  $("#rail").innerHTML = segs.join("");
}

// --- code drawer: one element, mounted inside the active card while open ---

// attachDrawer moves the drawer into the active card, so the evidence reads
// as part of the nibble rather than a panel over it.
function attachDrawer(): void {
  const d = $("#drawer");
  const card = document.querySelector(".nibble.active");
  if (card) card.appendChild(d);
  d.hidden = false;
}

// closeDrawer re-homes the drawer to the body: a strip rebuild or a card
// change must never destroy the one drawer element.
function closeDrawer(): void {
  const d = $("#drawer");
  d.hidden = true;
  document.body.appendChild(d);
}

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
  const lit = c.lines.filter((l) => l.in);
  $("#drawer-range").textContent = lit.length === 0 ? ""
    : lit[0].no === lit[lit.length - 1].no ? String(lit[0].no)
    : `${lit[0].no}–${lit[lit.length - 1].no}`;
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
    .map((l) => `<div class="ln${l.in ? " in" : ""}"><span class="no">${l.no}</span><span>${highlightCode(l.text)}</span></div>`)
    .join("");
  attachDrawer();
}

// openLedgerDrawer shows one file's not-shown hunks, served by /api/ledger
// from the side (worktree, base rev, range revs) the hunks live on, with the
// hunk lines highlighted and the stretches between distant hunks elided.
async function openLedgerDrawer(path: string, side: string): Promise<void> {
  let resp: Response;
  try {
    resp = await fetch(`api/ledger?file=${encodeURIComponent(path)}&side=${encodeURIComponent(side)}`);
  } catch {
    flash("⚠ the plate’s server is gone — serve has exited; re-run nibble serve and reload");
    return;
  }
  if (!resp.ok) return;
  const c = (await resp.json()) as { path: string; side: string; missing: boolean; why?: string; lines: CodeLine[] };
  $("#drawer-path").textContent = c.path;
  $("#drawer-range").textContent = "";
  $("#drawer-trust").outerHTML = `<span id="drawer-trust" class="trust unverified">not shown · ${esc(c.side)}</span>`;
  const note = $("#drawer-note");
  if (c.why) {
    note.hidden = false;
    note.textContent = `⚠ ${c.why}`;
  } else if (c.missing) {
    note.hidden = false;
    note.textContent = "⚠ this file is no longer there";
  } else {
    note.hidden = false;
    const anyIn = c.lines.some((l) => l.in);
    note.textContent = !anyIn
      ? "every changed line in this file was shown by the walkthrough"
      : c.side === "base"
        ? "removed code, shown as it was on the base side"
        : "no nibble referenced the highlighted lines";
  }
  let prev = 0;
  $("#drawer-code").innerHTML = c.lines
    .map((l) => {
      const gap = prev > 0 && l.no > prev + 1 ? `<div class="ln gap"><span class="no">⋯</span><span></span></div>` : "";
      prev = l.no;
      return `${gap}<div class="ln${l.in ? " in" : ""}"><span class="no">${l.no}</span><span>${highlightCode(l.text)}</span></div>`;
    })
    .join("");
  attachDrawer();
}

// --- the comment popover: disagree on the thing itself, where it is ---

// openPop shows the popover beside the selected element (or over the active
// card's visual when nothing is selected), targeted like the review bar.
function openPop(): void {
  if (!plate || plate.review) return;
  $("#pop-target").textContent = currentTarget();
  const pop = $("#pop");
  pop.hidden = false;
  const anchor =
    document.querySelector(".nibble.active [data-anchor].sel") ??
    document.querySelector(".nibble.active .visual");
  const r = anchor?.getBoundingClientRect();
  if (r) {
    let x = r.right + 12;
    let y = r.top;
    if (x + pop.offsetWidth > window.innerWidth - 12) {
      x = Math.max(12, Math.min(r.left + r.width / 2 - pop.offsetWidth / 2, window.innerWidth - pop.offsetWidth - 12));
      y = r.bottom + 10;
    }
    y = Math.max(12, Math.min(y, window.innerHeight - pop.offsetHeight - 12));
    pop.style.left = `${x}px`;
    pop.style.top = `${y}px`;
  }
  $<HTMLTextAreaElement>("#pop-text").focus();
}

function closePop(): void {
  $("#pop").hidden = true;
  $<HTMLTextAreaElement>("#pop-text").value = "";
}

// holdPop pins the comment for the review; the send button still posts it.
function holdPop(): void {
  const text = $<HTMLTextAreaElement>("#pop-text").value.trim();
  if (!text) return;
  pending.push({ target: currentTarget(), text });
  closePop();
  renderReviewBar();
}

// askPop ends the agent's wait now: this question, plus everything pinned.
function askPop(): void {
  const text = $<HTMLTextAreaElement>("#pop-text").value.trim();
  if (!text) return;
  pending.push({ target: currentTarget(), text });
  closePop();
  void submit();
}

// --- review ---

function renderReviewBar(): void {
  if (!plate) return;
  const bar = $("#reviewbar");
  const submitted = $("#submitted");
  if (plate.review) {
    bar.classList.add("locked");
    $("#send").hidden = true;
    submitted.hidden = false;
    const n = plate.review.comments?.length ?? 0;
    const badge = n
      ? `<span class="trust shifted">${n} comment${n > 1 ? "s" : ""}</span>`
      : `<span class="trust exact">done</span>`;
    submitted.innerHTML = justSent
      ? `review sent: ${badge} — the agent is awake; you can close this tab`
      : `this plate was reviewed: ${badge} — you are reading it after the fact`;
    return;
  }
  bar.classList.remove("locked");
  submitted.hidden = true;
  const send = $<HTMLButtonElement>("#send");
  send.hidden = false;
  send.textContent = pending.length ? `send ${pending.length} comment${pending.length > 1 ? "s" : ""}` : "done";
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

async function submit(): Promise<void> {
  let resp: Response;
  try {
    resp = await fetch("api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: reviewBody(pending),
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
  active = Math.min(active, Math.max(0, cards() - 1));
  render();
}

function listen(): void {
  const es = new EventSource("api/events");
  es.addEventListener("nibble", () => void loadPlate());
  es.addEventListener("sealed", () => void loadPlate());
  es.addEventListener("review", () => void loadPlate());
}

// --- wire up ---

document.querySelectorAll<HTMLButtonElement>("#dial .dial-pos").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation(); // the dial lives in the legend; don't toggle its pin
    setDial(btn.dataset.level as DialLevel);
  });
});
$("#drawer-close").addEventListener("click", closeDrawer);
const legend = $("#legend");
// Held comments are a draft; only the send button posts the review.
// With no comments it sends "done" — that alone ends the agent's wait.
$<HTMLButtonElement>("#send").addEventListener("click", () => void submit());
// The popover: hold pins the comment, ask now sends the review with it.
$("#pop-hold").addEventListener("click", holdPop);
$("#pop-ask").addEventListener("click", askPop);
$<HTMLTextAreaElement>("#pop-text").addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePop();
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    if (e.shiftKey) askPop();
    else holdPop();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.key === "ArrowLeft") setActive(active - 1);
  if (e.key === "ArrowRight") setActive(active + 1);
  if (e.key === " ") {
    // space steps the active visual (sequence steps, etc.), shift reverses
    const body = document.querySelector(".nibble.active .visual-body");
    if (body) {
      e.preventDefault();
      body.dispatchEvent(new CustomEvent("stepvisual", { detail: { delta: e.shiftKey ? -1 : 1 } }));
    }
  }
  if (e.key === "d") setDial(dialToggle(dialLevel));
  if (e.key === "c") {
    e.preventDefault(); // or the c itself lands in the focused textarea
    openPop();
  }
  if (e.key === "?") legend.classList.toggle("pinned");
  if (e.key === "s" && plate && !plate.review) void submit();
  if (e.key === "Escape") {
    if (!($("#pop") as HTMLElement).hidden) closePop();
    else if (legend.classList.contains("pinned")) legend.classList.remove("pinned");
    else if (!($("#drawer") as HTMLElement).hidden) closeDrawer();
    else clearVisualSelection($("#strip"), hostWiring);
  }
});
window.addEventListener("resize", camera);
legend.addEventListener("transitionend", camera);

const hostWiring: HostWiring = {
  openRef: (n, ref) => void openDrawer(n, ref),
  onTarget: updateCommentTarget,
};
// Ledger chips open the ledger drawer; registered before the host wiring so
// stopImmediatePropagation keeps a chip click from toggling the row's
// selection, mirroring how code chips behave inside visuals.
$("#strip").addEventListener("click", (e) => {
  const chip = (e.target as Element | null)?.closest?.("[data-ledger-path]");
  if (!chip) return;
  e.stopImmediatePropagation();
  void openLedgerDrawer(chip.getAttribute("data-ledger-path")!, chip.getAttribute("data-ledger-side") ?? "head");
});
wireVisualHost($("#strip"), hostWiring);

void loadPlate();
listen();

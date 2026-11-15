// nibble reader shell — pure presentation over the Go server's JSON API.
// Protocol logic (refs, trust, validation) never happens here: the server
// hands us computed trust and resolved code. Hand-written types below cover
// the server's response shapes only; the visual types are generated from
// the protocol JSON Schemas (src/visual/types.gen.d.ts, `npm run gen`).

// Trust and Ref live in src/chat.ts, shared with the node test build.
interface NibbleData {
  n: number; title: string; description?: LevelledText; because?: string;
  visual: Visual; refs: Ref[];
}
interface Plate {
  title: string; description?: LevelledText; repo: string; head_sha: string;
  about: { kind: string; pr?: number; range?: string };
  source: { path: string; found: boolean; git: boolean };
  open: boolean; total: number; thread: ThreadData; ledger?: LedgerData | null;
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
// the chat: drafts typed but not sent, the focused thread, the panel state
const drafts: Draft[] = [];
let draftSeq = 0;
let focusedThread: string | null = null;
let chatOpen = true; // the chat is a full-height column; it collapses to a rail
const read = new Set<number>(); // cards visited, for the rail only
let knownCards = 0; // cards already on screen, for the arrival animation
let painted = false; // first paint done — later cards are arrivals, animated

const visualOfCard = (card: number): Visual | null => plate?.nibbles[card]?.visual ?? null;
// cards: the nibbles plus the ledger card when the plate carries a ledger
const cards = (): number => (plate ? cardCount(plate.nibbles.length, plate.ledger) : 0);
const isLedgerCard = (i: number): boolean => plate?.ledger != null && i === plate.nibbles.length;

// tiny markdown (esc, mdLite) and anchor-linked prose live in src/prose.ts,
// shared with the node test build.

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

// buildNibbleCard: one card — the visual on the left and a lateral bar on
// the right: the nibble number, the title (the claim) and its description.
// Code is reached through the visual's </> chips, so there is no ref list.
function buildNibbleCard(nb: NibbleData, i: number): HTMLElement {
  const vs = visualSummary(nb.visual);
  const desc = descriptionAt(nb.description, dialLevel);
  // Prose anchor links resolve against what the dial actually draws: an
  // undrawn target renders inert, and a dial turn rebuilds the strip, so
  // links re-evaluate for free.
  const drawn = (id: string): boolean => anchorDrawnAt(nb.visual, id, dialLevel);
  const tpl = document.createElement("template");
  tpl.innerHTML = `<article class="nibble${i === active ? " active" : ""}" data-i="${i}">
    <div class="nbody">
      <div class="visual">
        <div class="vhead"><span class="kind">${esc(vs.kind)}</span></div>
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
  return tpl.content.firstElementChild as HTMLElement;
}

function buildLedgerCard(ledger: LedgerData, i: number): HTMLElement {
  const card = document.createElement("article");
  card.className = "nibble ledger" + (active === i ? " active" : "");
  card.dataset.i = String(i);
  const nbody = document.createElement("div");
  nbody.className = "nbody";
  const slot = document.createElement("div");
  slot.className = "visual rendered";
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
function mountCard(card: HTMLElement): void {
  card.addEventListener("click", () => setActive(Number(card.dataset.i)));
  const nb = plate?.nibbles[Number(card.dataset.i)];
  if (!nb) return; // the ledger card renders its own body in buildLedgerCard
  const body = renderVisualBody(nb.visual, { n: nb.n, anchored: anchorRefIndex(nb.refs), refs: nb.refs, level: dialLevel, visited: hostVisited });
  if (!body) return;
  const slot = card.querySelector(".visual");
  if (!slot) return;
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
function syncGhost(): void {
  const strip = $("#strip");
  let g = strip.querySelector<HTMLElement>(".ghost");
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
function renderProgress(): void {
  if (!plate) return;
  const pl = progressLabel(plate.open, plate.nibbles.length, plate.total);
  $("#progress").innerHTML = (pl.live ? `<span class="pulse"></span>` : "") + esc(pl.text);
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
  renderProgress();

  const strip = $("#strip");
  strip.innerHTML = "";
  plate.nibbles.forEach((nb, i) => strip.appendChild(buildNibbleCard(nb, i)));
  // The not-shown ledger ends a diff plate: one last card after the nibbles.
  if (plate.ledger) strip.appendChild(buildLedgerCard(plate.ledger, plate.nibbles.length));

  // A selection survives the rebuild only while its element is drawn at the
  // dial level. (a ledger-card selection has no dial levels to survive)
  hostSelection = hostSelection && isLedgerCard(hostSelection.card)
    ? hostSelection
    : selectionAfterDial(hostSelection, visualOfCard, dialLevel);
  strip.querySelectorAll<HTMLElement>(".nibble").forEach(mountCard);
  // A card that streamed in after the first paint slides into place — only
  // indexes beyond the known count are new. The camera stays where it is:
  // arrivals never steal it. (live arrivals take appendCards instead; this
  // covers a rebuild that also carries new cards)
  const total = cards();
  if (painted && total > knownCards) {
    const all = strip.querySelectorAll<HTMLElement>(".nibble");
    for (let i = knownCards; i < total; i++) all[i]?.classList.add("in");
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

// onSelectionMoved: the chat follows the selection — the thread on the
// selected thing is focused, or the composer offers a new one there.
function onSelectionMoved(): void {
  if (!plate) return;
  const target = currentTarget();
  const th = buildThreads(plate.thread, drafts).find((t) => t.target === target);
  focusedThread = th ? th.key : null;
  renderChat();
}

function setActive(i: number): void {
  if (!plate) return;
  const next = Math.max(0, Math.min(cards() - 1, i));
  if (next !== active) closeDrawer(); // the drawer shows the active card's code
  active = next;
  document.querySelectorAll<HTMLElement>(".nibble").forEach((card, idx) => {
    card.classList.toggle("active", idx === active);
  });
  onSelectionMoved();
  camera();
}

function camera(): void {
  const strip = $("#strip");
  // An empty strip still has the ghost: center it, or the placeholder hugs
  // the left edge until the first nibble lands.
  const card = document.querySelectorAll<HTMLElement>(".nibble")[active]
    ?? strip.querySelector<HTMLElement>(".ghost");
  if (!card) return;
  const canvas = $("#canvas");
  const x = canvas.clientWidth / 2 - card.offsetLeft - card.offsetWidth / 2;
  strip.style.transform = `translateX(${x}px)`;
  rail();
}

// rail: one segment per card in the top bar — read, active, or still ahead.
// Segments reconcile in place: rewriting them would kill their transitions,
// and an arriving card's segment must join without the others flashing.
function rail(): void {
  read.add(active);
  const el = $("#rail");
  const want = cards();
  while (el.children.length > want) el.lastElementChild!.remove();
  while (el.children.length < want) el.appendChild(document.createElement("i"));
  for (let i = 0; i < want; i++) {
    el.children[i].className = i === active ? "on" : read.has(i) ? "read" : "";
  }
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
  await openCode(`n=${n}&ref=${ref}`);
}

// openReplyRef: a reply's ref opens in the drawer inside the thread's card.
async function openReplyRef(card: number, round: number, comment: number, ref: number): Promise<void> {
  setActive(card);
  await openCode(`round=${round}&comment=${comment}&ref=${ref}`);
}

async function openCode(query: string): Promise<void> {
  let resp: Response;
  try {
    resp = await fetch(`api/code?${query}`);
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
  const hl = highlightLines(c.path, c.lines.map((l) => l.text));
  $("#drawer-code").innerHTML = c.lines
    .map((l, i) => `<div class="ln${l.in ? " in" : ""}"><span class="no">${l.no}</span><span>${hl[i]}</span></div>`)
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
  // Highlight per contiguous segment: an elided gap starts a fresh
  // highlighting state, so a construct cut by the elision cannot discolor
  // what follows.
  const parts: string[] = [];
  let seg: CodeLine[] = [];
  const flushSeg = (): void => {
    if (seg.length === 0) return;
    const hl = highlightLines(c.path, seg.map((l) => l.text));
    seg.forEach((l, i) => parts.push(`<div class="ln${l.in ? " in" : ""}"><span class="no">${l.no}</span><span>${hl[i]}</span></div>`));
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
  attachDrawer();
}

// --- the chat: threads pinned to things, the agent's replies in place ---

function threads(): ChatThread[] {
  return plate ? buildThreads(plate.thread, drafts) : [];
}

// setChatOpen: open is a full-height column, closed a slim rail. The canvas
// takes the width either way; the camera recentres once the panel settles.
function setChatOpen(open: boolean): void {
  if (open === chatOpen) return;
  chatOpen = open;
  $("#chat").classList.toggle("collapsed", !open);
  renderChat();
  if (open) $<HTMLTextAreaElement>("#composer-text").focus();
}

// focusComposer: `c` opens the chat if needed and puts the cursor in it.
function focusComposer(): void {
  setChatOpen(true);
  $<HTMLTextAreaElement>("#composer-text").focus();
}

// focusThread: the thread the composer writes into, scrolled into view.
function focusThread(key: string | null): void {
  focusedThread = key;
  renderChat();
  if (key) document.querySelector(`#threads .thread[data-key="${key}"]`)?.scrollIntoView({ block: "nearest" });
}

// goToThread: a thread's chip moves the camera to its card and selects its
// element, exactly as clicking the element would.
function goToThread(th: ChatThread): void {
  if (!plate) return;
  const card = cardOfTarget(th.target, plate.nibbles.length, plate.ledger != null);
  if (card === null) return;
  setActive(card);
  const id = anchorOfTarget(th.target);
  const cardEl = document.querySelectorAll<HTMLElement>(".nibble")[card];
  if (id && cardEl && cardEl.querySelector(`[data-anchor="${id}"]`)) host.select(cardEl, id, true);
  focusThread(th.key);
}

// composerDestination: what a typed message becomes — a follow-up in the
// focused (or the selection's) sent thread, or an opener on the selection.
function composerDestination(): { label: string; thread?: string; target?: string } {
  const ths = threads();
  const name = (t: string): string => t || "plate";
  if (focusedThread) {
    const th = ths.find((t) => t.key === focusedThread);
    if (th) {
      return th.id
        ? { label: `reply in ${name(th.target)}`, thread: th.id }
        : { label: `new thread on ${name(th.target)}`, target: th.target };
    }
  }
  const target = currentTarget();
  const sent = sentThreadOn(ths, target);
  return sent ? { label: `reply in ${target}`, thread: sent } : { label: `new thread on ${target}`, target };
}

// holdDraft keeps the typed message as a draft bubble; the send button
// posts the round.
function holdDraft(): boolean {
  const ta = $<HTMLTextAreaElement>("#composer-text");
  const text = ta.value.trim();
  if (!text || !plate || turnLabel(plate.thread, justSent).locked) return false;
  const dest = composerDestination();
  const d: Draft = { key: ++draftSeq, text };
  if (dest.thread !== undefined) d.thread = dest.thread;
  else if (dest.target) d.target = dest.target;
  drafts.push(d);
  ta.value = "";
  focusedThread = dest.thread ?? (dest.target !== undefined ? NEW_THREAD + dest.target : null);
  const sent = threads().find((t) => t.id === dest.thread);
  if (sent) focusedThread = sent.key;
  renderChat();
  return true;
}

// sendNow: this message and every held draft go out as the round, at once.
// There is no done button: with nothing typed and nothing held, nothing
// happens — silence is done.
function sendNow(): void {
  if (holdDraft() || drafts.length) void submit();
}

function removeDraft(key: number): void {
  const i = drafts.findIndex((d) => d.key === key);
  if (i >= 0) drafts.splice(i, 1);
  renderChat();
}

// renderChat draws the panel — header, threads, composer — and the badges
// on the plate. Thread-only reloads call it alone: the strip, the camera,
// the selection and the drawer are never touched here.
function renderChat(): void {
  if (!plate) return;
  const ths = threads();
  const turn = turnLabel(plate.thread, justSent);
  const nibbleCount = plate.nibbles.length;
  const hasLedger = plate.ledger != null;

  $("#chat-turn").textContent = turn.text;
  const send = $<HTMLButtonElement>("#composer-send");
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
  for (const id of ["#chat-live", "#rail-live"]) ($(id) as HTMLElement).hidden = plate.thread.turn !== "agent";

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
    if (card !== null) el.dataset.card = String(card);
    const drawn = (id: string): boolean => {
      const v = card === null ? null : visualOfCard(card);
      return v !== null && anchorDrawnAt(v, id, dialLevel);
    };
    const head = `<header><button type="button" class="tchip mono" title="go to it on the plate">${esc(th.target || "plate")}</button></header>`;
    const msgs = th.messages.map((m) => {
      if (m.from === "draft") {
        return `<div class="msg draft"><span class="who">you · unsent</span><p>${esc(m.text)}</p><button type="button" class="rm" data-draft="${m.draftKey}" title="remove this draft">×</button></div>`;
      }
      if (m.from === "reader") {
        return `<div class="msg reader"><span class="who">you</span><p>${esc(m.text)}</p></div>`;
      }
      const refs = (m.refs ?? []).map((r, i) =>
        `<button type="button" class="mref" data-round="${m.at?.round}" data-comment="${m.at?.comment}" data-ref="${i}" title="${esc(r.ref)}"><span class="mono">${esc(r.path)}:${r.start}${r.end > r.start ? `–${r.end}` : ""}</span>${trustBadge(r.trust)}</button>`).join("");
      return `<div class="msg agent"><span class="who">agent</span><div class="mtext">${proseToHtml(m.text, drawn)}</div>${refs ? `<div class="mrefs">${refs}</div>` : ""}${m.because ? `<p class="because">over budget because: ${esc(m.because)}</p>` : ""}</div>`;
    }).join("");
    const awaiting = th.awaiting ? `<div class="msg awaiting"><span class="pulse"></span>awaiting the agent's reply…</div>` : "";
    el.innerHTML = head + `<div class="msgs">${msgs}${awaiting}</div>`;
    list.appendChild(el);
  }
  list.scrollTop = scroll;

  const dest = composerDestination();
  $("#composer-on").textContent = turn.locked ? turn.text : dest.label;
  const ta = $<HTMLTextAreaElement>("#composer-text");
  ta.disabled = turn.locked;
  ta.placeholder = turn.locked ? "the agent is answering…" : "disagree on the thing itself…";
  $<HTMLButtonElement>("#composer-hold").disabled = turn.locked;

  applyBadges(ths);
}

// applyBadges: a message count on every element and card with a thread —
// derived on each render, never stored, never posted.
function applyBadges(ths: readonly ChatThread[]): void {
  if (!plate) return;
  const strip = $("#strip");
  strip.querySelectorAll(".msg-badge").forEach((b) => b.remove());
  const counts = badgeCounts(ths, plate.nibbles.length, plate.ledger != null);
  strip.querySelectorAll<HTMLElement>(".nibble").forEach((card) => {
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
      if (Number(k.slice(0, sep)) !== i) return;
      const id = k.slice(sep + 1);
      const el = card.querySelector(`.visual-body [data-anchor="${id}"]`);
      if (!el) return;
      const key = counts.keys.get(k) ?? "";
      if (el instanceof SVGGraphicsElement) {
        const bb = el.getBBox();
        // on the element's top-right corner, inset so the border stays whole
        const g = svgEl("g", { class: "msg-badge", "data-badge-key": key, transform: `translate(${bb.x + bb.width - 6} ${bb.y + 6})`, role: "button", tabindex: 0 });
        g.appendChild(svgEl("title", {}, `${count} message${count > 1 ? "s" : ""} — open the thread`));
        g.appendChild(svgEl("circle", { r: 8 }));
        g.appendChild(svgEl("text", { y: 3.5, "text-anchor": "middle" }, String(count)));
        el.appendChild(g);
      } else {
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

async function submit(): Promise<void> {
  if (!plate || drafts.length === 0 || turnLabel(plate.thread, justSent).locked) return;
  let resp: Response;
  try {
    resp = await fetch("api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: reviewBody(draftComments(drafts)),
    });
  } catch {
    flash("⚠ could not send — serve has exited; re-run nibble serve and reload");
    return;
  }
  if (resp.ok || resp.status === 409) {
    // The round ended serve; the agent is awake. The tab stays: it
    // reconnects when the plate is served again on this address.
    drafts.length = 0;
    justSent = true;
    await loadPlate();
  } else {
    const body = await resp.text();
    flash(`⚠ review rejected: ${body.slice(0, 200)}`);
  }
}

// --- data + live events ---

// Reloads are latest-wins: every SSE event fires one, and an older response
// resolving last must not paint — the count would walk backwards.
const loads = latestWins();
let shownShape: PlateShape | null = null; // the plate the strip currently shows

async function loadPlate(): Promise<void> {
  const token = loads.begin();
  const resp = await fetch("api/plate");
  if (!resp.ok) return;
  const next = (await resp.json()) as Plate;
  if (!loads.isCurrent(token)) return;
  const prev = shownShape;
  shownShape = plateShape(next.nibbles, next.open, next.thread, next.ledger != null);
  const plan = arrivalPlan(prev, shownShape);
  const prevCards = prev ? prev.nibbles.length + (prev.ledger ? 1 : 0) : 0;
  plate = next;
  if (plan === "none") return;
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
function appendCards(from: number): void {
  if (!plate) return;
  const strip = $("#strip");
  const fresh: HTMLElement[] = [];
  for (let i = from; i < plate.nibbles.length; i++) fresh.push(buildNibbleCard(plate.nibbles[i], i));
  if (plate.ledger && from <= plate.nibbles.length) fresh.push(buildLedgerCard(plate.ledger, plate.nibbles.length));
  const ghost = strip.querySelector(".ghost");
  for (const card of fresh) {
    card.classList.add("in");
    strip.insertBefore(card, ghost); // a null ghost appends
    mountCard(card);
  }
  requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const card of fresh) card.classList.remove("in");
  }));
  knownCards = cards();
  syncGhost();
  renderProgress();
  rail();
  // There was nothing to read yet, so there is no camera to steal: the first
  // card claims it from the ghost.
  if (from === 0) camera();
}

function listen(): void {
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
  const back = (): void => {
    dead = false;
    const el = document.getElementById("notice");
    if (el) { el.hidden = true; el.textContent = ""; }
    void loadPlate();
  };
  es.addEventListener("error", () => {
    if (probing || dead) return;
    probing = true;
    fetch("api/plate").then(
      () => { probing = false; }, // still there — a reconnect, stay quiet
      () => {
        probing = false;
        dead = true;
        flash(justSent
          ? "the agent is awake and has your round — this tab reconnects when it serves the plate again (if it relays a new link, open that instead)"
          : "⚠ the plate’s server is gone — serve has exited; re-run nibble serve and this tab reconnects");
        const poll = setInterval(() => {
          fetch("api/plate").then((r) => { if (r.ok) { clearInterval(poll); back(); } }, () => {});
        }, 2000);
      },
    );
  });
  // a stream that reopens after a drop missed events: reload once
  es.addEventListener("open", () => { if (dead) back(); });
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
// The composer: send posts this message and every held draft (⌘⏎, the
// default) — that is what wakes the agent; hold keeps a draft for the next
// send (⇧⌘⏎). There is no done button: silence is done.
$("#chat-rail").addEventListener("click", () => setChatOpen(true));
$("#chat-close").addEventListener("click", () => setChatOpen(false));
$("#chat").addEventListener("transitionend", camera);
$("#composer-hold").addEventListener("click", () => { holdDraft(); });
$("#composer-send").addEventListener("click", sendNow);
$<HTMLTextAreaElement>("#composer-text").addEventListener("keydown", (e) => {
  if (e.key === "Escape") setChatOpen(false);
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    if (e.shiftKey) holdDraft();
    else sendNow();
  }
});
// Inside the panel: chips go to the plate, drafts can be removed, reply refs
// open the drawer, reply links light and select the thread's visual.
const threadList = $("#threads");
const cardOfThreadEl = (el: Element): HTMLElement | null => {
  const idx = el.closest<HTMLElement>(".thread")?.dataset.card;
  return idx === undefined ? null : document.querySelectorAll<HTMLElement>(".nibble")[Number(idx)] ?? null;
};
threadList.addEventListener("click", (e) => {
  const t = e.target as Element | null;
  if (!t) return;
  const section = t.closest<HTMLElement>(".thread");
  if (!section) return;
  const th = threads().find((x) => x.key === section.dataset.key);
  const rm = t.closest<HTMLElement>("[data-draft]");
  if (rm) { removeDraft(Number(rm.dataset.draft)); return; }
  if (t.closest(".tchip")) { if (th) goToThread(th); return; }
  const mref = t.closest<HTMLElement>(".mref");
  if (mref && section.dataset.card !== undefined) {
    void openReplyRef(Number(section.dataset.card), Number(mref.dataset.round), Number(mref.dataset.comment), Number(mref.dataset.ref));
    return;
  }
  const link = t.closest(".plink[data-link-anchor]");
  const cardEl = cardOfThreadEl(t);
  if (link && cardEl) {
    const id = link.getAttribute("data-link-anchor");
    if (id) { setActive(Number(cardEl.dataset.i)); host.select(cardEl, id, true); }
    return;
  }
  focusThread(section.dataset.key ?? null);
});
// hovering a reply's phrase lights the element on the thread's card
const lightFromPanel = (t: EventTarget | null, on: boolean): void => {
  const link = t instanceof Element ? t.closest(".plink[data-link-anchor]") : null;
  if (!link) return;
  const cardEl = cardOfThreadEl(link);
  const id = link.getAttribute("data-link-anchor");
  if (!cardEl || !id) return;
  cardEl.querySelectorAll(`[data-anchor="${id}"]`).forEach((el) => el.classList.toggle("lit", on));
};
threadList.addEventListener("mouseover", (e) => lightFromPanel(e.target, true));
threadList.addEventListener("mouseout", (e) => lightFromPanel(e.target, false));
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
    focusComposer();
  }
  if (e.key === "?") legend.classList.toggle("pinned");
  if (e.key === "s") void submit();
  if (e.key === "Escape") {
    if (legend.classList.contains("pinned")) legend.classList.remove("pinned");
    else if (!($("#drawer") as HTMLElement).hidden) closeDrawer();
    else clearVisualSelection($("#strip"), hostWiring);
  }
});
window.addEventListener("resize", camera);
legend.addEventListener("transitionend", camera);

const hostWiring: HostWiring = {
  openRef: (n, ref) => void openDrawer(n, ref),
  onTarget: onSelectionMoved,
};
// Ledger chips open the ledger drawer, message badges open the chat on
// their thread; both registered before the host wiring so
// stopImmediatePropagation keeps the click from toggling a selection,
// mirroring how code chips behave inside visuals.
$("#strip").addEventListener("click", (e) => {
  const t = e.target as Element | null;
  const chip = t?.closest?.("[data-ledger-path]");
  if (chip) {
    e.stopImmediatePropagation();
    void openLedgerDrawer(chip.getAttribute("data-ledger-path")!, chip.getAttribute("data-ledger-side") ?? "head");
    return;
  }
  const badge = t?.closest?.(".msg-badge");
  if (!badge) return;
  e.stopImmediatePropagation();
  const key = badge.getAttribute("data-badge-key");
  const cardIdx = badge.getAttribute("data-badge-card");
  setChatOpen(true);
  if (key) focusThread(key);
  else if (cardIdx !== null && plate) {
    const th = threads().find((x) => cardOfTarget(x.target, plate!.nibbles.length, plate!.ledger != null) === Number(cardIdx));
    focusThread(th ? th.key : null);
  }
});
const host = wireVisualHost($("#strip"), hostWiring);

void loadPlate();
listen();

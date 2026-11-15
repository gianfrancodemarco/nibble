// The chat: the pure decisions behind the conversation panel — reassembling
// threads from the server's rounds, placing drafts, mapping targets to
// cards and elements, counting badges, and wording the turn. No DOM here:
// the node test build exercises it; app.ts owns the rendering.

// --- the server's shapes shared with the shell ---

interface Trust { level: "exact" | "shifted" | "stale" | "unverified"; line: number; shift: number; }
interface Ref {
  ref: string; path: string; start: number; end: number;
  at: string; // the lines' address in the ref grammar, without a range
  anchor?: string; note?: string; diff?: boolean; trust: Trust;
}

// --- the server's thread, as /api/plate serves it ---

interface ThreadReplyData { text: string; because?: string; refs: Ref[] }
interface ThreadCommentData {
  id: string; target?: string; ref?: Ref; thread?: string; text: string;
  reply: ThreadReplyData | null;
}
interface ThreadRoundData { n: number; comments: ThreadCommentData[] }
type Turn = "reader" | "agent";
interface ThreadData { turn: Turn; rounds: ThreadRoundData[] }

// A draft: a message typed but not sent. It continues a sent thread (by the
// opener's id) or opens a new one on a target — and, when the drawer had
// lines selected, on those lines (ref: the ref string the server verifies).
// key is the panel's handle.
interface Draft { key: number; thread?: string; target?: string; ref?: string; text: string }

// --- the conversation, as the panel shows it ---

interface ChatMessage {
  from: "reader" | "agent" | "draft";
  round?: number;
  id?: string; // a reader message's comment id
  text: string;
  refs?: Ref[];
  because?: string;
  // for an agent message: where its refs resolve in /api/code
  at?: { round: number; comment: number };
  draftKey?: number;
}

interface ChatThread {
  key: string; // the opener's id, or "new:<target>|<lines>" for a draft-only thread
  id: string | null; // the opener's id once sent
  target: string; // "" for an untargeted comment
  lines?: string; // the ref string of the lines the thread is on, when it is on lines
  ref?: Ref; // those lines resolved by the server, once sent
  messages: ChatMessage[];
  awaiting: boolean; // the last reader message has no reply yet and the turn is the agent's
}

const NEW_THREAD = "new:";

// buildThreads reassembles the conversation: one thread per opener in the
// order the openers were written, replies and follow-ups interleaved round
// by round, drafts appended to the thread they continue — or grouped by
// target into a new thread at the end when no sent thread exists for it.
function buildThreads(thread: ThreadData | null, drafts: readonly Draft[]): ChatThread[] {
  const out: ChatThread[] = [];
  const index = new Map<string, number>();
  const agentTurn = thread?.turn === "agent";
  for (const r of thread?.rounds ?? []) {
    r.comments.forEach((c, i) => {
      const key = c.thread ?? c.id;
      let ti = index.get(key);
      if (ti === undefined) {
        ti = out.length;
        index.set(key, ti);
        const th: ChatThread = { key, id: key, target: c.target ?? "", messages: [], awaiting: false };
        if (c.ref) { th.ref = c.ref; th.lines = c.ref.ref; }
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
      } else {
        th.awaiting = agentTurn;
      }
    });
  }
  for (const d of drafts) {
    let ti: number | undefined;
    if (d.thread !== undefined) ti = index.get(d.thread);
    if (ti === undefined) {
      const key = d.thread !== undefined ? d.thread : NEW_THREAD + (d.target ?? "") + "|" + (d.ref ?? "");
      ti = index.get(key);
      if (ti === undefined) {
        ti = out.length;
        index.set(key, ti);
        const th: ChatThread = { key, id: null, target: d.target ?? "", messages: [], awaiting: false };
        if (d.ref) th.lines = d.ref;
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
function sentThreadOn(threads: readonly ChatThread[], target: string, lines?: string): string | null {
  for (const th of threads) {
    if (th.id !== null && th.target === target && (th.lines ?? "") === (lines ?? "")) return th.id;
  }
  return null;
}

// draftComments turns drafts into the review's comments: a follow-up carries
// its thread and no target of its own; an opener carries its target and, on
// lines, the ref the reader built — the server verifies and fingerprints it.
function draftComments(drafts: readonly Draft[]): { target?: string; ref?: { ref: string }; thread?: string; text: string }[] {
  return drafts.map((d) => {
    if (d.thread !== undefined) return { thread: d.thread, text: d.text };
    return { ...(d.target ? { target: d.target } : {}), ...(d.ref ? { ref: { ref: d.ref } } : {}), text: d.text };
  });
}

// --- lines: the drawer selection, its ref, its label ---

interface LineSel { start: number; end: number }

// selectLine: the gutter's reducer. A click selects one line; with shift it
// extends the selection to a contiguous range either way; clicking the
// only selected line clears; clicking inside a range narrows to that line.
function selectLine(cur: LineSel | null, no: number, extend: boolean): LineSel | null {
  if (cur && extend) return { start: Math.min(cur.start, no), end: Math.max(cur.end, no) };
  if (cur && cur.start === no && cur.end === no) return null;
  return { start: no, end: no };
}

// lineRef: the ref string for selected lines of a drawer — its address
// (from the server) and the numbers it showed; the server parses it.
function lineRef(at: string, sel: LineSel): string {
  return sel.end > sel.start ? `${at}:${sel.start}-${sel.end}` : `${at}:${sel.start}`;
}

// linesLabel: `<path>:<range>` out of a ref string, for a chip or a label —
// the only grammar the reader reads, and only to show it.
function linesLabel(ref: string): string {
  const m = /^diff:([^@\s]+)@[^:\s]*:(\d+(?:-\d+)?)/.exec(ref);
  if (m) return `${m[1]}:${m[2]}`;
  const i = ref.indexOf(" ");
  return i > 0 ? ref.slice(0, i) : ref;
}

// destinationLabel: what the composer says it writes — a new thread on the
// lines in the target, or a reply in the thread there.
function destinationLabel(kind: "new" | "reply", target: string, lines?: string): string {
  const name = target || "plate";
  if (kind === "reply") return lines ? `reply in ${name} · ${linesLabel(lines)}` : `reply in ${name}`;
  return lines ? `new thread on ${linesLabel(lines)} in ${name}` : `new thread on ${name}`;
}

// drawerBadges: for a drawer showing `at`'s lines, the threads on lines of
// it — badged on the first shown line of each thread's trust-resolved
// range (shifted follows the code; stale keeps the original range, which is
// what the drawer shows for it too).
function drawerBadges(threads: readonly ChatThread[], at: string, shown: readonly number[]): Map<number, { count: number; key: string }> {
  const out = new Map<number, { count: number; key: string }>();
  for (const th of threads) {
    const r = th.ref;
    if (!r || r.at !== at) continue;
    const start = r.trust.level === "shifted" ? r.trust.line : r.start;
    const end = start + (r.end - r.start);
    const first = shown.find((no) => no >= start && no <= end);
    if (first === undefined) continue;
    const cur = out.get(first);
    if (cur) cur.count += th.messages.length;
    else out.set(first, { count: th.messages.length, key: th.key });
  }
  return out;
}

// --- targets → the plate ---

// cardOfTarget: which card a target lives on — nibble N for n<N>…, the
// ledger card for ledger…, the first card for an untargeted comment, null
// for a nibble the plate does not have.
function cardOfTarget(target: string | undefined, nibbles: number, hasLedger: boolean): number | null {
  if (!target) return nibbles > 0 || hasLedger ? 0 : null;
  if (target.startsWith("ledger")) return hasLedger ? nibbles : null;
  const m = /^n(\d+)(?::|$)/.exec(target);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= nibbles ? n - 1 : null;
}

// anchorOfTarget: the element id a target names on its card, or null for a
// whole-card target (n2, ledger, untargeted).
function anchorOfTarget(target: string | undefined): string | null {
  if (!target) return null;
  if (target.startsWith("ledger:")) return target.slice("ledger:".length) || null;
  const i = target.indexOf(":");
  return i > 0 ? target.slice(i + 1) || null : null;
}

// --- badges: how many messages sit on each element and card ---

interface BadgeCounts {
  cards: Map<number, number>; // card index → messages on it or its elements
  elements: Map<string, number>; // "<card>:<id>" → messages, with the thread key
  keys: Map<string, string>; // "<card>:<id>" → thread key (first thread wins)
}

function badgeCounts(threads: readonly ChatThread[], nibbles: number, hasLedger: boolean): BadgeCounts {
  const cards = new Map<number, number>();
  const elements = new Map<string, number>();
  const keys = new Map<string, string>();
  for (const th of threads) {
    const card = cardOfTarget(th.target, nibbles, hasLedger);
    if (card === null) continue;
    const n = th.messages.length;
    cards.set(card, (cards.get(card) ?? 0) + n);
    const id = anchorOfTarget(th.target);
    if (id) {
      const k = `${card}:${id}`;
      elements.set(k, (elements.get(k) ?? 0) + n);
      if (!keys.has(k)) keys.set(k, th.key);
    }
  }
  return { cards, elements, keys };
}

// --- the turn, worded ---

interface TurnLabel { text: string; locked: boolean }

// Worded as a chat, not a ledger: no round numbers, just whose turn it is.
function turnLabel(thread: ThreadData | null, justSent: boolean): TurnLabel {
  const last = thread && thread.rounds.length ? thread.rounds[thread.rounds.length - 1] : null;
  if (!thread || !last) return { text: "write on anything, then send", locked: false };
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
function sendLabel(drafts: number): string {
  return drafts ? `Send ${drafts > 1 ? `+${drafts}` : "+1"}` : "Send";
}

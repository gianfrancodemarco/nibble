// The chat: the pure decisions behind the conversation panel — reassembling
// threads from the server's rounds, placing drafts, mapping targets to
// cards and elements, counting badges, and wording the turn. No DOM here:
// the node test build exercises it; app.ts owns the rendering.

// --- the server's shapes shared with the shell ---

interface Trust { level: "exact" | "shifted" | "stale" | "unverified"; line: number; shift: number; }
interface Ref {
  ref: string; path: string; start: number; end: number;
  anchor?: string; note?: string; diff?: boolean; trust: Trust;
}

// --- the server's thread, as /api/plate serves it ---

interface ThreadReplyData { text: string; because?: string; refs: Ref[] }
interface ThreadCommentData {
  id: string; target?: string; thread?: string; text: string;
  reply: ThreadReplyData | null;
}
interface ThreadRoundData { n: number; comments: ThreadCommentData[] }
type Turn = "reader" | "agent";
interface ThreadData { turn: Turn; rounds: ThreadRoundData[] }

// A draft: a message typed but not sent. It continues a sent thread (by the
// opener's id) or opens a new one on a target. key is the panel's handle.
interface Draft { key: number; thread?: string; target?: string; text: string }

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
  key: string; // the opener's id, or "new:<target>" for a draft-only thread
  id: string | null; // the opener's id once sent
  target: string; // "" for an untargeted comment
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
        out.push({ key, id: key, target: c.target ?? "", messages: [], awaiting: false });
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
      const key = d.thread !== undefined ? d.thread : NEW_THREAD + (d.target ?? "");
      ti = index.get(key);
      if (ti === undefined) {
        ti = out.length;
        index.set(key, ti);
        out.push({ key, id: null, target: d.target ?? "", messages: [], awaiting: false });
      }
    }
    out[ti].messages.push({ from: "draft", text: d.text, draftKey: d.key });
  }
  return out;
}

// sentThreadOn: the sent thread (opener id) a target already has, if any —
// a new message on that target continues it rather than opening a second.
function sentThreadOn(threads: readonly ChatThread[], target: string): string | null {
  for (const th of threads) {
    if (th.id !== null && th.target === target) return th.id;
  }
  return null;
}

// draftComments turns drafts into the review's comments: a follow-up carries
// its thread and no target of its own; an opener carries its target.
function draftComments(drafts: readonly Draft[]): { target?: string; thread?: string; text: string }[] {
  return drafts.map((d) => {
    if (d.thread !== undefined) return { thread: d.thread, text: d.text };
    return d.target ? { target: d.target, text: d.text } : { text: d.text };
  });
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

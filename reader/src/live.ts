// Live reading: the pure decisions behind streaming, kept out of the DOM so
// the node test build can exercise them. app.ts owns the wiring.

// progressLabel: the chrome's progress text. Open plates count what has
// landed and pulse; sealed plates state the final count, once.
interface ProgressLabel { text: string; live: boolean; }

function progressLabel(open: boolean, nibbles: number, total: number): ProgressLabel {
  if (open) {
    return { text: `${nibbles} nibble${nibbles === 1 ? "" : "s"} · still being written`, live: true };
  }
  return { text: `${nibbles} of ${total} · sealed`, live: false };
}

// --- the append-or-rebuild decision on a reload ---

// A plate's shape: just enough to tell "new cards at the end" from "the
// plate under me changed", and "only the conversation moved" from either.
// Nibbles and the thread are compared as verbatim JSON.
interface PlateShape { nibbles: string[]; open: boolean; thread: string; ledger: boolean; }
type ArrivalPlan = "append" | "rebuild" | "thread" | "none";

function plateShape(nibbles: unknown[], open: boolean, thread: unknown, ledger: boolean): PlateShape {
  return { nibbles: nibbles.map((n) => JSON.stringify(n)), open, thread: JSON.stringify(thread ?? null), ledger };
}

// arrivalPlan: append only when the shown plate is a strict prefix of the
// new one — new nibbles at the end, or the ledger card (and sealed state)
// arriving at the seal. A reload where only the thread differs (a reply, a
// new round) patches the conversation in place; the strip is untouched.
// Anything else that differs rebuilds wholesale; identical shapes do
// nothing.
function arrivalPlan(prev: PlateShape | null, next: PlateShape): ArrivalPlan {
  if (!prev) return "rebuild";
  const threadMoved = prev.thread !== next.thread;
  const cardsPlan = cardsArrivalPlan(prev, next);
  if (!threadMoved) return cardsPlan;
  return cardsPlan === "none" ? "thread" : "rebuild";
}

function cardsArrivalPlan(prev: PlateShape, next: PlateShape): ArrivalPlan {
  if (next.nibbles.length < prev.nibbles.length) return "rebuild";
  for (let i = 0; i < prev.nibbles.length; i++) {
    if (prev.nibbles[i] !== next.nibbles[i]) return "rebuild";
  }
  if (prev.ledger && !next.ledger) return "rebuild";
  // The ledger card sits after the last nibble: nibbles arriving once it is
  // on screen would land at its index, so that malformed stream rebuilds.
  if (prev.ledger && next.nibbles.length > prev.nibbles.length) return "rebuild";
  const grew = next.nibbles.length > prev.nibbles.length || (!prev.ledger && next.ledger);
  if (grew || prev.open !== next.open) return "append";
  return "none";
}

// --- latest-wins reload tokens ---

// Overlapping plate reloads resolve in any order; only the newest may render,
// or the count walks backwards.
interface LatestWins { begin(): number; isCurrent(token: number): boolean; }

function latestWins(): LatestWins {
  let seq = 0;
  return {
    begin: () => ++seq,
    isCurrent: (token) => token === seq,
  };
}

// --- stepping the camera ---

// stepCard: the card a step lands on — clamped to the strip, and 0 on an
// empty strip (the ghost holds the camera until the first card lands).
function stepCard(active: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, active + delta));
}

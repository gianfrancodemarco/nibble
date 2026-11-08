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
// plate under me changed". Nibbles are compared as verbatim JSON.
interface PlateShape { nibbles: string[]; open: boolean; reviewed: boolean; ledger: boolean; }
type ArrivalPlan = "append" | "rebuild" | "none";

function plateShape(nibbles: unknown[], open: boolean, reviewed: boolean, ledger: boolean): PlateShape {
  return { nibbles: nibbles.map((n) => JSON.stringify(n)), open, reviewed, ledger };
}

// arrivalPlan: append only when the shown plate is a strict prefix of the
// new one — new nibbles at the end, or the ledger card (and sealed state)
// arriving at the seal. Anything else that differs rebuilds wholesale;
// identical shapes do nothing.
function arrivalPlan(prev: PlateShape | null, next: PlateShape): ArrivalPlan {
  if (!prev) return "rebuild";
  if (prev.reviewed !== next.reviewed) return "rebuild";
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

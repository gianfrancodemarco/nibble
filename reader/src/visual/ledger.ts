// The not-shown ledger card — the last card of a diff plate: the hunks no
// nibble referenced, grouped by file, each openable in the drawer and open
// to review comments. Pure seam functions up top (covered by
// test/ledger.test.ts); DOM rendering below, used by the shell only.

interface LedgerHunkData {
  path: string;
  side: "head" | "base";
  start: number;
  end: number;
  added: number;
  removed: number;
  binary?: boolean;
}
interface LedgerData {
  shown: number;
  total: number;
  hunks: LedgerHunkData[];
}

// hunkId is a hunk's stable id on the card — also the second half of its
// comment target, so the agent reads `ledger:src/b.ts:4-9` straight back to
// a place in the diff.
function hunkId(h: LedgerHunkData): string {
  return h.end > h.start ? `${h.path}:${h.start}-${h.end}` : `${h.path}:${h.start}`;
}

// ledgerHunkLabel is the row's summary: side, lines, +/− counts.
function ledgerHunkLabel(h: LedgerHunkData): string {
  if (h.binary) return `${h.side} · binary`;
  const lines = h.end > h.start ? `${h.start}–${h.end}` : `${h.start}`;
  return `${h.side} ${lines} · +${h.added} −${h.removed}`;
}

// groupLedgerHunks groups hunks under their file, first-appearance order,
// keeping each hunk's index into the ledger (what /api/ledger is keyed by).
function groupLedgerHunks(hunks: readonly LedgerHunkData[]): { path: string; rows: { i: number; hunk: LedgerHunkData }[] }[] {
  const groups: { path: string; rows: { i: number; hunk: LedgerHunkData }[] }[] = [];
  const byPath = new Map<string, { i: number; hunk: LedgerHunkData }[]>();
  hunks.forEach((hunk, i) => {
    let rows = byPath.get(hunk.path);
    if (!rows) {
      rows = [];
      byPath.set(hunk.path, rows);
      groups.push({ path: hunk.path, rows });
    }
    rows.push({ i, hunk });
  });
  return groups;
}

function ledgerFullyCovered(l: LedgerData): boolean {
  return l.shown === l.total;
}

// cardCount: the strip's cards — the nibbles, plus the ledger card when the
// plate carries a ledger (even an empty one: full coverage is still said).
function cardCount(nibbles: number, ledger: LedgerData | null | undefined): number {
  return nibbles + (ledger ? 1 : 0);
}

// ledgerCommentTarget: comments pin to the ledger as a whole, or to one hunk
// selected on the ledger card.
function ledgerCommentTarget(sel: VisualSelection | null, ledgerCard: number): string {
  return sel && sel.card === ledgerCard ? `ledger:${sel.id}` : "ledger";
}

// --- rendering (DOM; the shell appends the result to the strip) ---

// renderLedgerBody builds the ledger card's content. Hunk rows carry
// data-anchor (the host's selection/comment wiring picks them up) and a
// data-ledger-hunk chip the shell wires to the ledger drawer.
function renderLedgerBody(l: LedgerData): HTMLElement {
  const body = document.createElement("div");
  body.className = "ledger-body";
  const count = document.createElement("p");
  count.className = "ledger-count";
  if (ledgerFullyCovered(l)) {
    count.textContent = l.total === 0
      ? "the diff was empty — nothing to show"
      : `every hunk of the diff was shown (${l.shown} of ${l.total})`;
    count.classList.add("covered");
    body.appendChild(count);
    return body;
  }
  count.textContent = `${l.hunks.length} of ${l.total} hunks never came up — worth a look before the verdict`;
  body.appendChild(count);
  for (const g of groupLedgerHunks(l.hunks)) {
    const file = document.createElement("div");
    file.className = "ledger-file";
    const name = document.createElement("div");
    name.className = "ledger-path mono";
    name.textContent = g.path;
    file.appendChild(name);
    for (const { i, hunk } of g.rows) {
      const row = document.createElement("div");
      row.className = "ledger-hunk";
      row.setAttribute("data-anchor", hunkId(hunk));
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");
      const label = document.createElement("span");
      label.textContent = ledgerHunkLabel(hunk);
      row.appendChild(label);
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "code-chip-h";
      chip.dataset.ledgerHunk = String(i);
      chip.textContent = "</>";
      chip.title = "open this hunk's code";
      row.appendChild(chip);
      file.appendChild(row);
    }
    body.appendChild(file);
  }
  return body;
}

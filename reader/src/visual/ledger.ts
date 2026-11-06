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
  covered?: boolean;
}
interface LedgerData {
  shown: number;
  total: number;
  hunks: LedgerHunkData[];
}

// One card row per file and side: all its hunks — covered or not — their
// lines summed, opened in the drawer as one view with the uncovered lines
// highlighted (/api/ledger is keyed by path + side).
interface LedgerFileRow {
  path: string;
  side: "head" | "base";
  binary: boolean;
  added: number;
  removed: number;
  coveredCount: number;
  hunks: LedgerHunkData[];
}

// fileRowId is a row's stable id on the card — also the second half of its
// comment target, so the agent reads `ledger:src/b.ts` straight back to a
// file of the diff. Deleted-lines rows carry #base: same file, other side.
function fileRowId(row: LedgerFileRow): string {
  return row.side === "base" ? `${row.path}#base` : row.path;
}

// ledgerFileLabel is the row's summary: side, the uncovered hunks' line
// ranges (first three, then a count), summed +/− over the whole file. A
// fully covered row lists no ranges; binary files have no lines to range.
function ledgerFileLabel(row: LedgerFileRow): string {
  if (row.binary) return `${row.side} · binary`;
  const range = (h: LedgerHunkData): string =>
    h.end > h.start ? `${h.start}–${h.end}` : `${h.start}`;
  const unshown = row.hunks.filter((h) => !h.covered);
  let ranges = unshown.slice(0, 3).map(range).join(", ");
  if (unshown.length > 3) ranges += ` +${unshown.length - 3} more`;
  const where = ranges ? ` ${ranges}` : "";
  return `${row.side}${where} · +${row.added} −${row.removed}`;
}

// ledgerBadge marks how much of a row the walkthrough showed: everything,
// a part, or nothing (no badge — the row speaks for itself).
function ledgerBadge(row: LedgerFileRow): string {
  if (row.coveredCount === row.hunks.length) return "shown";
  if (row.coveredCount > 0) return `${row.coveredCount}/${row.hunks.length} shown`;
  return "";
}

// A directory of the ledger tree: subdirectories, then file rows. Chains of
// single-child directories collapse into one name ("src/cache").
interface LedgerTreeDir {
  name: string;
  dirs: LedgerTreeDir[];
  files: { name: string; row: LedgerFileRow }[];
}

// ledgerTree nests the file rows under their directories, first-appearance
// order, collapsing every directory that holds nothing but one directory.
function ledgerTree(rows: readonly LedgerFileRow[]): LedgerTreeDir {
  const root: LedgerTreeDir = { name: "", dirs: [], files: [] };
  for (const row of rows) {
    const parts = row.path.split("/");
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      let next = dir.dirs.find((d) => d.name === part);
      if (!next) {
        next = { name: part, dirs: [], files: [] };
        dir.dirs.push(next);
      }
      dir = next;
    }
    dir.files.push({ name: parts[parts.length - 1], row });
  }
  const collapse = (dir: LedgerTreeDir): LedgerTreeDir => {
    while (dir.dirs.length === 1 && dir.files.length === 0 && dir.name !== "") {
      dir = { ...dir.dirs[0], name: `${dir.name}/${dir.dirs[0].name}` };
    }
    dir.dirs = dir.dirs.map(collapse);
    return dir;
  };
  root.dirs = root.dirs.map(collapse);
  return root;
}

// ledgerFileRows groups hunks into one row per (path, side) pair,
// first-appearance order.
function ledgerFileRows(hunks: readonly LedgerHunkData[]): LedgerFileRow[] {
  const rows: LedgerFileRow[] = [];
  const byKey = new Map<string, LedgerFileRow>();
  for (const hunk of hunks) {
    const key = `${hunk.side}\n${hunk.path}`;
    let row = byKey.get(key);
    if (!row) {
      row = { path: hunk.path, side: hunk.side, binary: false, added: 0, removed: 0, coveredCount: 0, hunks: [] };
      byKey.set(key, row);
      rows.push(row);
    }
    row.hunks.push(hunk);
    row.added += hunk.added;
    row.removed += hunk.removed;
    row.binary = row.binary || hunk.binary === true;
    if (hunk.covered) row.coveredCount++;
  }
  return rows;
}

function ledgerFullyCovered(l: LedgerData): boolean {
  return l.shown === l.total;
}

// cardCount: the strip's cards — the nibbles, plus the ledger card when the
// plate carries a ledger (even an empty one: full coverage is still said).
function cardCount(nibbles: number, ledger: LedgerData | null | undefined): number {
  return nibbles + (ledger ? 1 : 0);
}

// ledgerCommentTarget: comments pin to the ledger as a whole, or to one
// file row selected on the ledger card.
function ledgerCommentTarget(sel: VisualSelection | null, ledgerCard: number): string {
  return sel && sel.card === ledgerCard ? `ledger:${sel.id}` : "ledger";
}

// --- rendering (DOM; the shell appends the result to the strip) ---

// renderLedgerBody builds the ledger card's content. File rows carry
// data-anchor (the host's selection/comment wiring picks them up) and a
// data-ledger-path chip the shell wires to the ledger drawer.
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
    if (l.hunks.length > 0) {
      body.appendChild(renderLedgerDir(ledgerTree(ledgerFileRows(l.hunks)), true));
    }
    return body;
  }
  count.textContent = `${l.total - l.shown} of ${l.total} hunks never came up — worth a look before you answer`;
  body.appendChild(count);
  body.appendChild(renderLedgerDir(ledgerTree(ledgerFileRows(l.hunks)), true));
  return body;
}

// renderLedgerDir renders one directory of the ledger tree: its name, its
// subdirectories, then its file rows.
function renderLedgerDir(dir: LedgerTreeDir, root: boolean): HTMLElement {
  const el = document.createElement("div");
  el.className = root ? "ledger-tree" : "ledger-dir";
  if (!root) {
    const name = document.createElement("div");
    name.className = "ledger-dirname mono";
    name.textContent = dir.name + "/";
    el.appendChild(name);
  }
  for (const sub of dir.dirs) el.appendChild(renderLedgerDir(sub, false));
  for (const f of dir.files) {
    const row = document.createElement("div");
    row.className = "ledger-file";
    row.setAttribute("data-anchor", fileRowId(f.row));
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    const name = document.createElement("span");
    name.className = "ledger-path mono";
    name.textContent = f.name + (f.row.side === "base" ? " (deleted lines)" : "");
    row.appendChild(name);
    const badge = ledgerBadge(f.row);
    if (badge) {
      const b = document.createElement("span");
      b.className = "ledger-badge" + (badge === "shown" ? " covered" : "");
      b.textContent = badge;
      row.appendChild(b);
    }
    const label = document.createElement("span");
    label.className = "ledger-meta";
    label.textContent = ledgerFileLabel(f.row);
    row.appendChild(label);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "code-chip-h";
    chip.dataset.ledgerPath = f.row.path;
    chip.dataset.ledgerSide = f.row.side;
    chip.textContent = "</>";
    chip.title = "open this file's hunks";
    row.appendChild(chip);
    el.appendChild(row);
  }
  return el;
}

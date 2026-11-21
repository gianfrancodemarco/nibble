// The shell's pure decisions, kept out of the DOM so the node test build
// can exercise them: what esc closes first, the fullscreen stage's
// controls, and the fold on the plate description. app.ts owns the wiring.

// --- esc: one key, peeling the layers from the top ---

interface ShellLayers {
  help: boolean; // the keys popover is open
  lines: boolean; // the drawer has lines selected
  drawer: boolean; // the drawer is open
  fullscreen: boolean; // the active card covers the window
  selection: boolean; // an element is selected
}
type EscAction = "help" | "lines" | "drawer" | "fullscreen" | "selection" | "none";

// escAction: the outermost thing esc closes — the help first, then what the
// drawer holds, the drawer itself, the fullscreen stage, and last the
// selection (which is the reading, not a layer over it).
function escAction(l: ShellLayers): EscAction {
  if (l.help) return "help";
  if (l.lines) return "lines";
  if (l.drawer) return "drawer";
  if (l.fullscreen) return "fullscreen";
  if (l.selection) return "selection";
  return "none";
}

// --- the fullscreen stage ---

interface FsStage { count: string; prevDisabled: boolean; nextDisabled: boolean }

// fsStage: the stage's own controls — where the card stands in the strip,
// and whether there is a card either side. The caption is the card's own
// title: nothing is copied.
function fsStage(active: number, cards: number): FsStage {
  if (cards <= 0) return { count: "", prevDisabled: true, nextDisabled: true };
  const i = Math.max(0, Math.min(cards - 1, active));
  return { count: `${i + 1} / ${cards}`, prevDisabled: i <= 0, nextDisabled: i >= cards - 1 };
}

// --- the plate description's fold ---

// foldLabel: the toggle beside the one-line plate description — none when
// the text fits its line, else what pressing it does. The shell measures
// the overflow; the decision lives here.
function foldLabel(open: boolean, overflows: boolean): "more" | "less" | null {
  if (open) return "less";
  return overflows ? "more" : null;
}

// shortcutKey: the single-key shortcut a keydown stands for, or null when
// the browser owns it — a chord with ⌘, ctrl or alt (copy, paste, find,
// save) or a key typed into a field. Shift is part of the key itself, so
// `?` arrives as `?`.
interface KeyLike { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }
function shortcutKey(e: KeyLike, inField: boolean): string | null {
  if (inField || e.metaKey || e.ctrlKey || e.altKey) return null;
  return e.key;
}

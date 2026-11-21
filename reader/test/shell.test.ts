// The shell's pure seams: what esc closes first, the fullscreen stage's
// controls, and the fold on the plate description.

t("escAction peels the layers in order: help, lines, drawer, fullscreen, selection", () => {
  const none = { help: false, lines: false, drawer: false, fullscreen: false, selection: false };
  eq(escAction(none), "none", "nothing open");
  eq(escAction({ ...none, help: true, drawer: true, fullscreen: true }), "help", "the help goes first");
  eq(escAction({ ...none, lines: true, drawer: true, fullscreen: true, selection: true }), "lines", "selected lines clear before the drawer closes");
  eq(escAction({ ...none, drawer: true, fullscreen: true, selection: true }), "drawer", "the drawer closes before fullscreen ends");
  eq(escAction({ ...none, fullscreen: true, selection: true }), "fullscreen", "fullscreen ends before the selection clears");
  eq(escAction({ ...none, selection: true }), "selection", "last, the selection");
});

t("fsStage counts the stage and disables the edge buttons", () => {
  eq(fsStage(0, 5), { count: "1 / 5", prevDisabled: true, nextDisabled: false }, "first card");
  eq(fsStage(2, 5), { count: "3 / 5", prevDisabled: false, nextDisabled: false }, "middle");
  eq(fsStage(4, 5), { count: "5 / 5", prevDisabled: false, nextDisabled: true }, "last card");
  eq(fsStage(0, 1), { count: "1 / 1", prevDisabled: true, nextDisabled: true }, "a lone card");
  eq(fsStage(0, 0), { count: "", prevDisabled: true, nextDisabled: true }, "no card: nothing to stage");
  eq(fsStage(9, 3), { count: "3 / 3", prevDisabled: false, nextDisabled: true }, "an index past the strip clamps");
});

t("foldLabel: a description that fits needs no toggle", () => {
  eq(foldLabel(false, false), null, "closed and fitting: no button");
  eq(foldLabel(false, true), "more", "closed and clipped: offers more");
  eq(foldLabel(true, true), "less", "open: offers less");
  eq(foldLabel(true, false), "less", "open text never overflows its one line, the button still folds it back");
});

t("shortcutKey leaves chords and typing to the browser", () => {
  const plain = { key: "c", metaKey: false, ctrlKey: false, altKey: false };
  eq(shortcutKey(plain, false), "c", "a bare key is a shortcut");
  eq(shortcutKey({ ...plain, metaKey: true }, false), null, "⌘c is copy, not the chat");
  eq(shortcutKey({ ...plain, ctrlKey: true }, false), null, "ctrl-c likewise");
  eq(shortcutKey({ ...plain, key: "s", metaKey: true }, false), null, "⌘s is the browser's save, not send");
  eq(shortcutKey({ ...plain, key: "f", altKey: true }, false), null, "alt chords are not ours either");
  eq(shortcutKey({ ...plain, key: "?" }, false), "?", "shift is part of the key, so ? still opens the help");
  eq(shortcutKey(plain, true), null, "a key typed into a field is text");
});

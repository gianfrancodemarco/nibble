// Runs the compiled test build under node with the vendored highlight.js
// loaded the way a browser <script> tag loads it: evaluated in global scope,
// so its top-level `var hljs` lands on globalThis. build.js then runs with
// the same global the app sees.
"use strict";
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

for (const f of [
  join(__dirname, "..", "..", "cli", "internal", "cmd", "ui", "highlight.min.js"),
  join(__dirname, "build.js"),
]) {
  vm.runInThisContext(readFileSync(f, "utf8"), { filename: f });
}

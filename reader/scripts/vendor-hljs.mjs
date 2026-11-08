// Vendors highlight.js into the UI: fetches upstream's official
// common-languages browser build, byte-identical at a pinned version, and
// writes it next to app.js where `go:embed ui` picks it up. v11 ships no
// classic core-only build, so the bundle carries upstream's common grammar
// set; which languages the reader actually uses is decided by langOf() in
// src/highlight.ts. License: BSD-3-Clause, header kept inside the file.
//
// Usage: node scripts/vendor-hljs.mjs   (from reader/)

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "11.11.1";
const URL = `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/${VERSION}/highlight.min.js`;
const SHA256 = "c4a399dd6f488bc97a3546e3476747b3e714c99c57b9473154c6fb8d259b9381";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "cli", "internal", "cmd", "ui", "highlight.min.js");

const res = await fetch(URL);
if (!res.ok) throw new Error(`${URL}: ${res.status}`);
const body = Buffer.from(await res.arrayBuffer());
const got = createHash("sha256").update(body).digest("hex");
if (got !== SHA256) throw new Error(`hash mismatch for ${URL}\n  got  ${got}\n  want ${SHA256}`);
writeFileSync(OUT, body);
console.log(`wrote ${OUT} (${body.length} bytes, highlight.js ${VERSION})`);

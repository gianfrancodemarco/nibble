#!/usr/bin/env bash
# Rebuilds the live-demo data under docs/visuals/ from this directory:
# builds the CLI, authors the demo plate with it against a temp git copy of
# repo/ (so refs read "src/…" and fingerprints are real), nudges one file to
# demo a shifted ref, serves, and snapshots the JSON the reader fetches.
set -euo pipefail
cd "$(dirname "$0")"
ROOT=$(cd ../.. && pwd)
OUT="$ROOT/docs/visuals"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
BIN="$WORK/nibble"
(cd "$ROOT/cli" && go build -o "$BIN" ./cmd/nibble)

# the demo "project": a throwaway git repo so paths are src/…
cp -R repo "$WORK/shop"
git -C "$WORK/shop" init -q
git -C "$WORK/shop" -c user.name=demo -c user.email=demo@nibble add -A
git -C "$WORK/shop" -c user.name=demo -c user.email=demo@nibble commit -qm "shop"

export NIBBLE_HOME="$WORK/home"
cd "$WORK/shop"

PLATE=$("$BIN" new --title "Why checkout slows down every hour" --about code \
  --description "Checkout p99 jumps to 4.2 s on the hour. The cause is one flat cache TTL." \
  --description-standard "Every cached price expires exactly 3600 s after it was warmed, so all 41 keys die together at the top of the hour and every miss races to Postgres at once, saturating the 20-connection pool. Jittering the TTL spreads the expiries over ten minutes and the spike becomes a plateau.")

"$BIN" add "$PLATE" \
  --title "One \`getPrice\` call touches three things; the **cache** is where the trouble starts." \
  --description "The cache sits between checkout and Postgres; misses go straight through." \
  --description-standard "checkout-api calls getPrice per item. A hit returns from memory; a miss runs a SELECT through the shared pool. The pool has 20 connections, so correlated misses are the only way this picture hurts — which is exactly what synchronized expiry produces." \
  --visual "$ROOT/docs/demo/visuals/map.json" \
  --ref "src/api/checkout.ts:3-9 @checkout the endpoint" \
  --ref "src/cache/prices.ts:9-11 @cache the cache-first read" \
  --ref "src/db/pool.ts:4-7 @db pool max 20"

"$BIN" add "$PLATE" \
  --title "The query itself is fine; it is the **41 at once** that saturates the pool." \
  --visual "$ROOT/docs/demo/visuals/sequence.json" \
  --ref "src/cache/prices.ts:12 @s3 the select on miss"

"$BIN" add "$PLATE" \
  --title "Every cached price expires **on the hour**, so every miss hits Postgres in the same second." \
  --visual "$ROOT/docs/demo/visuals/timeline.json" \
  --ref "src/cache/prices.ts:6-7 @expiry the flat ttl"

"$BIN" add "$PLATE" \
  --title "Jitter spreads the expiries; the spike becomes a plateau." \
  --visual "$ROOT/docs/demo/visuals/compare.json" \
  --ref "src/cache/prices.ts:13-14 @after the jittered ttl"

"$BIN" done "$PLATE"

# nudge pool.ts so its ref demos a shifted badge at snapshot time
python3 - "$WORK/shop/src/db/pool.ts" <<'EOF'
import sys
p = sys.argv[1]
lines = open(p).read().splitlines(keepends=True)
lines.insert(1, "import { metrics } from \"../metrics\";\n")
open(p, "w").writelines(lines)
EOF

ADDR=127.0.0.1:4799
"$BIN" serve "$PLATE" --addr "$ADDR" >/dev/null 2>&1 &
SERVE=$!
for _ in $(seq 1 40); do curl -sf "http://$ADDR/api/plate" >/dev/null && break; sleep 0.25; done

mkdir -p "$OUT/data"
curl -s "http://$ADDR/api/plate" >"$OUT/data/plate.json"
python3 - "$OUT/data/plate.json" <<'EOF' | while read -r n r; do
import json, sys
d = json.load(open(sys.argv[1]))
for nb in d["nibbles"]:
    for i in range(len(nb["refs"])):
        print(nb["n"], i)
EOF
  curl -s "http://$ADDR/api/code?n=$n&ref=$r" >"$OUT/data/code-$n-$r.json"
done
kill "$SERVE" 2>/dev/null || true

# bundle the snapshots into data.js; the shim reads them from memory, so
# the demo also works when reader.html is opened as a file:// URL
python3 - "$OUT" <<'EOF'
import json, os, sys
out = sys.argv[1]
d = {}
for f in sorted(os.listdir(os.path.join(out, "data"))):
    if f.endswith(".json"):
        with open(os.path.join(out, "data", f)) as fh:
            d[f[:-5]] = json.load(fh)
with open(os.path.join(out, "data.js"), "w") as fh:
    fh.write("window.NIBBLE_DEMO_DATA = " + json.dumps(d) + ";\n")
EOF

# the real reader, verbatim, plus the demo shim wired in front of app.js
cp "$ROOT/cli/internal/cmd/ui/app.js" "$OUT/app.js"
cp "$ROOT/cli/internal/cmd/ui/style.css" "$OUT/style.css"
sed 's#<script src="app.js"></script>#<script src="data.js"></script>\n<script src="shim.js"></script>\n<script src="app.js"></script>#' \
  "$ROOT/cli/internal/cmd/ui/index.html" >"$OUT/reader.html"

echo "demo data written to docs/visuals/ (plate + $(ls "$OUT/data" | grep -c code) code snapshots)"

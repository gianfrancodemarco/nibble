#!/usr/bin/env bash
# Rebuilds the live-demo data under docs/visuals/ from this directory:
# builds the CLI, authors the demo plate with it against a temp git copy of
# repo/ (so refs read "src/…" and fingerprints are real), nudges one file to
# demo a shifted ref, runs one round of the review loop (a comment, the
# agent's reply, a follow-up, a reply) so the chat panel has a conversation
# to show, serves, and snapshots the JSON the reader fetches.
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
  --description "The [cache](@cache) sits between checkout and [Postgres](@db); misses go straight through." \
  --description-standard "[checkout-api](@checkout) calls getPrice per item. A hit returns from memory; a miss runs a SELECT through the shared [pool](@db). The pool has 20 connections, so correlated misses are the only way this picture hurts — which is exactly what synchronized expiry produces." \
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

# the conversation: a comment on the cache node, answered with a ref and a
# prose link; a follow-up in the same thread, answered. The reader's own
# turn is left open (round 2 answered, no round 3), so the demo composer
# takes drafts.
cat >"$PLATE/review.json" <<'REVIEW'
{ "comments": [ { "target": "n1:cache", "text": "do the price writes bypass the cache, or go through it?" } ] }
REVIEW
"$BIN" reply "$PLATE" --to 1 \
  --text "Through it: every write lands in the [cache](@cache) first and the [pool](@db) only sees the misses — these are the lines." \
  --ref "src/cache/prices.ts:9-11 the cache-first read"
# Round 2 goes through the API, as the reader sends it, so the comment on
# lines carries a real fingerprint: serve, post, let serve exit with the
# round, stand its keeper down.
ADDR=127.0.0.1:4799
"$BIN" serve "$PLATE" --addr "$ADDR" >/dev/null 2>&1 &
SERVE=$!
for _ in $(seq 1 40); do curl -sf "http://$ADDR/api/plate" >/dev/null && break; sleep 0.25; done
curl -sf -X POST "http://$ADDR/api/review" -H 'Content-Type: application/json' -d @- >/dev/null <<'REVIEW'
{ "comments": [
    { "thread": "1.1", "text": "so a stale write is served until the TTL runs out?" },
    { "target": "n3:expiry", "ref": { "ref": "src/cache/prices.ts:6-7" }, "text": "is this one clock for every key, or a TTL per key?" } ] }
REVIEW
wait "$SERVE" || true
curl -s -X POST "http://$ADDR/api/handoff" -d @"$PLATE/.serve.json" >/dev/null || true
for _ in $(seq 1 40); do curl -sf "http://$ADDR/api/plate" >/dev/null || break; sleep 0.25; done
"$BIN" reply "$PLATE" --to 1 \
  --text "Yes — up to one TTL. With jitter that window varies per key instead of expiring all at once."
"$BIN" reply "$PLATE" --to 2 \
  --text "One clock: these two lines set the same expiry for every key written in the same second, which is the whole problem." \
  --ref "src/cache/prices.ts:6-7 the flat ttl"

# nudge pool.ts so its ref demos a shifted badge at snapshot time
python3 - "$WORK/shop/src/db/pool.ts" <<'EOF'
import sys
p = sys.argv[1]
lines = open(p).read().splitlines(keepends=True)
lines.insert(1, "import { metrics } from \"../metrics\";\n")
open(p, "w").writelines(lines)
EOF

"$BIN" serve "$PLATE" --addr "$ADDR" >/dev/null 2>&1 &
SERVE=$!
for _ in $(seq 1 40); do curl -sf "http://$ADDR/api/plate" >/dev/null && break; sleep 0.25; done

mkdir -p "$OUT/data"
curl -s "http://$ADDR/api/plate" >"$OUT/data/plate.json"
python3 - "$OUT/data/plate.json" <<'EOF' | while read -r kind a b c; do
import json, sys
d = json.load(open(sys.argv[1]))
for nb in d["nibbles"]:
    for i in range(len(nb["refs"])):
        print("n", nb["n"], i, 0)
for r in d["thread"]["rounds"]:
    for i, cm in enumerate(r["comments"], 1):
        if cm.get("ref") and not cm.get("thread"):
            print("comment", cm["id"], 0, 0)
        for j in range(len((cm.get("reply") or {}).get("refs", []))):
            print("reply", r["n"], i, j)
EOF
  if [ "$kind" = n ]; then
    curl -s "http://$ADDR/api/code?n=$a&ref=$b" >"$OUT/data/code-$a-$b.json"
  elif [ "$kind" = comment ]; then
    curl -s "http://$ADDR/api/code?comment=$a" >"$OUT/data/comment-$a.json"
  else
    curl -s "http://$ADDR/api/code?round=$a&comment=$b&ref=$c" >"$OUT/data/reply-$a-$b-$c.json"
  fi
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

echo "demo data written to docs/visuals/ (plate + $(ls "$OUT/data" | grep -c code) code snapshots + $(ls "$OUT/data" | grep -c reply) reply ref snapshots + $(ls "$OUT/data" | grep -c comment) comment line snapshots)"

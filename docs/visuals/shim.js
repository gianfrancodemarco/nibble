// Demo shim: the real reader, fed from static snapshots instead of
// `nibble serve`. Everything the shell fetches is answered from
// window.NIBBLE_DEMO_DATA (data.js, bundled by docs/demo/make.sh from
// data/*.json; trust was computed by the real server at snapshot time).
// The data is inlined instead of fetched so the demo also works when the
// page is opened as a file:// URL, where fetch() of local files is blocked.
// A round sent from the demo lives only in this tab's memory (it lands as
// the next round, awaiting an agent that never comes), so the demo resets
// on reload.
(function () {
  const realFetch = window.fetch.bind(window);
  const DATA = window.NIBBLE_DEMO_DATA || {};
  let sent = null; // the round sent from this tab, if any

  const json = (obj, status) => Promise.resolve(new Response(
    JSON.stringify(obj),
    { status: status || 200, headers: { "Content-Type": "application/json" } },
  ));

  window.fetch = function (url, opts) {
    const u = String(url);
    if (u.startsWith("api/plate")) {
      const d = JSON.parse(JSON.stringify(DATA["plate"] || {}));
      d.thread = d.thread || { turn: "reader", rounds: [] };
      if (sent) {
        const n = d.thread.rounds.length + 1;
        const all = d.thread.rounds.flatMap((r) => r.comments);
        d.thread.rounds.push({ n, comments: sent.comments.map((c, i) => {
          const opener = c.thread && all.find((x) => x.id === c.thread);
          const out = { id: `${n}.${i + 1}`, target: c.target || (opener && opener.target), thread: c.thread, text: c.text, reply: null };
          // a comment on lines: no server to resolve it here, so it reads as
          // unverified at the range the reader named
          const ref = c.ref ? c.ref.ref : opener && opener.ref && opener.ref.ref;
          const m = ref && /^(?:diff:([^@\s]+)@([^:\s]*)|([^:\s]+)):(\d+)(?:-(\d+))?/.exec(ref);
          if (m) {
            const start = Number(m[4]);
            const end = m[5] ? Number(m[5]) : start;
            out.ref = c.ref ? { ref, path: m[1] || m[3], start, end, at: m[1] ? `diff:${m[1]}@${m[2]}` : m[3], trust: { level: "unverified", line: start, shift: 0 } } : opener.ref;
          }
          return out;
        }) });
        d.thread.turn = sent.comments.length ? "agent" : "reader";
      }
      return json(d);
    }
    let m = u.match(/^api\/code\?n=(\d+)&ref=(\d+)/);
    if (m) {
      const d = DATA[`code-${m[1]}-${m[2]}`];
      if (d) return json(d);
      return json({ error: { code: "code.missing", message: "no snapshot for this ref" } }, 404);
    }
    m = u.match(/^api\/code\?comment=(\d+\.\d+)$/);
    if (m) {
      const d = DATA[`comment-${m[1]}`];
      if (d) return json(d);
      return json({ error: { code: "code.missing", message: "no snapshot for this comment's lines" } }, 404);
    }
    m = u.match(/^api\/code\?round=(\d+)&comment=(\d+)&ref=(\d+)/);
    if (m) {
      const d = DATA[`reply-${m[1]}-${m[2]}-${m[3]}`];
      if (d) return json(d);
      return json({ error: { code: "code.missing", message: "no snapshot for this reply ref" } }, 404);
    }
    if (u.startsWith("api/review")) {
      if (sent) {
        return json({ error: { code: "review.exists", message: "the round you sent is still awaiting a reply — no agent is behind the demo; reload to reset" } }, 409);
      }
      sent = JSON.parse(String(opts && opts.body));
      return json({ ok: true });
    }
    return realFetch(url, opts);
  };

  // no live agent behind the demo: SSE becomes a silent stub
  window.EventSource = class {
    addEventListener() {}
    close() {}
  };
})();

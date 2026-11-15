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
          return { id: `${n}.${i + 1}`, target: c.target || (opener && opener.target), thread: c.thread, text: c.text, reply: null };
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

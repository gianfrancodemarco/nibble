// Demo shim: the real reader, fed from static snapshots instead of
// `nibble serve`. Everything the shell fetches is answered from
// window.NIBBLE_DEMO_DATA (data.js, bundled by docs/demo/make.sh from
// data/*.json; trust was computed by the real server at snapshot time).
// The data is inlined instead of fetched so the demo also works when the
// page is opened as a file:// URL, where fetch() of local files is blocked.
// A submitted review lives only in this tab's memory, so the demo resets
// on reload.
(function () {
  const realFetch = window.fetch.bind(window);
  const DATA = window.NIBBLE_DEMO_DATA || {};
  let review = null;

  const json = (obj, status) => Promise.resolve(new Response(
    JSON.stringify(obj),
    { status: status || 200, headers: { "Content-Type": "application/json" } },
  ));

  window.fetch = function (url, opts) {
    const u = String(url);
    if (u.startsWith("api/plate")) {
      const d = JSON.parse(JSON.stringify(DATA["plate"] || {}));
      if (review) d.review = review;
      return json(d);
    }
    const m = u.match(/^api\/code\?n=(\d+)&ref=(\d+)/);
    if (m) {
      const d = DATA[`code-${m[1]}-${m[2]}`];
      if (d) return json(d);
      return json({ error: { code: "code.missing", message: "no snapshot for this ref" } }, 404);
    }
    if (u.startsWith("api/review")) {
      if (review) {
        return json({ error: { code: "review.exists", message: "this demo plate already has a review — reload to reset" } }, 409);
      }
      review = JSON.parse(String(opts && opts.body));
      return json({});
    }
    return realFetch(url, opts);
  };

  // no live agent behind the demo: SSE becomes a silent stub
  window.EventSource = class {
    addEventListener() {}
    close() {}
  };
})();

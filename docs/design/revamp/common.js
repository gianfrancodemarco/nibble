// Shared behaviour for the revamp variants: the visual interactions (chips,
// selection, sequence stepping, timeline scrub and states, compare flip), the
// dial, the drawer content, the chat threads. Each variant owns its layout and
// its navigation; it calls into here with a small API.
(function () {
  const P = window.PLATE;
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const hl = (t) => esc(t)
    .replace(/(\/\/.*$|#.*$)/, '<span class="hljs-comment">$1</span>')
    .replace(/("[^"]*"|`[^`]*`)/g, '<span class="hljs-string">$1</span>')
    .replace(/\b(package|import|func|return|const|let|var|if|else|for|new|async|await|type|interface|string|number|boolean|void|null|true|false|export|function)\b/g, '<span class="hljs-keyword">$1</span>')
    .replace(/\b(\d+)\b/g, '<span class="hljs-number">$1</span>');

  const C = {
    plate: P,
    descAt(d, level) { if (!d) return null; return level === 'standard' ? (d.standard || d.overview) : d.overview; },
    visualHTML(nb) { return `<span class="kind">${nb.kind}</span>${nb.html}`; },
    drawerHTML(refKey) {
      const c = P.code[refKey]; if (!c) return '';
      const first = c.lines[0].no, last = c.lines[c.lines.length - 1].no;
      return `<header><span aria-hidden="true">▾</span><span class="path">${c.path}</span><span>${first}–${last}</span><span class="trust exact">exact</span><span class="spacer"></span><button class="close" title="close (esc)">×</button></header>
        <pre>${c.lines.map((l) => `<div class="ln in" data-no="${l.no}"><span class="no" title="select this line to comment on it">${l.no}</span><span>${hl(l.text || ' ')}</span></div>`).join('')}</pre>`;
    },
    threadsHTML(focused) {
      return P.threads.map((t) => `<section class="thread${t.key === focused ? ' focused' : ''}" data-key="${t.key}" data-card="${t.card}"><header><button class="tchip" title="go to it on the plate">${t.target}</button></header><div class="msgs">${t.msgs.map((m) => `<div class="msg ${m.from}"><span class="who">${m.from}</span><p>${m.text}</p>${m.ref ? `<button class="mref" data-ref="${m.ref}">${m.ref.split(':')[0]}:${m.ref.split(':')[1]} <span class="trust exact">exact</span></button>` : ''}</div>`).join('')}${t.awaiting ? '<div class="msg awaiting"><span class="pulse"></span>awaiting the agent\'s reply…</div>' : ''}</div></section>`).join('');
    },
    // wireVisual: the per-kind interactions inside one rendered visual body.
    wireVisual(body, api) {
      body.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip, .chip-h');
        if (chip) { e.stopPropagation(); api.openDrawer(chip.dataset.ref); return; }
        const sel = e.target.closest('[data-anchor]');
        if (sel) { e.stopPropagation(); const was = sel.classList.contains('sel'); body.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel')); sel.classList.toggle('sel', !was); sel.classList.remove('unvisited'); body.classList.toggle('has-sel', !was); api.onSelect(was ? null : sel.dataset.anchor); return; }
        const btn = e.target.closest('.seq-ctrl .btn'); if (btn) { C.stepSeq(body, +btn.dataset.step); return; }
        const st = e.target.closest('.tl-state'); if (st) { body.querySelectorAll('.tl-state').forEach((b) => b.classList.toggle('on', b === st)); body.querySelectorAll('.state').forEach((g) => g.classList.toggle('on', g.dataset.state === st.dataset.state)); C.scrubTl(body, body.querySelector('.tl-scrub').value); return; }
        const flip = e.target.closest('.cmp-flip'); if (flip) { const panes = body.querySelector('.cmp-panes'); const f = panes.classList.contains('focus-after') ? 'focus-before' : 'focus-after'; panes.classList.remove('focus-before', 'focus-after'); panes.classList.add(f); return; }
      });
      const scrub = body.querySelector('.tl-scrub');
      if (scrub) { scrub.addEventListener('input', () => C.scrubTl(body, scrub.value)); body.querySelector('.state[data-state="silent"]')?.classList.add('on'); C.scrubTl(body, 0); }
      if (body.querySelector('.vis-seq')) C.stepSeq(body, 0);
    },
    stepSeq(body, delta) {
      const steps = [...body.querySelectorAll('.vis-seq .step')];
      const cur = steps.findIndex((s) => s.classList.contains('cur'));
      let next = Math.max(-1, Math.min(steps.length - 1, (delta === 0 ? cur : cur + delta)));
      steps.forEach((s, i) => { s.classList.toggle('cur', i === next); s.classList.toggle('done', i < next); });
      body.querySelector('.seq-ctrl .count').textContent = `${next + 1}/${steps.length}`;
    },
    scrubTl(body, at) {
      at = +at;
      body.querySelectorAll('.state.on .ev').forEach((ev) => ev.classList.toggle('pending', +ev.dataset.at > at));
      const x = 90 + at / 270 * 560; const c = body.querySelector('.cursor'); c.setAttribute('x1', x); c.setAttribute('x2', x);
      body.querySelector('.tl-at').textContent = `t = ${at} s`;
    },
    stepActive(body, delta) {
      if (!body) return;
      if (body.querySelector('.vis-seq')) C.stepSeq(body, delta);
      else if (body.querySelector('.tl-scrub')) { const s = body.querySelector('.tl-scrub'); s.value = Math.max(0, Math.min(270, +s.value + delta * 15)); C.scrubTl(body, s.value); }
      else if (body.querySelector('.cmp-flip')) body.querySelector('.cmp-flip').click();
    },
    helpHTML(rows) {
      return rows.map(([k, t]) => `<div class="krow"><kbd>${k}</kbd><span>${t}</span></div>`).join('') + '<p>Chips open the code behind a thing. Click a line number there to comment on that line. <b>Send</b> in the chat wakes the agent; a send with nothing in it means done.</p>';
    },
    theme() { // the variants honour the viewer's theme; a `t` key flips it for the comparison
      document.addEventListener('keydown', (e) => { if (e.key === 't' && !(e.target instanceof HTMLTextAreaElement)) { const r = document.documentElement; const dark = r.dataset.theme === 'dark' || (!r.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches); r.dataset.theme = dark ? 'light' : 'dark'; } });
    },
  };
  window.COMMON = C;
})();

(function () {
  var root = document.documentElement;
  try { var t = localStorage.getItem('nibble-theme'); if (t) root.setAttribute('data-theme', t); } catch (e) {}
  var btn = document.getElementById('themeBtn');
  if (btn) btn.addEventListener('click', function () {
    var cur = root.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    var next = cur === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('nibble-theme', next); } catch (e) {}
  });
})();

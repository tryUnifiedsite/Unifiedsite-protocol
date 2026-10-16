(function () {
  var h = document.documentElement;
  h.classList.add('js');
  var q = window.matchMedia('(prefers-reduced-motion: reduce)');
  function sync() { h.classList.toggle('rm', q.matches); }
  sync();
  if (q.addEventListener) q.addEventListener('change', sync);
})();

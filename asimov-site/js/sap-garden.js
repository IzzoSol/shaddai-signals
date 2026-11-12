/* SAP Garden — the play mode is the plots game, Asimov Grove (3D farm tycoon).
   The earlier match-3 mini-game was retired at the owner's request; this tab now embeds the real game.
   The game keeps its own saves on this device and needs no account, keys or network after the first load. */
(function () {
  'use strict';
  const SRC = 'grove/';
  function mount() {
    const root = document.getElementById('garden-root'); if (!root || root.dataset.ready) return; root.dataset.ready = 1;
    root.innerHTML = `
    <div class="pagehead"><div><div class="cap">SAP · play mode</div><h1>Asimov Grove</h1><p class="mut">Grow your plots: plant, tend and collect, finish each garden's missions, and unlock the next garden — Island Farm, Dune Oasis, Hillside Terraces.</p></div>
      <div class="btns"><a class="btn" href="${SRC}" target="_blank" rel="noopener" style="text-decoration:none">Open full screen</a></div></div>
    <div class="glass" style="padding:0;overflow:hidden;border-radius:16px;height:calc(100vh - 58px - var(--dock, 64px) - 150px);min-height:520px">
      <iframe src="${SRC}" title="Asimov Grove — the plots game" style="width:100%;height:100%;border:0;display:block" allow="autoplay" loading="lazy"></iframe></div>
    <p class="mut xs" style="margin-top:8px">Shells are practice currency with no cash value. No wallet, ads or tracking.</p>`;
  }
  window.addEventListener('sapview', e => { if (e.detail === 'garden') mount(); });
  if (document.getElementById('v-garden') && document.getElementById('v-garden').classList.contains('active')) mount();
})();
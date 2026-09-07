/* ==========================================================================
   COMMAND PALETTE  —  Ctrl+K, or the topbar search.

   In this domain every conversation is an identifier — "check CHN-33-000442"
   — so search is not a nicety, it is how people move. The magnifier sat in
   the topbar of every screen doing nothing, which was the single deadest tell
   in the app. It now opens a palette over the record stores and the pages,
   routed through the same openRecord()/navigatePage() everything else uses.
   ========================================================================== */

let paletteOpen = false;
let paletteSel = 0;

/* Everything searchable, rebuilt on open so it always reflects live state. */
function paletteIndex() {
  const ix = [];
  const add = (id, title, kind, extra) => ix.push({ id, title, kind, extra: extra || '' });

  if (typeof scrStore !== 'undefined') {
    scrStore.forEach(r => add(r.id, r.title, 'Request', vendor(r.vendorId).name + ' · ' + r.status));
    poStore.forEach(p => add(p.id, 'Order for ' + p.scrId, 'Order', vendor(p.vendorId).name + ' · ' + p.status));
    shipmentStore.forEach(s => add(s.id, 'Shipment on ' + s.scrId, 'Shipment', s.status));
    dnoteStore.forEach(d => add(d.id, 'Delivery note for ' + d.shipmentId, 'Delivery Note', d.status));
    challanStore.forEach(c => add(c.id, 'Challan for ' + c.shipmentId, 'Challan',
      vendor(c.vendorId).name + ' · ' + c.status));
    imrStore.forEach(i => add(i.id, 'Receipt against ' + i.challanId, 'Receipt', i.status));
  }
  Object.keys(PAGE_TITLE).forEach(pg => {
    if (can(pg, 'v')) ix.push({ id: null, page: pg, title: PAGE_TITLE[pg], kind: 'Page', extra: '' });
  });
  return ix;
}

function openPalette() {
  if (paletteOpen) return;
  paletteOpen = true;
  paletteSel = 0;
  let host = document.getElementById('palette-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'palette-host';
    document.body.appendChild(host);
  }
  host.innerHTML =
    '<div class="pal-back" onclick="if(event.target===this)closePalette()">' +
      '<div class="pal" role="dialog" aria-label="Search">' +
        '<input class="pal-input" id="pal-input" placeholder="Search by id, title or vendor — SUB-000318, challan, Sri Balaji…" ' +
          'oninput="renderPaletteResults()" autocomplete="off" spellcheck="false">' +
        '<div class="pal-results" id="pal-results"></div>' +
        '<div class="pal-foot"><span>&uarr;&darr; to choose</span><span>&crarr; to open</span><span>Esc to close</span></div>' +
      '</div>' +
    '</div>';
  renderPaletteResults();
  document.getElementById('pal-input').focus();
}

function closePalette() {
  paletteOpen = false;
  const host = document.getElementById('palette-host');
  if (host) host.innerHTML = '';
}

function paletteMatches() {
  const q = (document.getElementById('pal-input') || {}).value || '';
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const ix = paletteIndex();
  if (!terms.length) {
    /* Empty query: the pages, plus the most recent records — a "jump back in". */
    return ix.filter(x => x.kind === 'Page').slice(0, 6)
      .concat(ix.filter(x => x.id).slice(-5).reverse());
  }
  return ix.filter(x => {
    const hay = ((x.id || '') + ' ' + x.title + ' ' + x.kind + ' ' + x.extra).toLowerCase();
    return terms.every(t => hay.indexOf(t) !== -1);
  }).slice(0, 12);
}

function renderPaletteResults() {
  const box = document.getElementById('pal-results');
  if (!box) return;
  const rows = paletteMatches();
  if (paletteSel >= rows.length) paletteSel = Math.max(0, rows.length - 1);
  box.innerHTML = rows.length ? rows.map((x, i) =>
    '<button type="button" class="pal-row' + (i === paletteSel ? ' sel' : '') + '" ' +
      'onmouseenter="paletteSel=' + i + ';renderPaletteResults()" ' +
      'onclick="paletteGo(' + i + ')">' +
      '<span class="pal-kind">' + esc(x.kind) + '</span>' +
      '<span class="pal-main">' + (x.id ? '<b class="mono">' + esc(x.id) + '</b> ' : '') + esc(x.title) + '</span>' +
      (x.extra ? '<span class="pal-extra">' + esc(x.extra) + '</span>' : '') +
    '</button>').join('')
    : '<div class="pal-none">Nothing matches. Try an id like SUB-000318, or a vendor name.</div>';
}

function paletteGo(i) {
  const rows = paletteMatches();
  const x = rows[i];
  if (!x) return;
  closePalette();
  if (x.id) openRecord(x.id);
  else navigatePage(x.page);
}

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    paletteOpen ? closePalette() : openPalette();
    return;
  }
  if (!paletteOpen) return;
  const rows = paletteMatches();
  if (e.key === 'Escape') { closePalette(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); paletteSel = Math.min(rows.length - 1, paletteSel + 1); renderPaletteResults(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); paletteSel = Math.max(0, paletteSel - 1); renderPaletteResults(); }
  else if (e.key === 'Enter') { e.preventDefault(); paletteGo(paletteSel); }
});

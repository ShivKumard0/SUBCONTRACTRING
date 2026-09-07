/* ==========================================================================
   M-07  INWARD, RECONCILIATION AND CLOSURE   (US11–US14, US19 restored)

   Material comes back, gets accounted for, and the transaction closes.

   THE BALANCE SHEET IS THE POINT.  Closure is blocked while any issue-material
   line is unaccounted for:

     Balance = Issued − Consumed@BOM − Returned Unprocessed − Scrap

   Consumption is DERIVED from confirmed receipt (Received × BOM Ratio), never
   typed — otherwise the sheet could be balanced by simply entering a number.
   ========================================================================== */

let inwSelected = null;

/* Shared with the dashboard tile, so the count and the list cannot diverge —
   the tile filtered on outstanding and the page did not. */
function inwardQueue() { return challanStore.filter(c => c.gateOutAt && c.status !== 'Closed'); }

/* ── Inward queue ───────────────────────────────────────────────────────── */
function buildInwardPage() {
  if (inwSelected && challan(inwSelected)) return buildInwardDetail(challan(inwSelected));
  refreshReturnWindows();

  const open = inwardQueue();
  return buildPageHead('Stores Inward',
      'Material returns against an open Challan. Partial receipts are expected — several records may be raised against the same challan and the outstanding balance is recalculated on every confirmation.') +
    buildListing({
      stats: [
        { label: 'Open challans', count: open.length },
        { label: 'Overdue', count: open.filter(c => c.status === 'Overdue').length },
        { label: 'Records raised', count: imrStore.length },
        { label: 'Unconfirmed', count: imrStore.filter(i => i.status === 'Created').length }
      ],
      columns: [
        { label: 'Challan', cell: c => '<b>' + esc(c.id) + '</b>' },
        { label: 'Vendor', cell: c => esc(vendor(c.vendorId).name) },
        { label: 'Gate outward', cell: c => esc(c.gateOutAt || '—') },
        { label: 'Return by', cell: c => esc(c.returnByDate || '—') },
        { label: 'Days left', cell: c => challanDaysCell(c), align: 'right' },
        { label: 'Outstanding', cell: c => fmtQty(challanOutstanding(c.id)), align: 'right' },
        { label: 'Notice', cell: c => { const a = latestAsn(c.id);
            return a ? '<span class="chip chip-on">' + esc(fmtDate(a.expectedDate)) + '</span>'
                     : '<span class="vp-none">No ASN</span>'; } },
        { label: 'Status', cell: c => sbStatus(c.status) },
        { label: '', align: 'right', cell: c => canDo('create-imr')
            ? '<button class="btn-outline btn-sm" onclick="event.stopPropagation();openInward(\'' + c.id + '\')">Receive</button>' : '' }
      ],
      rows: open,
      onRow: c => 'openInward(\'' + c.id + '\')',
      empty: 'No material is currently out with a vendor.'
    });
}

function openInward(id) { inwSelected = id; renderPage(); }
function backToInward() { inwSelected = null; renderPage(); }

function buildInwardDetail(c) {
  const r = scr(c.scrId);
  const asn = latestAsn(c.id);
  const records = imrsForChallan(c.id);

  return buildPageHead('Receive against ' + c.id,
      'Request ' + esc(c.scrId) + ' · ' + esc(vendor(c.vendorId).name),
      '<button class="btn-outline" onclick="backToInward()">Back</button>' +
      actionBtn('Record receipt', 'openImrForm(\'' + c.id + '\')', canDo('create-imr'),
        'Only Stores can record an inward receipt.', 'btn-primary')) +
    /* An ASN pre-fills; its absence changes nothing. */
    (asn
      ? buildNotice('<b>Advance notice.</b> The vendor expects to return ' + fmtQty(asn.qty) + ' of ' +
          esc(product(asn.productId).name) + ' on ' + esc(fmtDate(asn.expectedDate)) +
          (asn.vehicle ? ' · vehicle ' + esc(asn.vehicle) : '') + '. The receipt form is pre-filled from it.', 'info')
      : buildNotice('No advance notice from the vendor. An ASN is optional, so receipt proceeds exactly as normal.', 'idle')) +
    '<div class="split"><div>' +
      buildCard('Expected back', scrLineTable(r, 'receivable')) +
      buildCard('Receipts against this challan', records.length
        ? '<div class="lines-wrap"><table class="lines"><thead><tr>' +
          '<th>Record</th><th>Received</th><th>Balance return</th><th>Scrap</th><th>Status</th><th></th>' +
          '</tr></thead><tbody>' + records.map(i =>
            '<tr><td><b class="mono">' + esc(i.id) + '</b><div class="dim">' + esc(i.createdOn) + '</div></td>' +
            '<td>' + (i.lines.map(l => esc(product(l.productId).name) + ' · ' + fmtQty(l.qty)).join('<br>') || '<span class="dim">—</span>') + '</td>' +
            '<td>' + (i.balances.map(l => esc(product(l.productId).name) + ' · ' + fmtQty(l.qty)).join('<br>') || '<span class="dim">—</span>') + '</td>' +
            '<td>' + (i.scraps.map(l => esc(product(l.productId).name) + ' · ' + fmtQty(l.qty)).join('<br>') || '<span class="dim">—</span>') + '</td>' +
            '<td>' + sbStatus(i.status) + '</td>' +
            '<td class="ta-right">' + (i.status === 'Created' && canDo('confirm-imr')
              ? '<button class="btn-primary btn-sm" onclick="confirmImrAction(\'' + i.id + '\')">Confirm</button>' : '') + '</td></tr>'
          ).join('') + '</tbody></table></div>'
        : '<div class="lst-empty">Nothing received yet against this challan.</div>') +
      buildBalanceSheet(c.scrId) +
    '</div><div>' + buildActivityPanelHTML(c.id) + '</div></div>';
}

/* ── The Issue-Material Balance Sheet ───────────────────────────────────── */
function buildBalanceSheet(scrId) {
  const rows = issueBalance(scrId);
  /* F12 · A deal that has never shipped used to render a confident green
     0.000 — visually identical to one that is fully reconciled. "Nothing to
     account for yet" and "everything accounted for" must not look the same. */
  if (!rows.length) return buildCard('Issue-material balance',
    '<div class="lst-empty">No material has been issued against this request yet, so there is nothing to reconcile.</div>');
  const r = scr(scrId);
  const anyOpen = rows.some(b => Math.abs(b.balance) > 0.001);
  const anyOff = rows.some(b => b.writtenOff > 0.001);
  /* One row per shipment. Without naming the shipment, a part-shipped deal
     shows the same product twice with identical figures and reads as a bug. */
  const multi = rows.length > new Set(rows.map(b => b.productId)).size;
  return buildCard('Issue-material balance — live',
    '<div class="lines-wrap"><table class="lines"><thead><tr>' +
      '<th>Issue item</th>' + (multi ? '<th>Shipment</th>' : '') +
      '<th class="ta-right">Issued</th><th class="ta-right">Consumed @ BOM ratio</th>' +
      '<th class="ta-right">Returned unprocessed</th><th class="ta-right">Scrap</th>' +
      (anyOff ? '<th class="ta-right">Short-closed</th>' : '') +
      '<th class="ta-right">Balance</th>' +
    '</tr></thead><tbody>' + rows.map(b => {
      const pr = product(b.productId);
      const zero = Math.abs(b.balance) <= 0.001;
      const fim = r.fim && pr.type === 'Raw' && b.productId === 'P-1002';
      return '<tr><td>' + esc(pr.name) +
        (fim ? ' <span class="dim">(free issue)</span>' : '') + '</td>' +
        (multi ? '<td class="mono dim">' + esc(b.shipmentId || '—') + '</td>' : '') +
        '<td class="ta-right">' + fmtQty(b.issued) + ' ' + esc(pr.uom) + '</td>' +
        '<td class="ta-right">' + fmtQty(b.consumed) + ' ' + esc(pr.uom) + '</td>' +
        '<td class="ta-right">' + fmtQty(b.returned) + '</td>' +
        '<td class="ta-right">' + fmtQty(b.scrap) + '</td>' +
        (anyOff ? '<td class="ta-right">' + fmtQty(b.writtenOff || 0) + '</td>' : '') +
        '<td class="ta-right ' + (zero ? 'bal-zero' : (b.balance < 0 ? 'bal-neg' : 'bal-open')) + '">' +
          fmtQty(b.balance) + ' ' + esc(pr.uom) + '</td></tr>';
    }).join('') + '</tbody></table></div>' +
    '<div class="bal-note">' + (anyOpen
      ? 'Closure is blocked while any balance is non-zero. Account for the remainder as consumption, an unprocessed return, or scrap — or short-close what is no longer coming back.'
      : 'Every issue line is fully accounted for. This request can be closed.') +
    (anyOff ? ' A short-closed quantity is written off against the issue material at its BOM ratio, so it stays visible rather than disappearing from the sheet.' : '') +
    '</div>');
}

/* ── Recording a receipt ────────────────────────────────────────────────── */
function openImrForm(cid) {
  const c = challan(cid);
  const r = scr(c.scrId);
  const asn = latestAsn(cid);
  const outstanding = r.receivableItems.filter(l => receivableOutstanding(c.scrId, l.line) > 0.001);
  const issued = issueBalance(c.scrId).filter(b => Math.abs(b.balance) > 0.001);

  const body = '<div id="imr-err"></div>' +
    '<p class="modal-note">Received back</p>' +
    '<div class="lines-wrap"><table class="lines"><thead><tr>' +
      '<th>Item</th><th class="ta-right">Outstanding</th><th class="ta-right">Receiving now</th>' +
    '</tr></thead><tbody>' + (outstanding.length ? outstanding.map(l => {
      const out = receivableOutstanding(c.scrId, l.line);
      /* Pre-filled from the ASN where one exists, blank where it does not. */
      const pre = (asn && asn.productId === l.productId) ? Math.min(asn.qty, out) : '';
      return '<tr><td>' + esc(product(l.productId).name) + '</td>' +
        '<td class="ta-right">' + fmtQty(out) + ' ' + esc(l.uom) + '</td>' +
        '<td class="ta-right"><input class="inp inp-num" id="imr-r-' + l.line + '" type="number" step="0.001" min="0" value="' +
        pre + '" style="height:30px;width:120px"></td></tr>';
    }).join('') : '<tr><td colspan="3" class="dim" style="padding:14px;text-align:center">Everything expected has been received.</td></tr>') +
    '</tbody></table></div>' +
    (issued.length ? '<p class="modal-note" style="margin-top:8px">Unprocessed material returned, and scrap</p>' +
      '<div class="lines-wrap"><table class="lines"><thead><tr>' +
      '<th>Issue item</th><th class="ta-right">Balance</th><th class="ta-right">Returned</th><th class="ta-right">Scrap</th>' +
      '</tr></thead><tbody>' + issued.map(b =>
        '<tr><td>' + esc(product(b.productId).name) + '</td>' +
        '<td class="ta-right">' + fmtQty(b.balance) + '</td>' +
        '<td class="ta-right"><input class="inp inp-num" id="imr-b-' + statusClass(b.productId) + '" type="number" step="0.001" min="0" value="" style="height:30px;width:100px"></td>' +
        '<td class="ta-right"><input class="inp inp-num" id="imr-s-' + statusClass(b.productId) + '" type="number" step="0.001" min="0" value="" style="height:30px;width:100px"></td></tr>'
      ).join('') + '</tbody></table></div>' : '');

  openModal('Record receipt against ' + cid, body, 'Create record', () => {
    const lines = [], balances = [], scraps = [];
    outstanding.forEach(l => {
      const q = numValue('imr-r-' + l.line);
      if (q > 0) lines.push({ line: l.line, productId: l.productId, qty: q, uom: l.uom });
    });
    issued.forEach(b => {
      const rq = numValue('imr-b-' + statusClass(b.productId));
      const sq = numValue('imr-s-' + statusClass(b.productId));
      if (rq > 0) balances.push({ productId: b.productId, qty: rq });
      if (sq > 0) scraps.push({ productId: b.productId, qty: sq });
    });

    const needReason = balances.length || scraps.length ||
      (lines.length && lines.some(l => l.qty < receivableOutstanding(c.scrId, l.line) - 0.001));

    const create = (reason, remarks) => {
      const res = createImr(cid, lines, balances, scraps, reason, remarks);
      if (!res.ok) { document.getElementById('imr-err').innerHTML = buildErrors(res.errors); return false; }
      toast('Record ' + res.imr.id + ' created. Confirm it to update stock.');
      renderPage();
      return true;
    };

    if (!lines.length && !balances.length && !scraps.length) {
      document.getElementById('imr-err').innerHTML = buildErrors(['Enter at least one quantity.']);
      return false;
    }
    if (needReason) {
      /* Scrap and short receipt are reason-gated (US11/AC11). The receipt
         modal closes so the reason modal is not stacked — but cancelling the
         reason used to discard every typed quantity with no way back. The
         typed receipt is held, and cancel REOPENS the form pre-filled. */
      const group = scraps.length ? 'RC-SCRAP' : (balances.length ? 'RC-BALRET' : 'RC-SHORTRCPT');
      imrHeld = { cid: cid, lines: lines, balances: balances, scraps: scraps };
      closeModal();
      setTimeout(() => openReasonModal(group, 'Reason required',
        (reason, remarks) => { imrHeld = null; return create(reason, remarks); },
        () => { restoreImrForm(); }), 60);
      return true;
    }
    return create('', '');
  });
}

/* The receipt a user had typed when the reason modal interrupted them. */
let imrHeld = null;
function restoreImrForm() {
  if (!imrHeld) return;
  const held = imrHeld;
  imrHeld = null;
  openImrForm(held.cid);
  /* Re-render happens synchronously inside openImrForm; put the values back. */
  held.lines.forEach(l => {
    const el = document.getElementById('imr-r-' + l.line);
    if (el) el.value = l.qty;
  });
  held.balances.forEach(b => {
    const el = document.getElementById('imr-b-' + statusClass(b.productId));
    if (el) el.value = b.qty;
  });
  held.scraps.forEach(s => {
    const el = document.getElementById('imr-s-' + statusClass(s.productId));
    if (el) el.value = s.qty;
  });
  toast('Nothing was lost — your receipt is back as you typed it.');
}

function confirmImrAction(id) {
  const res = confirmImr(id);
  if (!res.ok) { toast(res.error, 'bad'); return; }
  toast(res.outstanding > 0.001
    ? 'Confirmed. ' + fmtQty(res.outstanding) + ' still outstanding — a balance-pending notice has been raised.'
    : 'Confirmed. Everything expected has now been received.');
  renderPage();
}

/* ==========================================================================
   RECONCILIATION AND CLOSURE
   ========================================================================== */
let recSelected = null;

function buildReconciliationPage() {
  refreshReturnWindows();
  if (recSelected && scr(recSelected)) return buildReconciliationDetail(scr(recSelected));

  const active = scrStore.filter(r => r.status === 'Approved' || r.status === 'Closed');
  return buildPageHead('Reconciliation',
      'Nothing closes while material is unaccounted for. Every issue line must resolve to consumption, an unprocessed return, or scrap — and every receivable line must be received or validly short-closed.') +
    buildListing({
      stats: [
        { label: 'In progress', count: active.filter(r => r.status === 'Approved').length },
        { label: 'Ready to close', count: active.filter(r => r.status === 'Approved' && !reconciliationBlockers(r.id).length).length },
        { label: 'Closed', count: active.filter(r => r.status === 'Closed').length }
      ],
      columns: [
        { label: 'Request', cell: r => '<b>' + esc(r.id) + '</b>' },
        { label: 'Title', cell: r => esc(r.title) },
        { label: 'Vendor', cell: r => esc(vendor(r.vendorId).name) },
        { label: 'Receivable outstanding', cell: r => fmtQty(
            r.receivableItems.reduce((s, l) => s + receivableOutstanding(r.id, l.line), 0)), align: 'right' },
        /* A deal that never issued anything has no balance — printing a green
           0.000 made it look reconciled, the same complaint as the detail card
           one level up. */
        { label: 'Issue balance', cell: r => {
            const rows = issueBalance(r.id);
            if (!rows.length) return '<span class="dim">—</span>';
            const t = rows.reduce((s, b) => s + Math.abs(b.balance), 0);
            return '<span class="' + (t > 0.001 ? 'bal-open' : 'bal-zero') + '">' + fmtQty(t) + '</span>'; }, align: 'right' },
        { label: 'Full receipt', cell: r => r.fullReceipt ? sbStatus('Confirmed') : '<span class="dim">Not yet</span>' },
        { label: 'Status', cell: r => sbStatus(r.status) }
      ],
      rows: active,
      onRow: r => 'openReconciliation(\'' + r.id + '\')',
      empty: 'No approved request has reached reconciliation.'
    });
}

function openReconciliation(id) { recSelected = id; renderPage(); }
function backToReconciliation() { recSelected = null; renderPage(); }

function buildReconciliationDetail(r) {
  const blockers = reconciliationBlockers(r.id);
  const challans = challanStore.filter(c => c.scrId === r.id);
  const openCh = challans.filter(c => c.status !== 'Closed');

  let actions = '<button class="btn-outline" onclick="backToReconciliation()">Back</button>';
  if (!r.fullReceipt)
    actions += actionBtn('Confirm full receipt', 'confirmFullReceiptAction(\'' + r.id + '\')',
      canDo('confirm-full-receipt') && !blockers.length,
      blockers.length ? 'Material is still unaccounted for.' : 'Only Finance can confirm full receipt.', 'btn-primary');
  else if (openCh.length)
    actions += actionBtn('Close challan', 'closeChallanAction(\'' + openCh[0].id + '\')',
      canDo('close-challan'), 'Only Finance can close a challan.', 'btn-primary');
  /* A request short-closed before anything shipped has no challan to close, and
     closeChallan was the only writer of a Closed status — so it sat at Approved
     forever while this screen said "the challan can be closed". */
  else if (r.status !== 'Closed')
    actions += actionBtn('Close request', 'closeDealAction(\'' + r.id + '\')',
      canDo('close-challan'), 'Only Finance can close a request.', 'btn-primary');

  return buildPageHead('Reconciliation · ' + r.id, esc(r.title) + ' · ' + esc(vendor(r.vendorId).name), actions) +
    buildNextStep(r.id) +
    buildStageBar(journeyIndex(r.id)) +
    (blockers.length
      ? buildErrors(blockers)
      : (r.status === 'Closed'
          ? buildNotice('<b>Closed.</b> Every obligation against this request has been resolved.', 'ok')
          : buildNotice('Everything is accounted for. ' +
              (!r.fullReceipt ? 'Full receipt can now be confirmed.'
                : openCh.length ? 'Full receipt is confirmed — the challan can be closed.'
                : 'Full receipt is confirmed. Nothing shipped against this request, so it closes directly.'), 'ok'))) +
    '<div class="split"><div>' +
      buildCard('Receivable reconciliation', scrLineTable(r, 'receivable')) +
      buildBalanceSheet(r.id) +
      buildCard('Short-close', buildShortCloseTable(r)) +
      buildCard('Challans', challans.length
        ? '<div class="lines-wrap"><table class="lines"><thead><tr>' +
          '<th>Challan</th><th>Shipment</th><th>Gate outward</th><th class="ta-right">Outstanding</th><th>Status</th>' +
          '</tr></thead><tbody>' + challans.map(c =>
            '<tr><td><b class="mono">' + esc(c.id) + '</b></td><td class="mono">' + esc(c.shipmentId) + '</td>' +
            '<td>' + esc(c.gateOutAt || '—') + '</td>' +
            '<td class="ta-right">' + fmtQty(challanOutstanding(c.id)) + '</td>' +
            '<td>' + sbStatus(c.status) + '</td></tr>').join('') + '</tbody></table></div>'
        : '<div class="lst-empty">No challan has been raised.</div>') +
    '</div><div>' + buildActivityPanelHTML(r.id) + '</div></div>';
}

function buildShortCloseTable(r) {
  const rows = r.receivableItems.filter(l => receivableOutstanding(r.id, l.line) > 0.001 || l.shortClosed || l.shortClosePending);
  if (!rows.length) return '<div class="lst-empty">Nothing outstanding to short-close.</div>';
  const el = shortCloseEligibility(r.id);
  const live = !el.ok;
  return (live ? buildNotice(el.error, 'wait') : '') +
    '<div class="lines-wrap"><table class="lines"><thead><tr>' +
    '<th>#</th><th>Item</th><th class="ta-right">Outstanding</th><th>State</th><th></th>' +
    '</tr></thead><tbody>' + rows.map(l => {
      const out = receivableOutstanding(r.id, l.line);
      let state = '<span class="dim">Open</span>', act = '';
      if (l.shortClosed) state = sbStatus('Short-Closed');
      else if (l.shortClosePending) {
        state = sbStatus('In Progress', 'Awaiting buyer');
        act = actionBtn('Confirm', 'confirmShortCloseAction(\'' + r.id + '\',' + l.line + ')',
          canDo('confirm-short-close'), 'Only a Buyer can confirm a short-close.', 'btn-primary btn-sm');
      } else {
        act = actionBtn('Short-close', 'initiateShortCloseAction(\'' + r.id + '\',' + l.line + ')',
          canDo('initiate-short-close') && !live,
          live ? el.error : 'Only a Planner can initiate a short-close.', 'btn-outline btn-sm');
      }
      return '<tr><td class="mono">' + l.line + '</td><td>' + esc(product(l.productId).name) + '</td>' +
        '<td class="ta-right">' + fmtQty(out) + ' ' + esc(l.uom) + '</td>' +
        '<td>' + state + (l.shortCloseReason ? '<div class="dim">' + esc(l.shortCloseReason) + '</div>' : '') + '</td>' +
        '<td class="ta-right">' + act + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}

function confirmFullReceiptAction(id) {
  const res = confirmFullReceipt(id);
  if (!res.ok) { toast('Still blocked — see the list above.', 'bad'); renderPage(); return; }
  toast('Full receipt confirmed. The challan can now be closed.');
  renderPage();
}
function closeDealAction(id) {
  openConfirm('Close request',
    'Nothing shipped against this request, so there is no challan to close. Closing settles the request and its order. Continue?',
    'Close request', () => {
      const res = closeDealDirect(id);
      if (!res.ok) { toast(res.errors[0], 'bad'); renderPage(); return; }
      toast('Request closed.');
      renderPage();
    });
}

function closeChallanAction(cid) {
  openConfirm('Close challan',
    'Closing cascades to the shipment, and to the request and order once no shipment remains open. Continue?',
    'Close challan', () => {
      const res = closeChallan(cid);
      if (!res.ok) { toast('Closure is blocked.', 'bad'); renderPage(); return; }
      toast('Challan closed.');
      renderPage();
    });
}
function initiateShortCloseAction(scrId, line) {
  openReasonModal('RC-SHORT', 'Initiate short-close', (reason, remarks) => {
    const res = initiateShortClose(scrId, line, reason, remarks);
    if (!res.ok) { toast(res.error, 'bad'); return; }
    toast('Short-close raised. It now needs a buyer to confirm it.');
    renderPage();
  });
}
function confirmShortCloseAction(scrId, line) {
  openConfirm('Confirm short-close',
    'The outstanding quantity stops being treated as pending. Quantity already received is untouched. Continue?',
    'Confirm', () => {
      const res = confirmShortClose(scrId, line);
      if (!res.ok) { toast(res.error, 'bad'); return; }
      toast('Short-close confirmed.');
      renderPage();
    });
}

registerPage('inward', buildInwardPage);
registerPage('reconciliation', buildReconciliationPage);

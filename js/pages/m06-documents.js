/* ==========================================================================
   M-06  DELIVERY NOTE, CHALLAN AND GATE OUTWARD   (US8, US9, US10)

   The paperwork that authorises material to leave the premises, and the
   moment the return clock starts.

   THE DOCUMENT VIEWS ARE BUILT TO THE BRD'S OWN MOCKUPS — DN-000871 and
   Challan CHN-33-000442, down to the "Job work — not a sale" value basis,
   which is the whole legal point: ownership never transfers.
   ========================================================================== */

let dnSelected = null;
let chSelected = null;
let gateSelected = null;

/* One definition per queue, shared with the dashboard tiles — see the note in
   m05-outbound.js for why a tile must never re-derive its own predicate. */
function dnoteEligible() {
  return shipmentStore.filter(s =>
    s.status === 'Freezed Outbound Release' && !dnoteForShipment(s.id) && !isReturned(s) &&
    (!scr(s.scrId).logistics || s.logistics));
}
function challanEligible() {
  return dnoteStore.filter(d => d.status === 'Approved' && !challanForShipment(d.shipmentId));
}
function gateQueue() { return challanStore.filter(c => c.status === 'Created' && !isReturned(c)); }
function gateHeld()  { return challanStore.filter(c => c.status === 'Created' && isReturned(c)); }

/* ── Delivery notes ─────────────────────────────────────────────────────── */
function buildDnotePage() {
  if (dnSelected && dnote(dnSelected)) return buildDnoteDetail(dnote(dnSelected));

  const eligible = dnoteEligible();
  const returned = returnedDnotes();

  /* F14 · The page used to show only notes that already existed, with a header
     button naming one arbitrary shipment. The work WAITING to be done appeared
     nowhere, so Stores could neither see the queue nor choose from it. */
  const waiting = eligible.length ? buildCard('Shipments waiting for a note',
    '<div class="lines-wrap"><table class="lines"><thead><tr>' +
    '<th>Shipment</th><th>Request</th><th>Vendor</th><th class="ta-right">Quantity</th><th>Logistics</th><th></th>' +
    '</tr></thead><tbody>' + eligible.map(s =>
      '<tr><td><b class="mono">' + esc(s.id) + '</b></td>' +
      '<td>' + refLink(s.scrId) + '</td>' +
      '<td>' + esc(vendor(s.vendorId).name) + '</td>' +
      '<td class="ta-right">' + fmtQty(s.lines.reduce((x, l) => x + Number(l.qty), 0)) + '</td>' +
      '<td>' + (scr(s.scrId).logistics ? (s.logistics ? esc(s.logistics.mode) : '<span class="dim">pending</span>')
                                       : '<span class="dim">not required</span>') + '</td>' +
      '<td class="ta-right">' + actionBtn('Generate', 'generateDnoteAction(\'' + s.id + '\')',
        canDo('generate-dnote'), 'Only Stores or Logistics can generate a Delivery Note.', 'btn-primary btn-sm') +
      '</td></tr>').join('') + '</tbody></table></div>') : '';

  return buildPageHead('Delivery Notes',
      'Generated from an outbound shipment and approved before a Challan can be raised. A returned note blocks everything downstream until it is corrected.') +
    (returned.length ? buildNotice('<b>' + returned.length + ' note' + (returned.length > 1 ? 's were' : ' was') +
      ' returned for correction.</b> ' + returned.map(d => esc(d.id) + ' — ' + esc(d.reason)).join('; ') +
      '. Correct and resubmit rather than raising a new one.', 'wait') : '') +
    waiting +
    buildListing({
      filters: [{ label: 'Status', options: ['Generated', 'Approved', 'Returned', 'Voided'] }],
      stats: [
        { label: 'All', count: dnoteStore.length, onClick: 'clearFilters()' },
        { label: 'Awaiting approval', count: dnoteStore.filter(d => d.status === 'Generated').length, filter: ['Status', 'Generated'] },
        { label: 'Approved', count: dnoteStore.filter(d => d.status === 'Approved').length, filter: ['Status', 'Approved'] },
        { label: 'Returned', count: returned.length, filter: ['Status', 'Returned'] }
      ],
      columns: [
        { label: 'Delivery Note', cell: d => '<b>' + esc(d.id) + '</b>' },
        { label: 'Shipment', cell: d => '<span class="mono">' + esc(d.shipmentId) + '</span>' },
        { label: 'Request', cell: d => '<span class="mono">' + esc(d.scrId) + '</span>' },
        { label: 'Vendor', cell: d => esc(vendor(shipment(d.shipmentId).vendorId).name) },
        { label: 'Generated', cell: d => esc(d.generatedOn) },
        { label: 'Status', cell: d => sbStatus(d.status) }
      ],
      rows: dnoteStore.filter(d => passesFilter('Status', d.status)),
      onRow: d => 'openDnote(\'' + d.id + '\')',
      empty: 'No delivery notes yet.'
    });
}

function openDnote(id) { dnSelected = id; renderPage(); }
function backToDnotes() { dnSelected = null; renderPage(); }

function buildDnoteDetail(d) {
  const s = shipment(d.shipmentId);
  const r = scr(d.scrId);
  const v = vendor(s.vendorId);
  const may = canDo('approve-dnote') && d.status === 'Generated';
  const shipmentReady = s.status === 'Freezed Outbound Release';

  let actions = '<button class="btn-outline" onclick="backToDnotes()">Back</button>' +
    '<button class="btn-outline" onclick="window.print()">Print</button>';
  if (d.status === 'Generated') {
    actions += actionBtn('Return', 'returnDnoteAction(\'' + d.id + '\')', may,
      "Only the Delivery Note approver can return it.");
    actions += actionBtn('Approve', 'approveDnoteAction(\'' + d.id + '\')', may && shipmentReady,
      !shipmentReady ? 'Approval is blocked unless the shipment is at Freezed Outbound Release.'
                     : "Only the Delivery Note approver can approve it.", 'btn-primary');
  }
  /* A returned note used to offer nothing but Back, leaving the material out of
     the store with no route forward for anyone. */
  if (d.status === 'Returned') {
    actions += actionBtn('Correct and resubmit', 'reissueDnoteAction(\'' + d.id + '\')',
      canDo('generate-dnote'), 'Only Stores or Logistics can correct a Delivery Note.', 'btn-primary');
  }

  return buildPageHead(d.id, 'Shipment ' + esc(d.shipmentId) + ' · ' + esc(v.name), actions) +
    buildNextStep(d.scrId) +
    (d.status === 'Returned' ? buildNotice('<b>Returned.</b> ' + esc(d.reason) +
      (d.remarks ? ' — ' + esc(d.remarks) : '') + ' Challan generation stays blocked.', 'wait') : '') +
    (d.status === 'Voided' ? buildNotice('<b>Voided.</b> The shipment was cancelled, so this note is no longer valid.', 'idle') : '') +
    '<div class="split"><div>' + buildDnoteDocument(d, s, r, v) + '</div><div>' +
      buildActivityPanelHTML(d.id) + '</div></div>';
}

/* Built to the BRD mockup. */
function buildDnoteDocument(d, s, r, v) {
  return '<div class="doc">' +
    '<div class="doc-title">DELIVERY NOTE &middot; ' + esc(d.id) + '</div>' +
    '<div class="doc-sub">' + esc(plant(s.plantId).name) + ' &rarr; ' + esc(v.name) + ', ' + esc(v.city) +
      ' &middot; ' + esc(d.generatedOn) + ' &middot; Shipment ' + esc(s.id) +
      ' &middot; SCR ' + esc(r.id) + ' &middot; PO ' + esc(s.poId) + '</div>' +
    '<table class="doc-table" style="margin-top:20px"><thead><tr>' +
      '<th>Item</th><th class="ta-right">Qty</th><th>UOM</th><th>Lot</th>' +
    '</tr></thead><tbody>' + s.lines.map(l => {
      const il = r.issueItems.find(x => x.line === l.line) || {};
      const res = reservationsFor(s.id).find(x => x.productId === il.productId) || {};
      const lots = (res.allocatedLots || []).map(x => x.lot).filter(Boolean).join(', ');
      return '<tr><td>' + esc(product(il.productId).name) + '</td>' +
        '<td class="ta-right">' + fmtQty(l.qty) + '</td><td>' + esc(il.uom) + '</td>' +
        '<td class="mono">' + (lots ? esc(lots) : '&mdash;') + '</td></tr>';
    }).join('') + '</tbody></table>' +
    (s.logistics ? '<div class="doc-sec">Dispatch</div>' + buildFieldGrid([
      ['Mode', esc(s.logistics.mode)],
      ['Transporter', esc(s.logistics.transporter)],
      ['Vehicle', '<span class="mono">' + esc(s.logistics.vehicleNo || '—') + '</span>'],
      ['Driver', esc(s.logistics.driver)],
      ['Packages', esc(s.logistics.pkgType + ' × ' + s.logistics.packages)],
      ['LR reference', esc(s.logistics.lrNo)]
    ], 3) : '') +
    '<div class="doc-foot"><span>Status: ' + esc(d.status) + '</span>' +
      '<span>Material remains the property of ' + esc(plant(s.plantId).name) + '.</span></div>' +
  '</div>';
}

function generateDnoteAction(sid) {
  const res = generateDnote(sid);
  if (!res.ok) { toast(res.error, 'bad'); return; }
  toast('Delivery Note ' + res.dnote.id + ' generated.');
  dnSelected = res.dnote.id;
  renderPage();
}
function approveDnoteAction(id) {
  const res = approveDnote(id);
  if (!res.ok) { toast(res.error, 'bad'); return; }
  toast('Approved. A Challan can now be generated.');
  renderPage();
}
function returnDnoteAction(id) {
  openReasonModal('RC-DNRET', 'Return delivery note', (reason, remarks) => {
    const res = returnDnote(id, reason, remarks);
    if (!res.ok) { toast(res.error, 'bad'); return; }
    notify('dnote-returned', 'Delivery Note ' + id + ' returned', reason, id);
    toast('Returned for correction. Stores can correct and resubmit it.');
    renderPage();
  });
}
function reissueDnoteAction(id) {
  const res = reissueDnote(id);
  if (!res.ok) { toast(res.error, 'bad'); return; }
  toast('Corrected and sent back for approval.');
  renderPage();
}

/* ── Challans ───────────────────────────────────────────────────────────── */
function buildChallanPage() {
  if (chSelected && challan(chSelected)) return buildChallanDetail(challan(chSelected));
  refreshReturnWindows();

  const ready = challanEligible();

  /* The page used to show only challans that already existed, with a header
     button naming one arbitrary note — the same pattern that was rejected for
     Delivery Notes. Any second eligible note appeared in no queue at all. */
  const waiting = ready.length ? buildCard('Notes waiting for a challan',
    '<div class="lines-wrap"><table class="lines"><thead><tr>' +
    '<th>Delivery Note</th><th>Shipment</th><th>Request</th><th>Vendor</th><th>Approved</th><th></th>' +
    '</tr></thead><tbody>' + ready.map(d => {
      const s = shipment(d.shipmentId);
      return '<tr><td><b class="mono">' + esc(d.id) + '</b></td>' +
        '<td class="mono">' + esc(d.shipmentId) + '</td>' +
        '<td>' + refLink(d.scrId) + '</td>' +
        '<td>' + esc(vendor(s.vendorId).name) + '</td>' +
        '<td>' + esc(d.generatedOn) + '</td>' +
        '<td class="ta-right">' + actionBtn('Generate challan', 'generateChallanAction(\'' + d.id + '\')',
          canDo('generate-challan'), 'Only Finance can generate a Challan.', 'btn-primary btn-sm') +
        '</td></tr>';
    }).join('') + '</tbody></table></div>') : '';

  return buildPageHead('Challans',
      'The Challan authorises organisation-owned material to leave the premises. It stays linked to the request, order, shipment and delivery note until the material is fully accounted for.') +
    waiting +
    buildListing({
      filters: [{ label: 'Status', options: ['Created', 'Gate Cleared', 'Overdue', 'Closed'] }],
      stats: [
        { label: 'All', count: challanStore.length, onClick: 'clearFilters()' },
        { label: 'Awaiting gate', count: challanStore.filter(c => c.status === 'Created').length, filter: ['Status', 'Created'] },
        { label: 'Material out', count: challanStore.filter(c => c.status === 'Gate Cleared').length, filter: ['Status', 'Gate Cleared'] },
        { label: 'Overdue', count: challanStore.filter(c => c.status === 'Overdue').length, filter: ['Status', 'Overdue'] },
        { label: 'Closed', count: challanStore.filter(c => c.status === 'Closed').length, filter: ['Status', 'Closed'] }
      ],
      columns: [
        { label: 'Challan', cell: c => '<b>' + esc(c.id) + '</b>' },
        { label: 'Shipment', cell: c => '<span class="mono">' + esc(c.shipmentId) + '</span>' },
        { label: 'Vendor', cell: c => esc(vendor(c.vendorId).name) },
        { label: 'Gate outward', cell: c => c.gateOutAt ? esc(c.gateOutAt) : '<span class="dim">Not yet</span>' },
        { label: 'Return by', cell: c => c.returnByDate ? esc(c.returnByDate) : '<span class="dim">—</span>' },
        { label: 'Days left', cell: c => challanDaysCell(c), align: 'right' },
        { label: 'Outstanding', cell: c => fmtQty(challanOutstanding(c.id)), align: 'right' },
        { label: 'Status', cell: c => sbStatus(c.status) }
      ],
      rows: challanStore.filter(c => passesFilter('Status', c.status)),
      onRow: c => 'openChallan(\'' + c.id + '\')',
      empty: 'No challans yet.'
    });
}

/* The return window, rendered. Amber only inside the warning threshold, red
   only once it has actually expired — a challan with three weeks left is not
   a problem and must not look like one. */
function challanDaysCell(c) {
  if (!c.gateOutIso || c.status === 'Closed') return '<span class="dim">—</span>';
  const left = daysRemaining(c);
  const cls = left < 0 ? 'vp-days-over' : (left <= subConParams.returnWarnDays ? 'vp-days-warn' : '');
  /* "38 over" was terse to the point of cryptic. Words cost nothing. */
  return '<span class="vp-days ' + cls + '">' +
    (left < 0 ? Math.abs(left) + ' days overdue' : left + ' days left') + '</span>';
}

function openChallan(id) { chSelected = id; renderPage(); }
function backToChallans() { chSelected = null; renderPage(); }

function buildChallanDetail(c) {
  const s = shipment(c.shipmentId);
  const r = scr(c.scrId);
  const v = vendor(c.vendorId);
  const asn = latestAsn(c.id);
  const left = daysRemaining(c);

  let actions = '<button class="btn-outline" onclick="backToChallans()">Back</button>' +
    '<button class="btn-outline" onclick="window.print()">Print</button>';
  /* Resolve on the challan itself. It used to live only on the Gate page,
     which Finance — the role challans are returned to — cannot open. */
  if (isReturned(c))
    actions += actionBtn('Resolve correction', 'resolveChallanAction(\'' + c.id + '\')',
      currentPosition() === c.returnedTo || currentPosition() === 'idt' || currentPosition() === 'pmg-admin',
      'This was returned to ' + positionLabel(c.returnedTo) + ', who resolves it.', 'btn-primary');
  if (c.status === 'Created' && !isReturned(c))
    actions += actionBtn('Return', 'returnChallanAction(\'' + c.id + '\')', canDo('return-challan'),
      'Only Finance can return a challan.');

  return buildPageHead(c.id, 'Shipment ' + esc(c.shipmentId) + ' · ' + esc(v.name), actions) +
    buildNextStep(c.scrId) +
    (isReturned(c) ? buildNotice('<b>Returned for correction.</b> ' + esc(c.returnReason) +
      (c.returnRemarks ? ' — ' + esc(c.returnRemarks) : '') +
      ' Gate outward stays blocked until the ' + esc(positionLabel(c.returnedTo)) + ' resolves it.', 'wait') : '') +
    /* Matches the dashboard: a passed return window with material still out is
       not a wait state. This instance was left amber when the other changed. */
    (c.status === 'Overdue' ? buildNotice('<b>Overdue.</b> The return window closed on ' + esc(c.returnByDate) +
      ' and ' + fmtQty(challanOutstanding(c.id)) + ' is still outstanding.', 'bad') : '') +
    (c.status === 'Gate Cleared' && left != null && left <= subConParams.returnWarnDays && left >= 0
      ? buildNotice('The return window closes in <b>' + left + ' days</b> (' + esc(c.returnByDate) + ').', 'wait') : '') +
    (asn ? buildNotice('<b>Vendor notice.</b> ' + esc(vendor(asn.vendorId).name) + ' expects to return ' +
      fmtQty(asn.qty) + ' on ' + esc(fmtDate(asn.expectedDate)) +
      (asn.vehicle ? ' · vehicle ' + esc(asn.vehicle) : '') + '.', 'info')
      : (c.status !== 'Created' && c.status !== 'Closed'
         ? buildNotice('No advance notice has been raised by the vendor. This is not a problem — an ASN is optional.', 'idle') : '')) +
    '<div class="split"><div>' + buildChallanDocument(c, s, r, v) + '</div><div>' +
      buildActivityPanelHTML(c.id) + '</div></div>';
}

/* Built to the BRD mockup, including the value basis that makes it a job-work
   challan rather than an invoice. */
function buildChallanDocument(c, s, r, v) {
  const p = plant(s.plantId);
  let total = 0;
  const rows = s.lines.map(l => {
    const il = r.issueItems.find(x => x.line === l.line) || {};
    const pr = product(il.productId);
    const val = +(pr.cost * l.qty).toFixed(2);
    total += val;
    return '<tr><td>' + esc(pr.name) + '</td><td class="mono">' + esc(pr.hsn) + '</td>' +
      '<td class="ta-right">' + fmtQty(l.qty) + '</td><td>' + esc(il.uom) + '</td>' +
      '<td class="ta-right">' + fmtMoney(val) + '</td>' +
      '<td class="dim">Job work &mdash; not a sale</td></tr>';
  }).join('');

  return '<div class="doc">' +
    '<div class="doc-title">JOB WORK CHALLAN &middot; ' + esc(c.id) + '</div>' +
    '<div class="doc-sub">Challan Date ' + esc(c.generatedOn) + ' &middot; D\'Note ' + esc(c.dnId) +
      ' &middot; Shipment ' + esc(c.shipmentId) + ' &middot; SCR ' + esc(c.scrId) + '</div>' +
    '<div class="doc-sec">Parties</div>' +
    '<div class="doc-parties">' +
      '<div class="doc-party"><div class="doc-party-cap">Despatching Unit</div>' +
        '<div class="doc-party-body">' + esc(p.name) + ' &middot; GSTIN ' + esc(p.gstin) + '</div></div>' +
      '<div class="doc-party"><div class="doc-party-cap">Consignee</div>' +
        '<div class="doc-party-body">' + esc(v.name) + ', ' + esc(v.city) +
          ' &middot; GSTIN ' + esc(v.gstin) + '</div></div>' +
    '</div>' +
    '<table class="doc-table" style="margin-top:18px"><thead><tr>' +
      '<th>Item</th><th>HSN</th><th class="ta-right">Qty</th><th>UOM</th>' +
      '<th class="ta-right">Applicable value</th><th>Value basis</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>' +
    /* What ACTUALLY left, where it differs from what was planned. Recording a
       substitute vehicle and then printing the original would make the
       document disagree with the gate register. */
    (c.actualVehicle || (c.actualPackages !== '' && c.actualPackages != null) ? '<div class="doc-sec">Recorded at gate</div>' +
      buildFieldGrid([
        ['Vehicle', esc(c.actualVehicle || '—') +
          (c.vehicleReason ? ' <span class="chip">' + esc(c.vehicleReason) + '</span>' : '')],
        ['Packages', esc(String(c.actualPackages)) +
          (c.packageReason ? ' <span class="chip">' + esc(c.packageReason) + '</span>' : '')],
        ['Cleared', esc(c.gateOutAt || '—')]
      ], 3) : '') +
    '<div class="doc-foot">' +
      '<span>Total declared value ' + fmtMoney(total) + ' &middot; for movement purposes only</span>' +
      '<span>' + (c.gateOutAt ? 'Gate outward ' + esc(c.gateOutAt) : 'Awaiting gate outward') + '</span>' +
    '</div></div>';
}

function generateChallanAction(dnId) {
  const res = generateChallan(dnId);
  if (!res.ok) { toast(res.error, 'bad'); return; }
  toast('Challan ' + res.challan.id + ' generated. Now with Security.');
  chSelected = res.challan.id;
  renderPage();
}
function returnChallanAction(id) {
  openReasonModal('RC-CHRET', 'Return challan', (reason, remarks) => {
    returnStage(challan(id), 'finance', reason, remarks, 'Returned for correction');
    toast('Returned for correction. Gate outward is now blocked.');
    renderPage();
  });
}
function resolveChallanAction(id) {
  const res = resolveStage(challan(id), 'Correction completed');
  if (!res.ok) { toast(res.error, 'bad'); return; }
  toast('Correction recorded. The challan is back with security.');
  renderPage();
}

/* ── Gate outward ───────────────────────────────────────────────────────── */
function buildGatePage() {
  if (gateSelected && challan(gateSelected)) return buildGateDetail(challan(gateSelected));
  const queue = gateQueue();
  const held = gateHeld();
  const cleared = challanStore.filter(c => c.gateOutAt);

  return buildPageHead('Gate Outward',
      'Security verifies the documents, material, packages and vehicle, then records the actual date and time. This is what starts the return window — generating the challan does not.') +
    (held.length ? buildNotice('<b>' + held.length + ' challan' + (held.length > 1 ? 's are' : ' is') +
      ' returned for correction</b> and held out of the gate queue: ' +
      held.map(c => esc(c.id) + ' — ' + esc(c.returnReason)).join('; ') + '.', 'wait') : '') +
    buildListing({
      stats: [
        { label: 'To verify', count: queue.length },
        { label: 'Held', count: held.length },
        { label: 'Cleared', count: cleared.length }
      ],
      columns: [
        { label: 'Challan', cell: c => '<b>' + esc(c.id) + '</b>' },
        { label: 'Delivery Note', cell: c => '<span class="mono">' + esc(c.dnId) + '</span>' },
        { label: 'Vendor', cell: c => esc(vendor(c.vendorId).name) },
        { label: 'Vehicle', cell: c => { const s = shipment(c.shipmentId);
            return s.logistics ? '<span class="mono">' + esc(s.logistics.vehicleNo || '—') + '</span>' : '<span class="dim">—</span>'; } },
        { label: 'Packages', cell: c => { const s = shipment(c.shipmentId);
            return s.logistics ? esc(String(s.logistics.packages)) : '<span class="dim">—</span>'; }, align: 'center' },
        { label: 'Gate outward', cell: c => c.gateOutAt ? esc(c.gateOutAt) : '<span class="dim">Pending</span>' },
        { label: 'Status', cell: c => isReturned(c)
            ? sbStatus('Returned') + '<div class="dim">' + esc(c.returnReason) + '</div>'
            : sbStatus(c.status) },
        { label: '', align: 'right', cell: c => isReturned(c)
            ? (canDo('generate-challan')
                ? '<button class="btn-primary btn-sm" onclick="event.stopPropagation();resolveChallanAction(\'' + c.id + '\')">Resolve</button>'
                : '<span class="dim">With finance</span>')
            : (c.status === 'Created' && canDo('verify-gate')
                ? '<button class="btn-outline btn-sm" onclick="event.stopPropagation();openGate(\'' + c.id + '\')">Verify</button>' : '') }
      ],
      rows: queue.concat(held).concat(cleared),
      empty: 'Nothing is waiting at the gate.'
    });
}

function openGate(id) { gateSelected = id; renderPage(); }
function backToGate()  { gateSelected = null; renderPage(); }

function buildGateDetail(c) {
  const s = shipment(c.shipmentId);
  const r = scr(c.scrId);
  const v = vendor(c.vendorId);
  const g = s.logistics || {};
  const d = dnote(c.dnId);

  return buildPageHead('Gate verification · ' + c.id,
      'Verify before recording. Once recorded, the return window opens and cannot be reset.',
      '<button class="btn-outline" onclick="backToGate()">Back</button>' +
      actionBtn('Return', 'returnGateAction(\'' + c.id + '\')', canDo('return-security'),
        'Only Security can return at the gate.') +
      actionBtn('Record gate outward', 'recordGateAction(\'' + c.id + '\')', canDo('record-gate-outward'),
        'Only Security can record gate outward.', 'btn-primary')) +
    buildCard('Documents', buildFieldGrid([
      ['Challan', '<span class="mono">' + esc(c.id) + '</span> ' + sbStatus(c.status)],
      ['Delivery Note', '<span class="mono">' + esc(c.dnId) + '</span> ' + sbStatus(d.status)],
      ['Shipment', '<span class="mono">' + esc(c.shipmentId) + '</span>'],
      ['Request', '<span class="mono">' + esc(c.scrId) + '</span>'],
      ['Vendor', esc(v.name) + ', ' + esc(v.city)],
      ['Destination GSTIN', '<span class="mono">' + esc(v.gstin) + '</span>']
    ], 3)) +
    buildCard('Material', '<div class="lines-wrap"><table class="lines"><thead><tr>' +
      '<th>#</th><th>Product</th><th class="ta-right">Quantity</th><th>UOM</th></tr></thead><tbody>' +
      s.lines.map(l => { const il = r.issueItems.find(x => x.line === l.line) || {};
        return '<tr><td class="mono">' + l.line + '</td><td>' + esc(product(il.productId).name) + '</td>' +
          '<td class="ta-right">' + fmtQty(l.qty) + '</td><td>' + esc(il.uom) + '</td></tr>'; }).join('') +
      '</tbody></table></div>') +
    /* With Logistics = No there is no dispatch record, so there is nothing to
       verify against. The form used to default packages to 0 and store it,
       putting "Security counted zero packages out" on a legal document as a
       positive assertion. */
    (s.logistics
      ? buildCard('Vehicle and packages',
        '<div class="form-grid">' +
          fField('Vehicle on document', '<input class="inp" value="' + attrSafe(g.vehicleNo || '—') + '" disabled>') +
          fField('Actual vehicle', fText('gt-vehicle', g.vehicleNo, 'As presented at the gate'), false,
            'Differs from the document? A reason is captured before the gate can be recorded.') +
          fField('Packages on document', '<input class="inp" value="' + attrSafe(g.packages || 0) + '" disabled>') +
          fField('Actual packages', fNum('gt-packages', g.packages || 0, '0', '1'), false,
            'A count that differs needs a package-difference reason.') +
        '</div>')
      : buildNotice('This request has Logistics = No, so no vehicle or package details were recorded on dispatch. ' +
          'There is nothing to verify against and nothing will be asserted on the challan.', 'idle'));
}

/* Differences are captured BEFORE the gate is recorded (US10/AC4) — asking
   afterwards would mean recording something known to be wrong. */
function recordGateAction(cid) {
  const c = challan(cid);
  const s = shipment(c.shipmentId);
  const g = s.logistics || {};
  const hasLog = !!s.logistics;
  const veh = hasLog ? inputValue('gt-vehicle') : '';
  const pkg = hasLog ? numValue('gt-packages') : '';
  const vehChanged = hasLog && g.vehicleNo && veh && veh !== g.vehicleNo;
  const pkgChanged = hasLog && g.packages != null && pkg !== Number(g.packages);

  /* The actuals are PERSISTED, not just used to decide whether to prompt.
     Previously Security typed a substitute registration, was made to give a
     reason, and both facts were discarded — the challan still printed the
     original vehicle and the audit trail never learned a different lorry left. */
  const base = { actualVehicle: veh, actualPackages: pkg };
  const finish = detail => {
    const res = recordGateOutward(cid, Object.assign({}, base, detail));
    if (!res.ok) { toast(res.error, 'bad'); return; }
    toast('Gate outward recorded. Return by ' + challan(cid).returnByDate + '.');
    gateSelected = null;
    renderPage();
  };

  if (vehChanged) {
    openReasonModal('RC-GATEVEH', 'Vehicle changed', (reason, remarks) => {
      if (pkgChanged) {
        openReasonModal('RC-GATEPKG', 'Package difference', (r2, m2) =>
          finish({ vehicleReason: reason + (remarks ? ' — ' + remarks : ''),
                   packageReason: r2 + (m2 ? ' — ' + m2 : '') }));
      } else finish({ vehicleReason: reason + (remarks ? ' — ' + remarks : '') });
    });
    return;
  }
  if (pkgChanged) {
    openReasonModal('RC-GATEPKG', 'Package difference', (reason, remarks) =>
      finish({ packageReason: reason + (remarks ? ' — ' + remarks : '') }));
    return;
  }
  openConfirm('Record gate outward',
    'This starts the return window and cannot be undone. Continue?', 'Record', () => finish({}));
}

function returnGateAction(cid) {
  openReasonModal('RC-SECRET', 'Return at gate', (reason, remarks) => {
    returnStage(challan(cid), 'finance', reason, remarks, 'Returned by security');
    toast('Returned to finance. Gate outward is now blocked until it is resolved.');
    gateSelected = null;
    renderPage();
  });
}

registerPage('delivery-notes', buildDnotePage);
registerPage('challans', buildChallanPage);
registerPage('gate', buildGatePage);

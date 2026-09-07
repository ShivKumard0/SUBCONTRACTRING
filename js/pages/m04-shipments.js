/* ==========================================================================
   M-04  SHIPMENT, RESERVATION AND LOT ALLOCATION   (US5, US16, US15)

   Reservation is a CLAIM, not a movement — see ledger.js.  This module is the
   screens over that idea, plus the two ways a shipment can end: it is issued,
   or it is cancelled and the ledger is put back exactly as it was.

   DIRECTION IS THE INTER-UNIT RETURN.  An Outward shipment draws its lines
   from Issue Items; a Return shipment draws them from Receivable Items.
   Everything downstream runs unchanged on either.
   ========================================================================== */

let shipView = 'list';
let shipSelected = null;
let shipErrors = [];

function openShipDetail(id) { shipSelected = id; shipView = 'detail'; shipErrors = []; renderPage(); }
function backToShipList()   { shipView = 'list'; shipErrors = []; renderPage(); }

/* ── Listing ────────────────────────────────────────────────────────────── */
function buildShipListing() {
  const all = shipmentStore;
  /* "Returned" is a STAGE, not a shipment status — the record still reads
     Created — so the filter has to ask the stage question too, or the tile
     that sets it would find nothing. */
  const rows = orderForJourney(all.filter(s =>
    (filterValue('Status') === 'Returned' ? isReturned(s) : passesFilter('Status', s.status)) &&
    passesFilter('Direction', s.direction) &&
    passesFilter('Vendor', vendor(s.vendorId).name)));

  const eligible = scrStore.filter(r => {
    const p = poForScr(r.id);
    return p && p.status === 'Approved' && r.status === 'Approved' &&
           r.issueItems.some(l => openIssueQty(r.id, l.line) > 0.001);
  });

  return buildPageHead('Shipments',
      'Material is reserved as the shipment is created — a claim against stock, not a movement. One request may ship in parts, and the cumulative quantity can never exceed the open issue quantity.',
      actionBtn('Create Shipment', 'openShipmentCreate()',
        canAdd('shipments') && canDo('create-shipment') && eligible.length > 0,
        eligible.length ? 'Only a Planner can create a shipment.' : 'No approved request has open issue quantity.',
        'btn-primary')) +
    buildListing({
      filters: [
        { label: 'Status', options: ['Created', 'Returned', 'Freezed Outbound Release', 'Challan Generated', 'Gate Cleared', 'Cancelled', 'Closed'] },
        { label: 'Direction', options: ['Outward', 'Return'] },
        { label: 'Vendor', options: vendorMaster.map(v => v.name) }
      ],
      stats: [
        { label: 'All', count: all.length, onClick: 'clearFilters()' },
        { label: 'Returned to you', count: returnedTo(currentPosition()).length, filter: ['Status', 'Returned'] },
        { label: 'Awaiting issue', count: outboundQueue().length, filter: ['Status', 'Created'] },
        { label: 'In transit', count: all.filter(s => s.status === 'Gate Cleared').length, filter: ['Status', 'Gate Cleared'] },
        { label: 'Cancelled', count: all.filter(s => s.status === 'Cancelled').length, filter: ['Status', 'Cancelled'] }
      ],
      columns: [
        { label: 'Shipment', cell: s => '<b>' + esc(s.id) + '</b>' + nowBadge(s) },
        { label: 'Request', cell: s => '<span class="mono">' + esc(s.scrId) + '</span>' },
        { label: 'Direction', cell: s => s.direction === 'Return'
            ? '<span class="sb-st sb-st-info">Return</span>' : '<span class="dim">Outward</span>' },
        { label: 'Vendor', cell: s => esc(vendor(s.vendorId).name) },
        { label: 'Lines', cell: s => s.lines.length, align: 'center' },
        { label: 'Quantity', cell: s => fmtQty(s.lines.reduce((x, l) => x + Number(l.qty), 0)), align: 'right' },
        { label: 'Allocation', cell: s => !needsLotAllocation(s.id)
            ? '<span class="dim">Not required</span>'
            : (isAllocated(s.id) ? sbStatus('Completed') : sbStatus('In Progress', 'Pending')) },
        /* A returned shipment used to render as plain "Created / Pending"
           here — the one list the responsible role would look in. */
        { label: 'Status', cell: s => isReturned(s)
            ? sbStatus('Returned') + '<div class="dim">with the ' + esc(positionLabel(s.returnedTo)) + '</div>'
            : sbStatus(s.status) }
      ],
      rows: rows,
      onRow: s => 'openShipDetail(\'' + s.id + '\')',
      empty: 'No shipments yet. A shipment can be created once an order is approved.'
    });
}

/* ── Create ─────────────────────────────────────────────────────────────── */
function openShipmentCreate() {
  const eligible = scrStore.filter(r => {
    const p = poForScr(r.id);
    return p && p.status === 'Approved' && r.status === 'Approved' &&
           r.issueItems.some(l => openIssueQty(r.id, l.line) > 0.001);
  });
  openModal('Create shipment',
    '<div id="sh-err"></div>' +
    fField('Request', customSelect('sh-scr', '', eligible.map(r => r.id + ' · ' + r.title), 'Select an approved request'), true) +
    '<p class="modal-note">Choose the request, then pick quantities on the next step.</p>',
    'Continue', () => {
      const sel = getSelectValue('sh-scr');
      if (!sel) { document.getElementById('sh-err').innerHTML = buildErrors(['Select a request.']); return false; }
      const id = sel.split(' · ')[0];
      setTimeout(() => openShipmentLines(id), 60);
      return true;
    });
}

/* Entry point from a request's own detail screen — straight to the quantity
   step with context intact, instead of routing through the Shipments list and
   making the planner re-select the request they were standing on. */
function startShipmentFor(scrId) {
  if (page !== 'shipments') { page = 'shipments'; activeSidebarItem = 'shipments'; expandOwningDropdown('shipments'); renderPage(); syncUrl(); }
  openShipmentLines(scrId);
}

function openShipmentLines(scrId) {
  const r = scr(scrId);
  const open = r.issueItems.filter(l => openIssueQty(scrId, l.line) > 0.001);

  /* An empty step-2 used to render bare table headers over a Create button —
     nothing to create and no words saying so. */
  if (!open.length) {
    openModal('Shipment quantities',
      '<p class="modal-msg">Every issue item on ' + esc(r.id) + ' has already been fully shipped. ' +
      'There is no open quantity left to dispatch.</p>', 'Close', () => true);
    return;
  }

  const body = '<div id="sh-err"></div>' +
    '<p class="modal-note">' + esc(r.id) + ' · ' + esc(r.title) + '</p>' +
    '<div class="lines-wrap"><table class="lines"><thead><tr>' +
    '<th>#</th><th>Product</th><th class="ta-right">Open</th><th class="ta-right">Available</th><th class="ta-right">Ship</th>' +
    '</tr></thead><tbody>' + open.map(l => {
      const openQ = openIssueQty(scrId, l.line);
      const avail = availableQty(l.productId, r.plantId, null);
      /* Partial availability (US5/AC4): default to what CAN go, not to what
         was asked for, so the planner is nudged toward a valid shipment. */
      const suggest = Math.min(openQ, Math.max(0, avail));
      return '<tr><td class="mono">' + l.line + '</td><td>' + esc(product(l.productId).name) + '</td>' +
        '<td class="ta-right">' + fmtQty(openQ) + ' ' + esc(l.uom) + '</td>' +
        '<td class="ta-right' + (avail < openQ ? ' bal-open' : '') + '">' + fmtQty(avail) + ' ' + esc(l.uom) + '</td>' +
        '<td class="ta-right"><span class="qty-wrap"><input class="inp inp-num" id="shq-' + l.line + '" type="number" step="0.001" min="0" ' +
        'value="' + suggest + '" style="height:30px;width:110px"><span class="qty-uom">' + esc(l.uom) + '</span></span></td></tr>';
    }).join('') + '</tbody></table></div>';

  openModal('Shipment quantities', body, 'Create shipment', () => {
    const lines = [];
    open.forEach(l => {
      const q = numValue('shq-' + l.line);
      if (q > 0) lines.push({ line: l.line, qty: q });
    });
    if (!lines.length) {
      document.getElementById('sh-err').innerHTML = buildErrors(['Enter a quantity on at least one line.']);
      return false;
    }
    const res = createShipment(scrId, lines, 'Outward');
    if (!res.ok) { document.getElementById('sh-err').innerHTML = buildErrors(res.errors); return false; }
    toast('Shipment ' + res.shipment.id + ' created and material reserved.');
    shipSelected = res.shipment.id;
    shipView = 'detail';
    renderPage();
    return true;
  });
}

/* ── Detail ─────────────────────────────────────────────────────────────── */
function buildShipDetail() {
  const s = shipment(shipSelected);
  if (!s) { shipView = 'list'; return buildShipListing(); }
  const r = scr(s.scrId);
  const live = hasLiveChallan(s.id);
  const canCancel = canDo('cancel-shipment') && s.status !== 'Cancelled' && s.status !== 'Closed' && !live;

  let actions = '<button class="btn-outline" onclick="backToShipList()">Back</button>';
  /* RESOLVE LIVES HERE, on the record itself.

     It used to sit on the Stores Outbound and Gate pages — queues the role the
     record was returned TO cannot open. A shipment returned to the planner
     showed Resolve on a page only Stores can reach, and a shipment returned to
     Stores by Logistics had no Resolve anywhere at all. Every role that can
     open a shipment can reach this button. */
  if (isReturned(s)) {
    actions += actionBtn('Resolve correction', 'resolveShipAction(\'' + s.id + '\')',
      currentPosition() === s.returnedTo || currentPosition() === 'pmg-admin',
      'This was returned to the ' + positionLabel(s.returnedTo) + ', who resolves it.', 'btn-primary');
  }
  if (s.status !== 'Cancelled' && s.status !== 'Closed') {
    actions += actionBtn('Cancel shipment', 'cancelShipAction(\'' + s.id + '\')', canCancel,
      live ? 'A live Challan exists against this shipment, so it can no longer be cancelled.'
           : 'Only a Planner can cancel a shipment.');
  }

  const reserved = reservationsFor(s.id);
  return buildPageHead(s.id + (s.direction === 'Return' ? ' · Return leg' : ''),
      'Request ' + esc(s.scrId) + ' · ' + esc(vendor(s.vendorId).name), actions) +
    buildNextStep(s.scrId) +
    buildStageBar(journeyIndex(s.scrId)) +
    shipErrorsBlock() +
    (isReturned(s) ? buildNotice('<b>Returned for correction.</b> ' + esc(s.returnReason) +
      (s.returnRemarks ? ' — ' + esc(s.returnRemarks) : '') +
      ' It is with the ' + esc(positionLabel(s.returnedTo)) +
      ', and everything downstream stays blocked until it is resolved.', 'wait') : '') +
    (s.status === 'Cancelled' ? buildNotice('<b>Cancelled.</b> ' + esc(s.reason) +
      (s.remarks ? ' — ' + esc(s.remarks) : '') +
      ' The shipment is kept for audit and its quantity is open again.', 'idle') : '') +
    (live && s.status !== 'Closed' ? buildNotice('A live Challan exists against this shipment. Cancellation is blocked until the challan is closed.', 'wait') : '') +
    '<div class="split"><div>' +
      buildCard('Shipment', buildFieldGrid([
        ['Status', sbStatus(s.status)],
        ['Direction', esc(s.direction)],
        ['Request', '<span class="mono">' + esc(s.scrId) + '</span>'],
        ['Order', '<span class="mono">' + esc(s.poId) + '</span>'],
        ['Vendor', esc(vendor(s.vendorId).name)],
        ['Plant', esc(plant(s.plantId).name)],
        ['Created', esc(s.createdOn)],
        ['Lot allocation', !needsLotAllocation(s.id) ? 'Not required'
          : (isAllocated(s.id) ? sbStatus('Completed') : sbStatus('In Progress', 'Pending'))]
      ], 4)) +
      buildCard('Lines', '<div class="lines-wrap"><table class="lines"><thead><tr>' +
        '<th>#</th><th>Product</th><th class="ta-right">Quantity</th><th>UOM</th><th>Reserved from</th><th>Lots</th>' +
        '</tr></thead><tbody>' + s.lines.map(l => {
          const il = r.issueItems.find(x => x.line === l.line) || {};
          const res = reserved.find(x => x.productId === il.productId);
          const lots = res && res.allocatedLots && res.allocatedLots.length
            ? res.allocatedLots.map(x => '<span class="sb-st sb-st-idle" style="margin-right:3px">' +
                esc(x.lot) + ' · ' + fmtQty(x.qty, 0) + '</span>').join('')
            : (product(il.productId).lotControlled ? '<span class="dim">Not allocated</span>' : '<span class="dim">—</span>');
          return '<tr><td class="mono">' + l.line + '</td><td>' + esc(product(il.productId).name) + '</td>' +
            '<td class="ta-right">' + fmtQty(l.qty) + '</td><td>' + esc(il.uom) + '</td>' +
            '<td>' + esc(locationByRole(s.plantId, 'Reserved').name) + ' <span class="dim">(virtual)</span></td>' +
            '<td>' + lots + '</td></tr>';
        }).join('') + '</tbody></table></div>') +
    '</div><div>' + buildActivityPanelHTML(s.id) + '</div></div>';
}

function shipErrorsBlock() { return shipErrors.length ? buildErrors(shipErrors) : ''; }

function resolveShipAction(id) {
  const res = resolveStage(shipment(id), 'Correction completed');
  if (!res.ok) { toast(res.error, 'bad'); return; }
  toast('Correction recorded. The shipment can move on again.');
  renderPage();
}

function cancelShipAction(id) {
  openReasonModal('RC-SHIPCAN', 'Cancel shipment', (reason, remarks) => {
    const res = cancelShipment(id, reason, remarks);
    if (!res.ok) { toast(res.error, 'bad'); return; }
    toast('Shipment cancelled. Reserved material is available again.');
    renderPage();
  });
}

/* ==========================================================================
   MATERIAL ALLOCATION  (US16)

   Identifies WHICH physical stock is going. It does not reduce availability
   again — that already happened at reservation.
   ========================================================================== */
let allocSelected = null;

function buildAllocationPage() {
  const queue = shipmentStore.filter(s => s.status === 'Created' && needsLotAllocation(s.id));
  if (allocSelected && shipment(allocSelected)) return buildAllocationDetail(shipment(allocSelected));

  return buildPageHead('Material Allocation',
      'Controlled material — plate, forgings — must have exact lots identified before Stores can issue it. Allocation names the stock; it does not move it.') +
    buildListing({
      stats: [
        { label: 'Awaiting allocation', count: queue.filter(s => !isAllocated(s.id)).length },
        { label: 'Allocated', count: queue.filter(s => isAllocated(s.id)).length }
      ],
      columns: [
        { label: 'Shipment', cell: s => '<b>' + esc(s.id) + '</b>' },
        { label: 'Request', cell: s => '<span class="mono">' + esc(s.scrId) + '</span>' },
        { label: 'Vendor', cell: s => esc(vendor(s.vendorId).name) },
        { label: 'Controlled lines', cell: s => reservationsFor(s.id)
            .filter(x => product(x.productId).lotControlled).length, align: 'center' },
        { label: 'Allocation', cell: s => isAllocated(s.id) ? sbStatus('Completed') : sbStatus('In Progress', 'Pending') },
        { label: '', align: 'right', cell: s => canDo('allocate-lot')
            ? '<button class="btn-outline btn-sm" onclick="event.stopPropagation();openAllocation(\'' + s.id + '\')">' +
              (isAllocated(s.id) ? 'Review' : 'Allocate') + '</button>' : '' }
      ],
      rows: queue,
      empty: 'Nothing is waiting for lot allocation.'
    });
}

function openAllocation(id) { allocSelected = id; renderPage(); }
function backToAllocation() { allocSelected = null; renderPage(); }

function buildAllocationDetail(s) {
  const r = scr(s.scrId);
  const controlled = reservationsFor(s.id).filter(x => product(x.productId).lotControlled);
  return buildPageHead('Allocate ' + s.id,
      'Request ' + esc(s.scrId) + ' · ' + esc(vendor(s.vendorId).name),
      '<button class="btn-outline" onclick="backToAllocation()">Back</button>' +
      actionBtn('Return to planner', 'returnAllocAction(\'' + s.id + '\')', canDo('return-allocation'),
        'Only a Material Planner can return an allocation.')) +
    controlled.map(res => {
      const lots = availableLots(res.productId, res.plantId);
      const already = res.allocatedLots || [];
      return buildCard(product(res.productId).name + ' · ' + fmtQty(res.qty) + ' ' + product(res.productId).uom + ' to allocate',
        '<div class="lines-wrap"><table class="lines"><thead><tr>' +
        '<th>Lot</th><th class="ta-right">Physical</th><th class="ta-right">Eligible</th><th class="ta-right">Allocate</th>' +
        '</tr></thead><tbody>' + (lots.length ? lots.map(l => {
          const prev = already.find(a => a.lot === l.lot);
          return '<tr><td class="mono"><b>' + esc(l.lot || '(no lot)') + '</b></td>' +
            '<td class="ta-right">' + fmtQty(l.physical) + '</td>' +
            '<td class="ta-right">' + fmtQty(l.available) + '</td>' +
            '<td class="ta-right"><input class="inp inp-num" id="al-' + statusClass(res.productId + l.lot) +
            '" type="number" step="0.001" min="0" value="' + (prev ? prev.qty : 0) +
            '" style="height:30px;width:120px"></td></tr>';
        }).join('') : '<tr><td colspan="4" class="dim" style="padding:16px;text-align:center">No eligible lot has stock.</td></tr>') +
        '</tbody></table></div>' +
        '<div id="al-err-' + statusClass(res.productId) + '" style="margin-top:12px"></div>',
        actionBtn('Confirm allocation', 'confirmAlloc(\'' + s.id + '\',\'' + res.productId + '\')',
          canDo('allocate-lot'), 'Only a Material Planner can allocate.', 'btn-primary'));
    }).join('');
}

function confirmAlloc(sid, productId) {
  const s = shipment(sid);
  const res = reservationsFor(sid).find(x => x.productId === productId);
  const lots = availableLots(productId, res.plantId).map(l => ({
    lot: l.lot, qty: numValue('al-' + statusClass(productId + l.lot))
  })).filter(l => l.qty > 0);

  const out = allocateLots(sid, productId, lots);
  const box = document.getElementById('al-err-' + statusClass(productId));
  if (!out.ok) { if (box) box.innerHTML = buildErrors([out.error]); return; }
  logAction(sid, 'Lot allocated', { remarks: lots.map(l => l.lot + ' · ' + fmtQty(l.qty, 0)).join(', ') });
  notify('lot-allocated', 'Lots allocated on ' + sid,
         product(productId).name + ' · ' + lots.map(l => l.lot).join(', '), sid);
  toast('Allocation confirmed.');
  if (isAllocated(sid)) allocSelected = null;
  renderPage();
}

/* The FIFTH Return action, and the one guarding lot-controlled material. It
   wrote s.reason/s.remarks — the fields cancelShipment uses — plus a log line,
   changed no state, and told the Material Planner it had been held. Stores
   could then good-issue on the very next click and the material left the
   plant. Now identical to the other four. */
function returnAllocAction(sid) {
  openReasonModal('RC-ALLOC', 'Return allocation', (reason, remarks) => {
    returnStage(shipment(sid), 'planner', reason, remarks, 'Returned by material planning');
    toast('Returned to the planner. Good issue is now blocked until it is resolved.');
    allocSelected = null;
    renderPage();
  });
}

registerPage('shipments', () => shipView === 'detail' ? buildShipDetail() : buildShipListing());
registerPage('allocation', buildAllocationPage);

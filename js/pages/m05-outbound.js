/* ==========================================================================
   M-05  STORES OUTBOUND AND LOGISTICS   (US6, US7)

   Material physically leaves here, and the journey forks on the Logistics
   flag.  Good Issue is the only place in the app where stock actually moves
   out of a Main location.
   ========================================================================== */

let outSelected = null;
let logSelected = null;

/* ONE DEFINITION OF EACH QUEUE.

   The dashboard tiles used to re-derive these predicates and drifted from
   them: "To issue" counted `status === 'Created'` while the page it navigates
   to also excluded returned shipments. So a tile read 1 and clicking it landed
   on "Nothing is waiting for outbound processing." A tile is the app telling
   you what to do next; it must not disagree with the page it points at. */
function outboundQueue() { return shipmentStore.filter(s => s.status === 'Created' && !isReturned(s)); }
function outboundReturned() { return shipmentStore.filter(s => s.status === 'Created' && isReturned(s)); }
function logisticsQueue() {
  return shipmentStore.filter(s => s.status === 'Freezed Outbound Release' &&
    scr(s.scrId).logistics && !s.logistics && !isReturned(s));
}
function logisticsReturned() {
  return shipmentStore.filter(s => s.status === 'Freezed Outbound Release' &&
    scr(s.scrId).logistics && !s.logistics && isReturned(s));
}
function returnedTo(position) {
  return shipmentStore.filter(s => isReturned(s) && s.returnedTo === position);
}

/* ── Stores outbound ────────────────────────────────────────────────────── */
function buildOutboundPage() {
  if (outSelected && shipment(outSelected)) return buildOutboundDetail(shipment(outSelected));

  /* Scoped to the store the user belongs to (US6/AC1). A returned shipment
     leaves this queue — it is the planner's problem until they resolve it. */
  const queue = outboundQueue();
  const returned = outboundReturned();
  const done = shipmentStore.filter(s => s.status === 'Freezed Outbound Release');

  return buildPageHead('Stores Outbound',
      'Only the quantity reserved against this shipment may be released. Material reserved for another deal is not eligible, whatever is physically on the shelf.') +
    (returned.length ? buildNotice('<b>' + returned.length + ' shipment' + (returned.length > 1 ? 's' : '') +
      ' returned for correction.</b> ' + returned.map(s => esc(s.id) + ' — ' + esc(s.returnReason)).join('; ') +
      '. They stay out of the queue until the planner resolves them.', 'wait') : '') +
    buildListing({
      stats: [
        { label: 'To issue', count: queue.length, filter: null },
        { label: 'Returned', count: returned.length },
        { label: 'Released', count: done.length }
      ],
      columns: [
        { label: 'Shipment', cell: s => '<b>' + esc(s.id) + '</b>' },
        { label: 'Request', cell: s => '<span class="mono">' + esc(s.scrId) + '</span>' },
        { label: 'Vendor', cell: s => esc(vendor(s.vendorId).name) },
        { label: 'Quantity', cell: s => fmtQty(s.lines.reduce((x, l) => x + Number(l.qty), 0)), align: 'right' },
        /* One attribute, one language. This column used to speak three: an
           amber pill, a green pill and plain grey text. */
        { label: 'Allocation', cell: s => !needsLotAllocation(s.id) ? '<span class="chip">Not required</span>'
            : (isAllocated(s.id) ? '<span class="chip chip-on">Allocated</span>'
                                 : '<span class="chip">Incomplete</span>') },
        { label: 'Status', cell: s => isReturned(s)
            ? sbStatus('Returned') + '<div class="dim">' + esc(s.returnReason) + '</div>'
            : sbStatus(s.status) },
        /* Names the role it actually went to, and links to the record where
           Resolve lives, rather than showing a button nobody here can press. */
        { label: '', align: 'right', cell: s => isReturned(s)
            ? (currentPosition() === s.returnedTo
                ? '<button class="btn-primary btn-sm" onclick="event.stopPropagation();resolveOutboundAction(\'' + s.id + '\')">Resolve</button>'
                : '<span class="dim">With the ' + esc(positionLabel(s.returnedTo)) + '</span>')
            : (s.status === 'Created'
                ? '<button class="btn-outline btn-sm" onclick="event.stopPropagation();openOutbound(\'' + s.id + '\')">Open</button>' : '') }
      ],
      rows: queue.concat(returned).concat(done),
      empty: 'Nothing is waiting for outbound processing.'
    });
}

function openOutbound(id) { outSelected = id; renderPage(); }
function backToOutbound() { outSelected = null; renderPage(); }

function buildOutboundDetail(s) {
  const r = scr(s.scrId);
  const blockedByAlloc = needsLotAllocation(s.id) && !isAllocated(s.id);
  const may = canDo('good-issue') && s.status === 'Created';

  return buildPageHead('Good Issue · ' + s.id,
      'Request ' + esc(s.scrId) + ' · ' + esc(vendor(s.vendorId).name),
      '<button class="btn-outline" onclick="backToOutbound()">Back</button>' +
      actionBtn('Return', 'returnOutboundAction(\'' + s.id + '\')', canDo('return-outbound'),
        'Only Stores can return a shipment.') +
      actionBtn('Confirm good issue', 'goodIssueAction(\'' + s.id + '\')', may && !blockedByAlloc,
        blockedByAlloc ? 'Lot allocation is incomplete. Controlled material cannot be issued without it.'
                       : 'Only Stores can perform a good issue.', 'btn-primary')) +
    (blockedByAlloc ? buildNotice('<b>Blocked.</b> This shipment carries lot-controlled material with no allocation. ' +
      'The Material Planner must allocate exact lots before it can be issued.', 'wait') : '') +
    buildCard('Verify material', '<div class="lines-wrap"><table class="lines"><thead><tr>' +
      '<th>#</th><th>Product</th><th class="ta-right">Shipment qty</th><th class="ta-right">Reserved</th>' +
      '<th>Lot / stock</th><th>Reserved location</th></tr></thead><tbody>' +
      s.lines.map(l => {
        const il = r.issueItems.find(x => x.line === l.line) || {};
        const res = reservationsFor(s.id).find(x => x.productId === il.productId) || {};
        const lots = (res.allocatedLots || []).map(x => x.lot + ' · ' + fmtQty(x.qty, 0)).join(', ');
        return '<tr><td class="mono">' + l.line + '</td><td>' + esc(product(il.productId).name) + '</td>' +
          '<td class="ta-right">' + fmtQty(l.qty) + '</td>' +
          '<td class="ta-right">' + fmtQty(res.qty || 0) + '</td>' +
          '<td class="mono">' + (lots ? esc(lots) : '<span class="dim">—</span>') + '</td>' +
          '<td>' + esc(locationByRole(s.plantId, 'Reserved').name) + '</td></tr>';
      }).join('') + '</tbody></table></div>') +
    buildCard('What happens on confirmation',
      '<ul style="margin:0;padding-left:18px;font-size:var(--ds-body);color:var(--gray);line-height:1.7">' +
      '<li>Stock leaves ' + esc(locationByRole(s.plantId, 'Main').name) + ' and the claim becomes <b>Released</b>.</li>' +
      '<li>Shipment status moves to <b>Freezed Outbound Release</b>.</li>' +
      '<li>The material position becomes <b>At Vendor / In Transit</b>.</li>' +
      '<li>' + (r.logistics ? 'Logistics details are required next.' : 'Logistics is skipped — the Delivery Note can be generated straight away.') + '</li>' +
      '</ul>');
}

function goodIssueAction(id) {
  const res = goodIssueShipment(id);
  if (!res.ok) { toast(res.error, 'bad'); return; }
  const r = scr(shipment(id).scrId);
  toast('Good issue completed. ' + (r.logistics ? 'Now with Logistics.' : 'Ready for a Delivery Note.'));
  outSelected = null;
  renderPage();
}

/* This used to write a log line and s.reason/s.remarks — the same two fields
   cancelShipment uses, so a return reason later masqueraded as a cancellation
   reason — then toast "Good issue stays blocked" while good issue succeeded on
   the very next click. It now sets the stage, which goodIssueShipment refuses. */
function returnOutboundAction(id) {
  openReasonModal('RC-STORERET', 'Return shipment', (reason, remarks) => {
    returnStage(shipment(id), 'planner', reason, remarks, 'Returned by stores');
    toast('Returned to the planner. Good issue is now blocked until it is resolved.');
    outSelected = null;
    renderPage();
  });
}

function resolveOutboundAction(id) {
  const res = resolveStage(shipment(id), 'Correction accepted');
  if (!res.ok) { toast(res.error, 'bad'); return; }
  toast('Correction accepted. The shipment is back in the outbound queue.');
  renderPage();
}

/* ── Logistics ──────────────────────────────────────────────────────────── */
function buildLogisticsPage() {
  if (logSelected && shipment(logSelected)) return buildLogisticsDetail(shipment(logSelected));

  /* Only shipments whose request actually requires logistics appear here, and
     a returned one is held out — it is with Stores until they resolve it. */
  const queue = logisticsQueue();
  const held = logisticsReturned();
  const done = shipmentStore.filter(s => s.logistics);

  return buildPageHead('Logistics',
      'Only shipments whose request has Logistics = Yes reach this queue. Where it is No the stage does not exist at all and the Delivery Note is generated directly.') +
    (held.length ? buildNotice('<b>' + held.length + ' shipment' + (held.length > 1 ? 's are' : ' is') +
      ' returned for correction</b> and held out of the queue: ' +
      held.map(s => esc(s.id) + ' — ' + esc(s.returnReason) + ' (with the ' +
        esc(positionLabel(s.returnedTo)) + ')').join('; ') + '.', 'wait') : '') +
    buildListing({
      stats: [
        { label: 'To arrange', count: queue.length },
        { label: 'Held', count: held.length },
        { label: 'Arranged', count: done.length }
      ],
      columns: [
        { label: 'Shipment', cell: s => '<b>' + esc(s.id) + '</b>' },
        { label: 'Request', cell: s => '<span class="mono">' + esc(s.scrId) + '</span>' },
        { label: 'Vendor', cell: s => esc(vendor(s.vendorId).name) },
        { label: 'Destination', cell: s => esc(vendor(s.vendorId).city) },
        { label: 'Mode', cell: s => s.logistics ? esc(s.logistics.mode) : '<span class="dim">—</span>' },
        { label: 'Vehicle', cell: s => s.logistics ? '<span class="mono">' + esc(s.logistics.vehicleNo || '—') + '</span>' : '<span class="dim">—</span>' },
        { label: 'Status', cell: s => isReturned(s)
            ? sbStatus('Returned') + '<div class="dim">' + esc(s.returnReason) + '</div>'
            : (s.logistics ? sbStatus('Completed') : sbStatus('In Progress', 'Pending')) },
        { label: '', align: 'right', cell: s => isReturned(s)
            ? '<span class="dim">With the ' + esc(positionLabel(s.returnedTo)) + '</span>'
            : (canDo('maintain-logistics')
                ? '<button class="btn-outline btn-sm" onclick="event.stopPropagation();openLogistics(\'' + s.id + '\')">' +
                  (s.logistics ? 'Review' : 'Arrange') + '</button>' : '') }
      ],
      rows: queue.concat(held).concat(done),
      empty: 'Nothing is waiting on logistics.'
    });
}

function openLogistics(id) { logSelected = id; renderPage(); }
function backToLogistics() { logSelected = null; renderPage(); }

const MODE_FIELD_NAMES = { vehicleNo: 'Vehicle Number', driver: 'Driver', transporter: 'Transporter',
                           lrNo: 'LR / Transport Reference', insurance: 'Insurance' };

/* Mode changed → which fields are mandatory changed with it. Without this the
   `*` markers froze on the render-time mode and contradicted the validation. */
let lgMode = null;
function onLgModeChange(v) { lgMode = v; renderPage(); }

function buildLogisticsDetail(s) {
  const g = s.logistics || {};
  const mode = lgMode || g.mode || 'Road';
  const req = MODE_REQUIRED[mode] || [];
  const reqNames = req.map(f => MODE_FIELD_NAMES[f]).join(', ');
  return buildPageHead('Logistics · ' + s.id,
      'Mandatory fields change with the transport mode — road needs a vehicle and driver, sea and air need insurance and an LR reference.',
      '<button class="btn-outline" onclick="backToLogistics()">Back</button>' +
      actionBtn('Return', 'returnLogisticsAction(\'' + s.id + '\')', canDo('return-logistics'),
        'Only Logistics can return a shipment.') +
      actionBtn('Complete logistics', 'saveLogisticsAction(\'' + s.id + '\')', canDo('complete-logistics'),
        'Only Logistics can complete this stage.', 'btn-primary')) +
    '<div id="lg-err"></div>' +
    buildCard('Transport',
      '<div class="form-grid">' +
        /* Friendly names — the hint used to print the internal keys
           ("vehicleNo, driver, transporter") straight onto the screen. */
        fField('Transport Mode', customSelect('lg-mode', mode, TRANSPORT_MODES, 'Road', '', 'onLgModeChange'), true,
          'Needed for ' + mode + ': ' + reqNames + '.') +
        fField('Transporter', fText('lg-transporter', g.transporter, 'Sri Venkateswara Carriers'), req.indexOf('transporter') !== -1) +
        fField('Vehicle Number', fText('lg-vehicleNo', g.vehicleNo, 'TN 45 BQ 1123'), req.indexOf('vehicleNo') !== -1) +
        fField('Driver', fText('lg-driver', g.driver, 'S. Murugan'), req.indexOf('driver') !== -1) +
        fField('LR / Transport Reference', fText('lg-lrNo', g.lrNo, 'LR-33912'), req.indexOf('lrNo') !== -1) +
        fField('Insurance', fText('lg-insurance', g.insurance, 'Policy 4471/2026'), req.indexOf('insurance') !== -1) +
        fField('Package Type', customSelect('lg-pkgtype', g.pkgType || '',
          ['Crate', 'Pallet', 'Loose', 'Bundle'], 'Select type'), true) +
        fField('Package Count', fNum('lg-packages', g.packages, '0', '1'), true) +
      '</div>');
}

function saveLogisticsAction(id) {
  const data = {
    mode: getSelectValue('lg-mode'),
    transporter: inputValue('lg-transporter'),
    vehicleNo: inputValue('lg-vehicleNo'),
    driver: inputValue('lg-driver'),
    lrNo: inputValue('lg-lrNo'),
    insurance: inputValue('lg-insurance'),
    pkgType: getSelectValue('lg-pkgtype'),
    packages: numValue('lg-packages')
  };
  const res = saveLogistics(id, data);
  if (!res.ok) { document.getElementById('lg-err').innerHTML = buildErrors(res.errors); return; }
  lgMode = null;
  toast(handoffMsg(shipment(id).scrId, 'Transport arranged.'));
  logSelected = null;
  renderPage();
}

function returnLogisticsAction(id) {
  openReasonModal('RC-LOGIRET', 'Return shipment', (reason, remarks) => {
    returnStage(shipment(id), 'stores', reason, remarks, 'Returned by logistics');
    toast('Returned to stores. Delivery Note generation is now blocked.');
    logSelected = null;
    renderPage();
  });
}

registerPage('outbound', buildOutboundPage);
registerPage('logistics', buildLogisticsPage);

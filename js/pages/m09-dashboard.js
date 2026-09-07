/* ==========================================================================
   M-09  DASHBOARD, REPORTS AND ACTIVITY LOG

   The dashboard shows what is waiting on YOU — the pending work for the
   signed-in position, not a generic set of counters everybody sees.  A tile
   that leads nowhere is decoration, so every one of them navigates.
   ========================================================================== */

/* What each position is actually waiting to do.  Keyed on position because a
   queue belongs to a role, not to a Team. */
function pendingFor(position) {
  const q = [];
  /* `filt` is the [label, value] the destination page should open filtered to —
     a tile that counts one thing and lands on an unfiltered list of nine is a
     promise broken at the first click. */
  const add = (label, count, page, sub, filt) => { if (count > 0 || q.length < 4) q.push({ label, count, page, sub, filt }); };

  switch (position) {
    case 'planner':
      add('Draft requests', scrStore.filter(r => r.status === 'Created').length, 'scr', 'Not yet submitted', ['Status', 'Created']);
      /* Counts shipments too. A shipment returned by Stores or Material
         Planning came back to the planner and this tile ignored it entirely,
         so the record arrived in silence. */
      /* Two tiles, not one. A combined count routed to Shipments, where the
         returned REQUESTS it also counted cannot appear — so the number never
         matched the page. */
      add('Requests returned', scrStore.filter(r => r.status === 'Returned').length, 'scr', 'Correct and resubmit', ['Status', 'Returned']);
      add('Shipments returned', returnedTo('planner').length, 'shipments', 'Resolve and release', ['Status', 'Returned']);
      add('Ready to ship', scrStore.filter(r => { const p = poForScr(r.id);
        return p && p.status === 'Approved' && r.issueItems.some(l => openIssueQty(r.id, l.line) > 0.001); }).length,
        'shipments', 'Order approved, quantity open');
      add('Return window closing', challansNearingExpiry().length, 'challans', 'Material still out');
      break;
    case 'pmg-approver':
      add('Requests to approve', scrStore.filter(r => r.status === 'Sent for Approval').length, 'scr', 'Awaiting your decision', ['Status', 'Sent for Approval']);
      add('Orders to approve', poStore.filter(p => p.status === 'Created').length, 'orders', 'Commercial terms complete', ['Status', 'Created']);
      break;
    case 'buyer':
      add('Draft orders', poStore.filter(p => p.status === 'Draft' && p.nonBillableConfirmed !== false).length, 'orders', 'Commercial terms needed', ['Status', 'Draft']);
      add('Blocked on finance', poStore.filter(p => p.nonBillableConfirmed === false).length, 'orders', 'Non-billable unconfirmed');
      add('Short-close to confirm', scrStore.filter(r => r.receivableItems.some(l => l.shortClosePending)).length,
        'reconciliation', 'Raised by a planner');
      break;
    case 'material-planner':
      add('Lots to allocate', shipmentStore.filter(s => s.status === 'Created' && needsLotAllocation(s.id) && !isAllocated(s.id)).length,
        'allocation', 'Controlled material');
      break;
    /* Every count below calls the destination page's OWN queue function, so a
       tile can never advertise work the page it links to filters out. */
    case 'stores':
      add('To issue', outboundQueue().length, 'outbound', 'Verify and release');
      add('Returned to you', returnedTo('stores').length, 'shipments', 'Correct and resolve', ['Status', 'Returned']);
      add('Material to receive', inwardQueue().length, 'inward', 'Open challans');
      add('Notes to generate', dnoteEligible().length, 'delivery-notes', 'Ready for a delivery note');
      break;
    case 'logistics':
      add('To arrange', logisticsQueue().length, 'logistics', 'Transport details needed');
      add('Held', logisticsReturned().length, 'logistics', 'Returned for correction');
      break;
    case 'dnote-approver':
      add('Notes to approve', dnoteStore.filter(d => d.status === 'Generated').length, 'delivery-notes', 'Awaiting your decision');
      break;
    case 'finance':
      add('Non-billable to confirm', poStore.filter(p => p.nonBillableConfirmed === false).length, 'orders', 'Zero-value orders');
      add('Challans to generate', dnoteStore.filter(d => d.status === 'Approved' && !challanForShipment(d.shipmentId)).length,
        'challans', 'Delivery note approved');
      add('Ready to close', scrStore.filter(r => r.status === 'Approved' && !reconciliationBlockers(r.id).length).length,
        'reconciliation', 'Fully reconciled');
      add('Overdue challans', challanStore.filter(c => c.status === 'Overdue').length, 'challans', 'Return window passed', ['Status', 'Overdue']);
      break;
    /* F15 · IDT used to share Finance's tiles, which routed it to Reconciliation
       where every action is permanently disabled for this position — a
       dashboard of somebody else's work. It gets what it can actually do. */
    case 'idt':
      add('Non-billable to confirm', poStore.filter(p => p.nonBillableConfirmed === false).length, 'orders', 'Zero-value orders');
      add('Challans to generate', dnoteStore.filter(d => d.status === 'Approved' && !challanForShipment(d.shipmentId)).length,
        'challans', 'Delivery note approved');
      add('Inter-unit requests', scrStore.filter(r => r.interUnit).length, 'scr', 'Zero-value transfers');
      add('Held for correction', challanStore.filter(c => isReturned(c)).length, 'challans', 'Returned to finance');
      break;
    case 'security':
      add('At the gate', gateQueue().length, 'gate', 'Verify and record');
      break;
    default:
      add('Requests', scrStore.length, 'scr', 'All requests');
      add('Orders', poStore.length, 'orders', 'All orders');
      add('Open challans', challanStore.filter(c => c.status !== 'Closed').length, 'challans', 'Material out');
      add('Masters', productMaster.length + vendorMaster.length, 'products', 'Products and vendors');
  }
  return q.filter(x => can(x.page, 'v'));
}

/* ══ Dashboard widgets ═══════════════════════════════════════════════════════
   The old dashboard was tiles of numbers and two tables — a wall of zeros for
   most roles, with no visual anywhere in the app. These four widgets are what
   make it an operations surface, all pure CSS inside the token set.
   ═══════════════════════════════════════════════════════════════════════════ */

/* WHERE EVERY DEAL SITS. One segmented bar across the eight journey stages,
   coloured with the --st-p1..p8 ladder whose shade is documented as carrying
   progress. Clicking a segment opens the page that owns that stage. */
const STAGE_PAGE = ['scr', 'orders', 'shipments', 'outbound', 'delivery-notes', 'gate', 'inward', 'reconciliation'];
function buildPipelineStrip() {
  const open = scrStore.filter(r => r.status !== 'Rejected');
  if (!open.length) return '';
  const counts = JOURNEY.map(() => 0);
  open.forEach(r => counts[journeyIndex(r.id)]++);
  const total = open.length;
  const segs = JOURNEY.map((label, i) => {
    if (!counts[i]) return '';
    const pg = can(STAGE_PAGE[i], 'v') ? STAGE_PAGE[i] : null;
    return '<div class="pipe-seg pipe-p' + (i + 1) + '" style="flex-grow:' + counts[i] + '"' +
      (pg ? ' role="button" tabindex="0" onclick="navigatePage(\'' + pg + '\')"' +
            ' onkeydown="if(event.key===\'Enter\'){navigatePage(\'' + pg + '\')}"' : '') +
      ' title="' + attrSafe(counts[i] + ' at ' + label) + '">' +
      '<b>' + counts[i] + '</b><span>' + esc(label) + '</span></div>';
  }).join('');
  return buildCard('Pipeline — ' + total + ' active request' + (total > 1 ? 's' : ''),
    '<div class="pipe">' + segs + '</div>');
}

/* WHO HOLDS THE BALL. nextStepFor() already knows the pending actor for every
   open request; counted by position it shows where the process is jammed. */
function buildWorkloadSplit() {
  const open = scrStore.filter(r => r.status !== 'Closed' && r.status !== 'Rejected');
  const byPos = {};
  open.forEach(r => {
    const n = nextStepFor(r.id);
    if (n && !n.done && n.who) byPos[n.who.position] = (byPos[n.who.position] || 0) + 1;
  });
  const rows = Object.keys(byPos).sort((a, b) => byPos[b] - byPos[a]);
  if (!rows.length) return '';
  const max = byPos[rows[0]];
  return buildCard('Who holds the ball',
    '<div class="wl">' + rows.map(p =>
      '<div class="wl-row' + (p === currentPosition() ? ' wl-you' : '') + '">' +
        '<span class="wl-name">' + esc(positionLabel(p)) + (p === currentPosition() ? ' <span class="chip">you</span>' : '') + '</span>' +
        '<span class="wl-bar"><i style="width:' + Math.round(byPos[p] / max * 100) + '%"></i></span>' +
        '<span class="wl-n">' + byPos[p] + '</span>' +
      '</div>').join('') + '</div>');
}

/* WHO IS SITTING ON OUR STEEL. Outstanding receivable per vendor. */
function buildVendorExposure() {
  const byVendor = {};
  scrStore.filter(r => r.status === 'Approved').forEach(r => {
    const out = dealOutstanding(r.id);
    if (out > 0.001) byVendor[r.vendorId] = (byVendor[r.vendorId] || 0) + out;
  });
  const rows = Object.keys(byVendor).sort((a, b) => byVendor[b] - byVendor[a]);
  if (!rows.length) return '';
  const max = byVendor[rows[0]];
  return buildCard('Outstanding by vendor',
    '<div class="wl">' + rows.map(v =>
      '<div class="wl-row">' +
        '<span class="wl-name">' + esc(vendor(v).name) + '</span>' +
        '<span class="wl-bar wl-bar-v"><i style="width:' + Math.round(byVendor[v] / max * 100) + '%"></i></span>' +
        '<span class="wl-n">' + fmtQty(byVendor[v], 0) + '</span>' +
      '</div>').join('') + '</div>');
}

/* agingBar lives in ui.js — the vendor portal renders it too. */

function buildDashboard() {
  refreshReturnWindows();
  const u = currentUser();
  const q = pendingFor(u.position);
  const overdue = challanStore.filter(c => c.status === 'Overdue');
  const out = challanStore.filter(c => c.gateOutAt && c.status !== 'Closed');

  return buildPageHead('Good day, ' + esc(u.name.split(' ')[0]),
      esc(positionLabel(u.position)) + ' · ' + esc(currentTeam().name)) +
    (overdue.length ? buildNotice('<b>' + overdue.length + ' challan' + (overdue.length > 1 ? 's are' : ' is') +
      ' overdue.</b> The return window has passed with material still outstanding.' +
      (can('reconciliation', 'v') ? ' Short-close is available once you have decided it is not coming back.' : ''),
      'bad') : '') +
    '<div class="tiles">' + q.map(t =>
      '<div class="tile' + (t.count === 0 ? ' tile-zero' : '') + '" onclick="navigatePage(\'' + t.page + '\'' +
        (t.filt ? ',[\'' + attrSafe(t.filt[0]) + '\',\'' + attrSafe(t.filt[1]) + '\']' : '') + ')" tabindex="0" role="button" ' +
        'onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();this.click()}">' +
      '<span class="tile-label">' + esc(t.label) + '</span>' +
      '<span class="tile-val">' + t.count + '</span>' +
      '<span class="tile-sub">' + esc(t.count === 0 ? 'You are clear' : t.sub) + '</span></div>').join('') + '</div>' +
    buildPipelineStrip() +
    '<div class="dash-2col">' + buildWorkloadSplit() + buildVendorExposure() + '</div>' +
    (can('challans', 'v') ? buildCard('Material out at vendor',
      out.length
        ? '<div class="lines-wrap"><table class="lines"><thead><tr>' +
          '<th>Challan</th><th>Vendor</th><th>Return window</th>' +
          '<th class="ta-right">Outstanding</th><th>Notice</th>' +
          '</tr></thead><tbody>' + out
            .sort((a, b) => (daysRemaining(a) || 0) - (daysRemaining(b) || 0))
            .map(c => { const a = latestAsn(c.id);
              return '<tr><td>' + refLink(c.id) + '<div class="dim">' + esc(vendor(c.vendorId).city) + '</div></td>' +
              '<td class="tx">' + esc(vendor(c.vendorId).name) + '</td>' +
              '<td class="agebar-cell">' + agingBar(c) + '</td>' +
              '<td class="ta-right">' + fmtQty(challanOutstanding(c.id)) + '</td>' +
              '<td>' + (a ? '<span class="chip chip-on">' + esc(fmtDate(a.expectedDate)) + '</span>'
                          : '<span class="vp-none">No notice</span>') + '</td></tr>'; }).join('') +
          '</tbody></table></div>'
        : '<div class="lst-empty"><b>Nothing at vendor</b><span>No material is currently outside the plant.</span></div>') : '') +
    buildCard('Recent activity',
      activityLog.length
        ? '<div class="lines-wrap"><table class="lines"><thead><tr>' +
          '<th>Object</th><th>Action</th><th>Change</th><th>By</th><th>When</th></tr></thead><tbody>' +
          activityLog.slice(0, 8).map(a => '<tr><td>' + refLink(a.object) + '</td>' +
            '<td>' + esc(a.action) + '</td>' +
            '<td>' + (a.from && a.to ? esc(a.from) + ' <span class="dim">&rarr;</span> ' + esc(a.to) : '<span class="dim">—</span>') + '</td>' +
            '<td>' + esc(a.user) + ' <span class="dim">' + esc(a.position) + '</span></td>' +
            '<td class="nowrap dim">' + esc(a.date) + ' · ' + esc(a.time) + '</td></tr>').join('') +
          '</tbody></table></div>'
        : '<div class="lst-empty">Nothing has happened yet.</div>');
}

/* ── Reports ────────────────────────────────────────────────────────────────
   The three the BRD tabulates, with its own column sets. */
let reportTab = 'deal';

function buildReportsPage() {
  refreshReturnWindows();
  const tabs = [['deal', 'Deal level'], ['stock', 'Stock / material level'], ['doc', 'Document level']];
  /* F22 · These were built from .btn-primary / .btn-outline, so the selected
     TAB outranked Export CSV — the screen's actual affirmative action. Tabs
     are a navigation control and the design system has its own family. */
  return buildPageHead('Reports',
      'The three reports the BRD specifies, rendered from live prototype state rather than fixtures.',
      '<button class="btn-primary" onclick="exportReport()">Export CSV</button>') +
    '<div class="rpt-tabs">' + tabs.map(t =>
      '<button class="rpt-tab' + (reportTab === t[0] ? ' active' : '') + '" ' +
      'role="tab" aria-selected="' + (reportTab === t[0]) + '" ' +
      'onclick="reportTab=\'' + t[0] + '\';renderPage()">' + esc(t[1]) + '</button>').join('') + '</div>' +
    '<div class="listing-card">' +
      (reportTab === 'deal' ? reportDeal() : reportTab === 'stock' ? reportStock() : reportDoc()) +
    '</div>';
}

function reportDeal() {
  if (!scrStore.length) return buildEmpty('No requests yet.');
  return '<table class="listing-table has-sno rpt"><thead><tr>' +
    '<th>S No</th><th>Request</th><th>Title</th><th>Vendor</th><th>Work type</th><th>Inter-unit</th>' +
    '<th>Logistics</th><th>FIM</th><th>Team</th><th>Rate contract</th><th>Order</th>' +
    '<th>Deal status</th><th>Shipment status</th></tr></thead><tbody>' +
    scrStore.map((r, i) => {
      const p = poForScr(r.id);
      const ships = shipmentsForScr(r.id);
      const last = ships[ships.length - 1];
      return '<tr><td>' + (i + 1) + '</td><td><b>' + esc(r.id) + '</b></td><td class="tx" title="' + attrSafe(r.title) + '">' + esc(r.title) + '</td>' +
        '<td class="tx" title="' + attrSafe(vendor(r.vendorId).name) + '">' + esc(vendor(r.vendorId).name) + '</td><td>' + esc(r.workType) + '</td>' +
        '<td>' + (r.interUnit ? 'Yes' : 'No') + '</td><td>' + (r.logistics ? 'Yes' : 'No') + '</td>' +
        '<td>' + (r.fim ? 'Yes' : 'No') + '</td><td class="tx">' + esc(TEAMS[r.team] ? TEAMS[r.team].name : r.team) + '</td>' +
        '<td>' + (r.rateContractId ? maskCommercial(esc(r.rateContractId)) : '—') + '</td>' +
        '<td class="mono">' + (p ? esc(p.id) : '—') + '</td>' +
        '<td>' + sbStatus(r.status) + '</td>' +
        '<td>' + (last ? sbStatus(last.status) : sbStatus('Not Raised')) + '</td></tr>';
    }).join('') + '</tbody></table>';
}

function reportStock() {
  const rows = stockPosition();
  if (!rows.length) return buildEmpty('No stock movement yet.');
  return '<table class="listing-table has-sno rpt"><thead><tr>' +
    '<th>S No</th><th>Product</th><th>Type</th><th>Main category</th><th>HSN</th><th>UOM</th>' +
    '<th>Plant</th><th class="ta-right">Available</th><th class="ta-right">Reserved</th>' +
    '<th class="ta-right">At vendor</th><th class="ta-right">Received back</th><th>Position</th></tr></thead><tbody>' +
    rows.map((r, i) => { const p = product(r.productId);
      return '<tr><td>' + (i + 1) + '</td><td>' + esc(p.name) + '</td><td>' + esc(p.type) + '</td>' +
        '<td>' + esc(p.main) + '</td><td>' + esc(p.hsn) + '</td><td>' + esc(p.uom) + '</td>' +
        '<td>' + esc(plant(r.plantId).name) + '</td>' +
        '<td class="ta-right">' + fmtQty(r.available) + '</td>' +
        '<td class="ta-right">' + fmtQty(r.reserved) + '</td>' +
        '<td class="ta-right">' + fmtQty(r.atVendor) + '</td>' +
        '<td class="ta-right">' + fmtQty(r.received) + '</td>' +
        '<td>' + sbStatus(r.position) + '</td></tr>'; }).join('') + '</tbody></table>';
}

function reportDoc() {
  const docs = []
    .concat(dnoteStore.map(d => ({ id: d.id, type: 'Delivery Note', scrId: d.scrId, poId: d.poId,
      shipmentId: d.shipmentId, vendorId: shipment(d.shipmentId).vendorId, status: d.status, on: d.generatedOn })))
    .concat(challanStore.map(c => ({ id: c.id, type: 'Challan', scrId: c.scrId, poId: c.poId,
      shipmentId: c.shipmentId, vendorId: c.vendorId, status: c.status, on: c.generatedOn })))
    .concat(imrStore.map(i => ({ id: i.id, type: 'IMR', scrId: i.scrId, poId: '', shipmentId: i.shipmentId,
      vendorId: challan(i.challanId) ? challan(i.challanId).vendorId : '', status: i.status, on: i.createdOn })));
  if (!docs.length) return buildEmpty('No documents generated yet.');
  return '<table class="listing-table has-sno rpt"><thead><tr>' +
    '<th>S No</th><th>Document</th><th>Type</th><th>Request</th><th>Order</th><th>Shipment</th>' +
    '<th>Vendor</th><th>Status</th><th>Created on</th></tr></thead><tbody>' +
    docs.map((d, i) => '<tr><td>' + (i + 1) + '</td><td><b class="mono">' + esc(d.id) + '</b></td>' +
      '<td>' + esc(d.type) + '</td><td class="mono">' + esc(d.scrId) + '</td>' +
      '<td class="mono">' + esc(d.poId || '—') + '</td><td class="mono">' + esc(d.shipmentId) + '</td>' +
      '<td>' + esc(vendor(d.vendorId).name || '—') + '</td><td>' + sbStatus(d.status) + '</td>' +
      '<td>' + esc(d.on) + '</td></tr>').join('') + '</tbody></table>';
}

/* Export writes the visible table, so what you get is what you were looking at. */
function exportReport() {
  const table = document.querySelector('.listing-card table');
  if (!table) { toast('Nothing to export.', 'bad'); return; }
  const lines = Array.prototype.map.call(table.querySelectorAll('tr'), tr =>
    Array.prototype.map.call(tr.querySelectorAll('th,td'), c =>
      '"' + c.textContent.replace(/\s+/g, ' ').trim().replace(/"/g, '""') + '"').join(',')).join('\n');
  logAction('Reports', 'Report exported', { remarks: reportTab + ' level' });
  /* A viewer sandbox blocks page-initiated downloads, so the CSV is shown for
     copying rather than offered as a file that would silently fail. */
  openModal('Export · ' + reportTab + ' level report',
    '<p class="modal-msg">Copy the rows below.</p>' +
    '<textarea class="inp inp-area" rows="12" readonly>' + esc(lines) + '</textarea>',
    'Done', () => true);
}

/* ── Activity log ───────────────────────────────────────────────────────── */
function buildActivityPage() {
  const users = Object.keys(USERS).map(k => USERS[k].name);
  const rows = activityLog.filter(a =>
    passesFilter('User', a.user) && passesFilter('Action', a.action));
  return buildPageHead('Activity Log',
      'Append-only and view-only. Every add, edit, submit, approve, return, reject, cancel, generate, allocation, issue, receipt, gate outward and closure lands here — and nothing here can be edited or deleted.') +
    buildListing({
      filters: [
        { label: 'User', options: users },
        { label: 'Action', options: activityLog.map(a => a.action).filter((v, i, s) => s.indexOf(v) === i) }
      ],
      stats: [
        { label: 'Entries', count: activityLog.length },
        { label: 'Status changes', count: activityLog.filter(a => a.from && a.to).length },
        { label: 'Reason-coded', count: activityLog.filter(a => a.reason).length }
      ],
      columns: [
        { label: 'Log', cell: a => '<span class="mono dim">' + esc(a.id) + '</span>' },
        { label: 'Object', cell: a => '<b class="mono">' + esc(a.object) + '</b>' },
        { label: 'Action', cell: a => esc(a.action) },
        { label: 'From', cell: a => a.from ? sbStatus(a.from) : '<span class="dim">—</span>' },
        { label: 'To', cell: a => a.to ? sbStatus(a.to) : '<span class="dim">—</span>' },
        { label: 'Reason', cell: a => a.reason
            ? '<span class="act-reason">' + esc(a.reason) + '</span>' +
              (a.remarks ? '<div class="dim" title="' + attrSafe(a.remarks) + '">' + esc(a.remarks) + '</div>' : '')
            : '<span class="dim">—</span>', cls: 'tx-sm' },
        { label: 'By', cell: a => esc(a.user) + '<div class="dim">' + esc(a.position) + '</div>', cls: 'tx-sm' },
        { label: 'When', cell: a => '<span class="nowrap">' + esc(a.date) + '</span><div class="dim">' + esc(a.time) + '</div>' }
      ],
      rows: rows,
      empty: 'No activity recorded yet.'
    });
}

registerPage('dashboard', buildDashboard);
registerPage('reports', buildReportsPage);
registerPage('activity', buildActivityPage);

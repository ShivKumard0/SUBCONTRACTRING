/* ==========================================================================
   M-02  SUB-CONTRACTING REQUEST   (US1, US2)

   The first real transaction, and where most of the reusable machinery is
   introduced: the status machine, the reason-code modal, the activity panel,
   the line-item grids and maker-checker.
   ========================================================================== */

let scrView = 'list';        /* list | form | detail */
let scrSelected = null;
let scrDraft = null;
let scrErrors = [];

/* ── Draft ──────────────────────────────────────────────────────────────── */
function newScrDraft() {
  return {
    title: '', vendorId: '', plantId: 'PL-TRY', workType: 'Job',
    billable: true, nonBillableReason: '', interUnit: false, logistics: true, fim: false,
    rateContractId: '', remarks: '', headerText: '',
    /* FR1.3 — Project is the default base because it is the route the client
       demonstrated and the one most requests take. The Production Order half
       stays empty until the base is switched. */
    scrBase: 'Project',
    projectId: '', projectElement: '', activity: '',
    productionOrderId: '', operationFrom: '', operationTo: '', operationDesc: '',
    scrUnpeg: false,
    issueItems: [], receivableItems: []
  };
}

function openScrForm(id) {
  scrErrors = [];
  if (id) {
    const r = scr(id);
    scrDraft = JSON.parse(JSON.stringify(r));
    scrSelected = id;
  } else {
    scrDraft = newScrDraft();
    scrSelected = null;
  }
  scrView = 'form';
  renderPage();
}

function openScrDetail(id) { scrSelected = id; scrView = 'detail'; trackDeal(id); renderPage(); }
function backToScrList()   { scrView = 'list'; scrDraft = null; scrErrors = []; renderPage(); }

/* ── Listing ────────────────────────────────────────────────────────────── */
function buildScrListing() {
  const all = scrStore;
  /* Newest first, with the deal you are following pinned — orderForJourney in
     journey.js, shared with Orders and Shipments. */
  const rows = orderForJourney(all.filter(r =>
    passesFilter('Status', r.status) &&
    passesFilter('Work Type', r.workType) &&
    passesFilter('Vendor', vendor(r.vendorId).name)));

  const mine = all.filter(r => r.status === 'Sent for Approval');
  /* Each tile names the filter it applies — a count you cannot act on is
     decoration, and these were all inert. */
  const stats = [
    { label: 'All', count: all.length, onClick: 'clearFilters()' },
    { label: 'Awaiting approval', count: mine.length, filter: ['Status', 'Sent for Approval'] },
    { label: 'Approved', count: all.filter(r => r.status === 'Approved').length, filter: ['Status', 'Approved'] },
    { label: 'Returned', count: all.filter(r => r.status === 'Returned').length, filter: ['Status', 'Returned'] },
    { label: 'Closed', count: all.filter(r => r.status === 'Closed').length, filter: ['Status', 'Closed'] }
  ];

  return buildPageHead('Sub-Contracting Requests',
      'A request is the Deal that carries the whole journey: the material going out, the material expected back, the vendor, and every document produced along the way.',
      actionBtn('Create Request', 'openScrForm(\'\')', canAdd('scr') && canDo('submit'),
                'Only a Planner can raise a request.', 'btn-primary')) +
    buildListing({
      filters: [
        { label: 'Status', options: ['Created', 'Sent for Approval', 'Returned', 'Modified', 'Approved', 'Rejected', 'Closed'] },
        { label: 'Work Type', options: ['Job', 'Non-Job'] },
        { label: 'Vendor', options: vendorMaster.map(v => v.name) }
      ],
      stats: stats,
      /* Commercial density: vendor rides as a second line inside the title
         cell (frees a column), the Work Type column is gone (it said "Job"
         nine times — zero information), and Age converts every status into a
         priority. */
      columns: [
        { label: 'Request', cell: r => '<b>' + esc(r.id) + '</b>' + nowBadge(r) },
        { label: 'Title', cell: r => '<div class="cell-2l"><span class="cell-t">' + esc(r.title) + '</span>' +
            '<span class="cell-s">' + esc(vendor(r.vendorId).name) + '</span></div>' },
        { label: 'Flags', cell: r => flagText(r) },
        { label: 'Order', cell: r => { const p = poForScr(r.id); return p ? refLink(p.id) + ' ' + sbStatus(p.status) : '<span class="dim">—</span>'; } },
        { label: 'Shipments', cell: r => { const s = shipmentsForScr(r.id); return s.length ? s.length : '<span class="dim">—</span>'; }, align: 'center' },
        { label: 'Age', cell: r => ageCell(r.id), align: 'right' },
        { label: 'Status', cell: r => sbStatus(r.status) }
      ],
      rows: rows,
      onRow: r => 'openScrDetail(\'' + r.id + '\')',
      empty: 'No requests match these filters.'
    });
}

/* The five variant flags, shown only when they are true — a row of "No" chips
   would be noise, and the absence of a chip already says No. */
/* Flags are attributes, not lifecycle states. Non-Billable used to wear amber
   — a hue that says somebody is waiting — and the four flags rendered in three
   different colour languages between them. All neutral now. */
function flagChips(r) {
  const out = [];
  /* All four render only when true, so there is no on/off pair for .chip-on to
     distinguish — using it made two of four flags shout for no reason. */
  if (!r.billable) out.push('<span class="chip">Non-Billable</span>');
  if (r.interUnit) out.push('<span class="chip">Inter-Unit</span>');
  if (!r.logistics) out.push('<span class="chip">No Logistics</span>');
  if (r.fim) out.push('<span class="chip">FIM</span>');
  return out.length ? out.join(' ') : '<span class="dim">—</span>';
}

/* In a dense listing the flags are quiet grey text — a row carrying three
   pills plus two chips was shouting five things at once. Chips remain on the
   detail screens, where there is room to read them. */
function flagText(r) {
  const out = [];
  if (!r.billable) out.push('Non-billable');
  if (r.interUnit) out.push('Inter-unit');
  if (!r.logistics) out.push('No logistics');
  if (r.fim) out.push('FIM');
  return out.length ? '<span class="dim">' + esc(out.join(' · ')) + '</span>' : '<span class="dim">—</span>';
}

/* ── Form ───────────────────────────────────────────────────────────────── */
function buildScrForm() {
  const d = scrDraft;
  const editing = !!scrSelected;
  /* Inter-Unit work goes to another L&T unit, so only internal parties are
     offered — rather than letting an external vendor be chosen and failing
     validation several fields later. */
  const vendors = eligibleVendors(d.plantId, null)
    .filter(v => d.interUnit ? v.category === 'Internal' : v.category === 'External');
  const contracts = d.vendorId ? contractsFor(d.vendorId, null) : [];

  return buildPageHead(editing ? 'Edit ' + scrSelected : 'Create Sub-Contracting Request',
      'Issue Items are what goes out. Receivable Items are what comes back — they are separate lists because the processed material is a different product from the material sent.',
      '<button class="btn-outline" onclick="backToScrList()">Cancel</button>' +
      '<button class="btn-outline" onclick="saveScrDraft(false)">Save draft</button>' +
      '<button class="btn-primary" onclick="saveScrDraft(true)">Submit for approval</button>') +
    buildErrors(scrErrors) +
    buildCard('Request details',
      '<div class="form-grid">' +
        fField('Deal Title', fText('s-title', d.title, 'Shell course fabrication – Unit 4'), true) +
        fField('Plant / Warehouse', customSelect('s-plant', plant(d.plantId).name,
          activePlants().map(p => p.name), 'Select plant', '', 'onScrHeaderChange'), true) +
        /* FR1.2 — SCR Base decides which half of the next card exists at all,
           so it is asked here, high, rather than buried among the flags. */
        fField('SCR Base', customSelect('s-base', d.scrBase,
          ['Project', 'Production Order'], 'Project', '', 'onScrBaseChange'), true,
          d.scrBase === 'Production Order'
            ? 'Subcontracts a range of operations out of a routing. Comes back as WIP.'
            : 'Books cost to a project element and activity.') +
        fField(d.interUnit ? 'Receiving unit' : 'Vendor',
          customSelect('s-vendor', d.vendorId ? vendor(d.vendorId).name + ' (' + vendor(d.vendorId).category + ')' : '',
            vendors.map(v => v.name + ' (' + v.category + ')'),
            d.interUnit ? 'Select the receiving unit' : 'Select vendor', '', 'onScrHeaderChange'), true,
          d.interUnit ? 'Internal units only, because this is an inter-unit transfer.'
                      : 'Active subcontractors mapped to this plant.') +
        fField('Work Type', customSelect('s-work', d.workType, ['Job', 'Non-Job'], 'Job'), true,
          'Job = work on issued material. Recorded for reporting; it does not change the flow.') +
        fField('Billable', fToggle('s-billable', d.billable, 'Billable', 'Non-Billable', 'onBillableChange'), true,
          d.billable ? 'The buyer will price this against a rate contract.'
                     : 'Zero-value order. Finance confirms it before the buyer can raise it.') +
        /* Only asked when the answer applies. A "Non-Billable Reason" field
           sitting on screen while Billable = Yes asks a question that has no
           answer, and reads as a form that has not been thought through. */
        (d.billable ? '' :
          fField('Why is this non-billable?', customSelect('s-nbreason', d.nonBillableReason,
            reasonMaster['RC-NONBILL'].reasons, 'Choose a reason'), true,
            'Recorded against the zero-value order for audit.')) +
        fField('Inter-Unit', fToggle('s-interunit', d.interUnit, 'Yes', 'No', 'onInterUnitChange'), false,
          d.interUnit ? 'Choose the receiving unit as the vendor. The order is raised at zero value.'
                      : 'Work going to an outside subcontractor.') +
        fField('Logistics Required', fToggle('s-logistics', d.logistics, 'Yes', 'No', 'onFlagChange'), false,
          d.logistics ? 'Transport details are captured before the delivery note.'
                      : 'The logistics stage is skipped; the delivery note follows the good issue.') +
        fField('FIM', fToggle('s-fim', d.fim, 'Yes', 'No', 'onFlagChange'), false,
          'Free Issue Material — consumables supplied free alongside the issue items.') +
        /* FR1.2 requires this captured and audited. It has no downstream effect
           in the live system today — the client's own screen showed it as
           "currently not in use". It is rendered anyway, with the fact stated:
           hiding a required field makes the prototype look like it lost a
           requirement, and rendering it silently would imply it does something. */
        fField('SCR Unpeg', fToggle('s-unpeg', d.scrUnpeg, 'Yes', 'No', 'onFlagChange'), false,
          'Captured and audited. Nothing downstream reads it yet.') +
        /* Only offered to a position that will ever see the result. A planner
           could previously pick a contract and then be shown "Restricted" for
           their own choice on the very next screen. Picking a vendor now
           repaints this immediately (onScrHeaderChange), so the contract list
           is never stale. */
        (seesCommercial()
          ? fField('Rate Contract', customSelect('s-rc', d.rateContractId ? d.rateContractId : '',
              contracts.map(c => c.id + ' · ' + product(c.productId).name),
              d.vendorId ? (contracts.length ? 'None' : 'No contract for this vendor') : 'Pick a vendor first'), false,
              'Carried onto the order, where it sets and locks the rate.')
          : '') +
        fField('Team', '<input class="inp" value="' + attrSafe(currentTeam().name) + '" disabled>', false,
          'Attached automatically from the plant and process type. There is no buyer selection.') +
      '</div>' +
      '<div class="form-grid" style="--f-cols:2;margin-top:16px">' +
        fField('Remarks', fArea('s-remarks', d.remarks)) +
        fField('Header Text', fArea('s-header', d.headerText)) +
      '</div>') +
    buildScrBaseCard(d) +
    buildIssueGrid(d) +
    buildReceivableGrid(d);
}

/* ── FR1.3 · SCR Base ───────────────────────────────────────────────────────
   TWO GENUINELY DIFFERENT SECTIONS, NOT ONE WITH OPTIONAL FIELDS.

   A Project-based request books cost to an element and activity. A Production
   Order-based one subcontracts a RANGE OF OPERATIONS out of an existing
   routing and expects WIP back. They share no fields, so rendering one card
   with half of it greyed out would misrepresent the process — the FRD lists
   them as separate field sets and the client demonstrated them as separate
   screens.

   Everything read-only here is pulled from the order rather than typed. The
   planner is choosing WHICH operations go out, not restating the order. */
function buildScrBaseCard(d) {
  if (d.scrBase === 'Production Order') return buildProdOrderBase(d);
  return buildProjectBase(d);
}

function buildProjectBase(d) {
  const projects = activeProjects(d.plantId);
  const els = d.projectId ? projectElements(d.projectId) : [];
  const acts = (d.projectId && d.projectElement) ? elementActivities(d.projectId, d.projectElement) : [];
  const p = d.projectId ? project(d.projectId) : null;

  return buildCard('Project',
    '<div class="form-grid">' +
      fField('Project', customSelect('s-project', d.projectId ? d.projectId + ' · ' + p.name : '',
        projects.map(x => x.id + ' · ' + x.name), 'Select project', '', 'onProjectChange'), true,
        'Active projects at this plant only.') +
      fField('Project Element', customSelect('s-element',
        d.projectElement ? d.projectElement + ' · ' + projectElement(d.projectId, d.projectElement).name : '',
        els.map(e => e.id + ' · ' + e.name),
        d.projectId ? 'Select element' : 'Pick a project first', '', 'onElementChange'), true,
        'Only the elements of the project selected above.') +
      fField('Activity / Cost Object', customSelect('s-activity',
        d.activity ? d.activity + ' · ' + (ACTIVITY_MASTER[d.activity] || '') : '',
        acts.map(a => a.id + ' · ' + a.name),
        d.projectElement ? 'Select activity' : 'Pick an element first', '', 'onFlagChange'), false,
        'Activities belong to the element, not the project.') +
      (p ? fField('Customer', '<input class="inp" value="' + attrSafe(p.customer) + '" disabled>', false,
        'From the project master.') : '') +
    '</div>');
}

function buildProdOrderBase(d) {
  const orders = activeProductionOrders(d.plantId);
  const po = d.productionOrderId ? productionOrder(d.productionOrderId) : null;
  const routing = d.productionOrderId ? routingFor(d.productionOrderId) : [];
  /* Operation To offers the same operation or a later one — never an earlier
     one, which would subcontract the routing backwards. */
  const toOps = d.operationFrom ? operationsFrom(d.productionOrderId, d.operationFrom) : routing;

  const ro = (label, value) =>
    fField(label, '<input class="inp" value="' + attrSafe(value == null ? '' : value) + '" disabled>');

  return buildCard('Production Order',
    '<div class="form-grid">' +
      fField('Production Order', customSelect('s-prodorder',
        d.productionOrderId ? d.productionOrderId + ' · ' + po.description : '',
        orders.map(x => x.id + ' · ' + x.description), 'Select production order', '', 'onProdOrderChange'), true,
        'Closed orders are not offered.') +
    '</div>' +
    (po ? '<div class="form-grid" style="margin-top:14px">' +
        ro('Product', product(po.productId).name) +
        ro('Order Quantity', fmtQty(po.qty) + ' ' + po.uom) +
        ro('Start Date', fmtDate(po.startDate)) +
        ro('End Date', fmtDate(po.endDate)) +
        ro('Status', po.status) +
      '</div>' : '') +
    '<div class="form-grid" style="margin-top:14px">' +
      fField('Operation From', customSelect('s-opfrom',
        d.operationFrom ? opLabel(d.productionOrderId, d.operationFrom) : '',
        routing.map(o => opLabel(d.productionOrderId, o.op)),
        d.productionOrderId ? 'First outsourced operation' : 'Pick an order first', '', 'onOpFromChange'), true,
        'The first operation the subcontractor performs.') +
      fField('Operation To', customSelect('s-opto',
        d.operationTo ? opLabel(d.productionOrderId, d.operationTo) : '',
        toOps.map(o => opLabel(d.productionOrderId, o.op)),
        d.operationFrom ? 'Last outsourced operation' : 'Pick Operation From first', '', 'onFlagChange'), true,
        'The same operation or a later one. Never earlier.') +
    '</div>' +
    '<div class="form-grid" style="--f-cols:1;margin-top:14px">' +
      fField('Operation to be carried out by the subcontractor',
        fArea('s-opdesc', d.operationDesc,
          'Bend to profile and hot-dip galvanise; return for final inspection.'), true) +
    '</div>' +
    (routing.length ? buildRoutingStrip(d, routing) : ''));
}

/* "20 · Bending" — the operation number is what the routing is keyed on, the
   name is what a person recognises. Both, because the planner is reading a
   routing they know and the auditor is matching an operation number. */
function opLabel(poId, op) {
  const o = routingFor(poId).find(x => String(x.op) === String(op));
  return o ? o.op + ' · ' + o.name : String(op);
}

/* The routing, with the outsourced span marked. The client's own example was
   cutting in house, bending and plating out — a range is far easier to check
   at a glance than two dropdown values several fields apart. */
function buildRoutingStrip(d, routing) {
  const from = routing.find(o => String(o.op) === String(d.operationFrom));
  const to   = routing.find(o => String(o.op) === String(d.operationTo));
  const cells = routing.map(o => {
    const out = from && to && o.seq >= from.seq && o.seq <= to.seq;
    return '<div class="rt-op' + (out ? ' rt-out' : '') + '">' +
      '<span class="rt-num">' + esc(o.op) + '</span>' +
      '<span class="rt-name">' + esc(o.name) + '</span>' +
      '<span class="rt-where">' + (out ? 'Subcontracted' : 'In house') + '</span></div>';
  }).join('');
  return '<div class="rt-strip">' + cells + '</div>';
}

function buildIssueGrid(d) {
  const rows = d.issueItems.map((l, i) =>
    '<tr>' +
      '<td class="mono">' + (i + 1) + '</td>' +
      '<td>' + esc(product(l.productId).name) + '<div class="dim">' + esc(product(l.productId).type) + '</div></td>' +
      '<td class="ta-right">' + fmtQty(l.qty) + '</td>' +
      '<td>' + esc(l.uom) + '</td>' +
      '<td>' + esc(storageLocation(d.plantId, l.locationId).name || '—') + '</td>' +
      '<td>' + esc(product(l.productId).hsn) + '</td>' +
      '<td>' + esc(l.reasonRemoval || '—') + '</td>' +
      '<td class="ta-right">' + fmtQty(availableQty(l.productId, d.plantId, null)) + '</td>' +
      '<td><button class="line-x" onclick="removeIssueLine(' + i + ')" aria-label="Remove line">&times;</button></td>' +
    '</tr>').join('');
  return buildCard('Issue Items — material going out',
    '<div class="lines-wrap"><table class="lines"><thead><tr>' +
      '<th>#</th><th>Product</th><th class="ta-right">Quantity</th><th>UOM</th>' +
      '<th>Storage location</th><th>HSN</th><th>Reason for removal</th>' +
      '<th class="ta-right">Available</th><th></th>' +
    '</tr></thead><tbody>' + (rows || '<tr><td colspan="9" class="dim" style="padding:18px;text-align:center">No issue items yet.</td></tr>') +
    '</tbody></table></div>',
    '<button class="btn-outline btn-sm" onclick="addIssueLine()">Add issue item</button>');
}

function buildReceivableGrid(d) {
  const rows = d.receivableItems.map((l, i) =>
    '<tr>' +
      '<td class="mono">' + (i + 1) + '</td>' +
      '<td>' + esc(product(l.productId).name) + '<div class="dim">' + esc(product(l.productId).type) + '</div></td>' +
      '<td class="ta-right">' + fmtQty(l.qty) + '</td>' +
      '<td>' + esc(l.uom) + '</td>' +
      '<td class="nowrap">' + esc(fmtDate(l.expectedDate) || '—') + '</td>' +
      '<td>' + esc(product(l.productId).hsn) + '</td>' +
      '<td>' + (d.interUnit ? esc(vendor(d.vendorId).name) : '<span class="dim">—</span>') + '</td>' +
      '<td><button class="line-x" onclick="removeReceivableLine(' + i + ')" aria-label="Remove line">&times;</button></td>' +
    '</tr>').join('');
  return buildCard('Receivable Items — material expected back',
    '<div class="lines-wrap"><table class="lines"><thead><tr>' +
      '<th>#</th><th>Product</th><th class="ta-right">Expected qty</th><th>UOM</th>' +
      '<th>Expected receipt</th><th>HSN</th><th>Inter-unit supplier</th><th></th>' +
    '</tr></thead><tbody>' + (rows || '<tr><td colspan="8" class="dim" style="padding:18px;text-align:center">No receivable items yet.</td></tr>') +
    '</tbody></table></div>',
    '<button class="btn-outline btn-sm" onclick="addReceivableLine()">Add receivable item</button>');
}

/* ── Line editors ───────────────────────────────────────────────────────── */
function addIssueLine() {
  captureScrHeader();
  const d = scrDraft;
  const locs = (plant(d.plantId).locations || []).filter(l => l.role === 'Main');
  openModal('Add issue item',
    '<div id="li-err"></div><div class="form-grid" style="--f-cols:2">' +
      fField('Product', customSelect('li-product', '',
        activeProducts().filter(p => p.type === 'Raw').map(p => p.name), 'Select material'), true) +
      fField('Quantity', fNum('li-qty', '', '0.000'), true) +
      fField('Storage location', customSelect('li-loc', locs.length ? locs[0].name : '',
        locs.map(l => l.name), 'Select location'), true) +
      fField('Reason for removal', customSelect('li-reason', '',
        reasonMaster['RC-REMOVAL'].reasons, 'Select reason'), true) +
    '</div>', 'Add item', () => {
      const p = productMaster.find(x => x.name === getSelectValue('li-product'));
      const qty = numValue('li-qty');
      const loc = (plant(d.plantId).locations || []).find(l => l.name === getSelectValue('li-loc'));
      const reason = getSelectValue('li-reason');
      const errs = [];
      if (!p) errs.push('Select a product.');
      if (!(qty > 0)) errs.push('Quantity must be greater than zero.');
      if (!loc) errs.push('Select a storage location.');
      if (!reason) errs.push('Reason for Removal is required.');
      if (p && qty > 0) {
        const avail = availableQty(p.id, d.plantId, null);
        if (qty > avail) errs.push('Only ' + fmtQty(avail) + ' ' + p.uom +
          ' is available. The rest is reserved for another request.');
      }
      if (errs.length) { document.getElementById('li-err').innerHTML = buildErrors(errs); return false; }
      d.issueItems.push({ line: d.issueItems.length + 1, productId: p.id, qty: qty,
        uom: p.uom, plantId: d.plantId, locationId: loc.id, hsn: p.hsn,
        taxCode: 'GST ' + p.taxPct + '%', reasonRemoval: reason, fim: d.fim });
      renderPage();
      return true;
    });
}

function addReceivableLine() {
  captureScrHeader();
  const d = scrDraft;
  openModal('Add receivable item',
    '<div id="li-err"></div><div class="form-grid" style="--f-cols:2">' +
      fField('Product', customSelect('li-product', '',
        activeProducts().filter(p => p.type !== 'Raw').map(p => p.name), 'Select expected output'), true) +
      fField('Expected quantity', fNum('li-qty', '', '0.000'), true) +
      fField('Expected receipt date', fDate('li-date', ''), true) +
    '</div>', 'Add item', () => {
      const p = productMaster.find(x => x.name === getSelectValue('li-product'));
      const qty = numValue('li-qty');
      const date = inputValue('li-date');
      const errs = [];
      if (!p) errs.push('Select a product.');
      if (!(qty > 0)) errs.push('Expected quantity must be greater than zero.');
      if (!date) errs.push('Expected Receipt Date is required.');
      if (errs.length) { document.getElementById('li-err').innerHTML = buildErrors(errs); return false; }
      d.receivableItems.push({ line: d.receivableItems.length + 1, productId: p.id,
        qty: qty, uom: p.uom, expectedDate: date, hsn: p.hsn });
      renderPage();
      return true;
    });
}

function removeIssueLine(i) {
  captureScrHeader();
  scrDraft.issueItems.splice(i, 1);
  scrDraft.issueItems.forEach((l, n) => l.line = n + 1);
  renderPage();
}
function removeReceivableLine(i) {
  captureScrHeader();
  scrDraft.receivableItems.splice(i, 1);
  scrDraft.receivableItems.forEach((l, n) => l.line = n + 1);
  renderPage();
}

/* Header values live in the DOM until something forces a repaint, so they are
   captured before any action that rebuilds the page — otherwise adding a line
   would silently discard a half-filled form. */
/* A flag that changes which fields apply repaints the form. captureScrHeader
   runs first, so nothing typed so far is lost. */
function onBillableChange(on) {
  captureScrHeader();
  scrDraft.billable = on;
  if (on) scrDraft.nonBillableReason = '';   /* the question no longer applies */
  renderPage();
}
function onInterUnitChange(on) {
  captureScrHeader();
  scrDraft.interUnit = on;
  /* An inter-unit deal must go to an internal unit; an external vendor is no
     longer a valid answer, so a stale choice is cleared rather than left to
     fail validation later. */
  if (on && scrDraft.vendorId && vendor(scrDraft.vendorId).category !== 'Internal') scrDraft.vendorId = '';
  if (!on && scrDraft.vendorId && vendor(scrDraft.vendorId).category === 'Internal') scrDraft.vendorId = '';
  renderPage();
}
function onFlagChange() { captureScrHeader(); renderPage(); }

/* ── SCR Base handlers ──────────────────────────────────────────────────────
   EVERY ONE OF THESE CLEARS WHAT IT INVALIDATES.

   These are dependent choices: an element belongs to a project, an activity
   to an element, Operation To to Operation From. Leaving a stale downstream
   value behind after the thing above it changes is the exact fault the FRD
   calls out — "if the selected Production Order is changed, Operation From
   and Operation To shall be cleared" — and it fails late, at submit, pointing
   at a field the user never touched. */
function onScrBaseChange(value) {
  captureScrHeader();
  scrDraft.scrBase = value;
  /* The other branch's answers are not merely unused, they are wrong for the
     base now selected — a project element cannot describe a routing. */
  if (value === 'Project') {
    scrDraft.productionOrderId = ''; scrDraft.operationFrom = '';
    scrDraft.operationTo = ''; scrDraft.operationDesc = '';
  } else {
    scrDraft.projectId = ''; scrDraft.projectElement = ''; scrDraft.activity = '';
  }
  renderPage();
}

function onProjectChange(value) {
  captureScrHeader();
  scrDraft.projectId = String(value).split(' · ')[0];
  scrDraft.projectElement = '';       /* elements belong to the project */
  scrDraft.activity = '';
  renderPage();
}

function onElementChange(value) {
  captureScrHeader();
  scrDraft.projectElement = String(value).split(' · ')[0];
  scrDraft.activity = '';             /* activities belong to the element */
  renderPage();
}

function onProdOrderChange(value) {
  captureScrHeader();
  scrDraft.productionOrderId = String(value).split(' · ')[0];
  scrDraft.operationFrom = '';        /* FR1.3, stated explicitly */
  scrDraft.operationTo = '';
  renderPage();
}

function onOpFromChange(value) {
  captureScrHeader();
  scrDraft.operationFrom = String(value).split(' · ')[0];
  /* An Operation To that now sits BEFORE the new From is no longer a valid
     answer. Clearing only when it is actually invalid keeps a still-legal
     choice rather than making the user pick it again. */
  const ops = operationsFrom(scrDraft.productionOrderId, scrDraft.operationFrom);
  if (scrDraft.operationTo && !ops.some(o => String(o.op) === String(scrDraft.operationTo)))
    scrDraft.operationTo = '';
  renderPage();
}
/* Vendor or plant changed → the dependent rate-contract list must follow. */
function onScrHeaderChange() { captureScrHeader(); renderPage(); }

function captureScrHeader() {
  const d = scrDraft;
  if (!d || !document.getElementById('s-title')) return;
  d.title = inputValue('s-title');
  const pl = plantMaster.find(x => x.name === getSelectValue('s-plant'));
  if (pl) d.plantId = pl.id;
  const vname = getSelectValue('s-vendor').replace(/ \((Internal|External)\)$/, '');
  const v = vendorMaster.find(x => x.name === vname);
  d.vendorId = v ? v.id : '';
  d.workType = getSelectValue('s-work') || 'Job';
  d.billable = toggleValue('s-billable');
  /* The field only exists while it applies; keep what was chosen otherwise. */
  if (document.getElementById('s-nbreason')) d.nonBillableReason = getSelectValue('s-nbreason');
  d.interUnit = toggleValue('s-interunit');
  d.logistics = toggleValue('s-logistics');
  d.fim = toggleValue('s-fim');
  d.scrUnpeg = toggleValue('s-unpeg');

  /* SCR Base and its branch. Each field is read only if it is on screen —
     the two halves never coexist, so testing for the element is what keeps
     the absent branch's stored answers intact rather than blanking them. */
  d.scrBase = getSelectValue('s-base') || d.scrBase || 'Project';
  if (document.getElementById('s-project'))
    d.projectId = (getSelectValue('s-project') || '').split(' · ')[0];
  if (document.getElementById('s-element'))
    d.projectElement = (getSelectValue('s-element') || '').split(' · ')[0];
  if (document.getElementById('s-activity'))
    d.activity = (getSelectValue('s-activity') || '').split(' · ')[0];
  if (document.getElementById('s-prodorder'))
    d.productionOrderId = (getSelectValue('s-prodorder') || '').split(' · ')[0];
  if (document.getElementById('s-opfrom'))
    d.operationFrom = (getSelectValue('s-opfrom') || '').split(' · ')[0];
  if (document.getElementById('s-opto'))
    d.operationTo = (getSelectValue('s-opto') || '').split(' · ')[0];
  if (document.getElementById('s-opdesc'))
    d.operationDesc = inputValue('s-opdesc');
  if (document.getElementById('s-rc')) {
    const rc = getSelectValue('s-rc');
    d.rateContractId = rc ? rc.split(' · ')[0] : '';
  }
  d.remarks = inputValue('s-remarks');
  d.headerText = inputValue('s-header');
}

function saveScrDraft(submit) {
  captureScrHeader();
  const d = scrDraft;

  if (scrSelected) {
    const r = scr(scrSelected);
    Object.assign(r, d);
    r.orderType = r.billable ? 'Billable' : 'Non-Billable';
    if (r.status === 'Returned') modifyScr(r.id);
    else logAction(r.id, 'Request updated', {});
    if (submit) {
      const res = submitScr(r.id);
      if (!res.ok) { scrErrors = res.errors; renderPage(); return; }
      toast('Request ' + r.id + ' submitted for approval.');
      scrView = 'detail';
    } else { toast('Draft saved.'); scrView = 'detail'; }
    scrErrors = [];
    renderPage();
    return;
  }

  /* Validate BEFORE creating, so a failed submit does not leave an orphan
     request in the list that the user then has to clean up. */
  const probe = Object.assign({ id: '(new)', status: 'Created' }, d);
  const errs = validateScr(probe);
  if (submit && errs.length) { scrErrors = errs; renderPage(); return; }
  if (!submit && !d.title) { scrErrors = ['Deal Title is required, even on a draft.']; renderPage(); return; }

  const rec = createScr(d);
  scrSelected = rec.id;
  /* The request you just raised becomes the one the whole app is following:
     it heads the listing and the journey bar narrates it. Without this a new
     request joined nine others with nothing marking which one was yours. */
  trackDeal(rec.id);
  if (submit) {
    const res = submitScr(rec.id);
    if (!res.ok) { scrErrors = res.errors; scrView = 'form'; renderPage(); return; }
    toast('Request ' + rec.id + ' submitted for approval.');
  } else toast('Request ' + rec.id + ' saved as a draft.');
  scrErrors = [];
  scrView = 'detail';
  renderPage();
}

/* ── Detail ─────────────────────────────────────────────────────────────── */
function buildScrDetail() {
  const r = scr(scrSelected);
  if (!r) { scrView = 'list'; return buildScrListing(); }
  const p = poForScr(r.id);
  const v = vendor(r.vendorId);
  const canApprove = canDo('approve-scr') && r.status === 'Sent for Approval';
  const blocked = sameUserBlocked(r, 'approve-scr');
  const editable = (r.status === 'Created' || r.status === 'Returned' || r.status === 'Modified') &&
                   canEdit('scr') && canDo('submit');

  let actions = '<button class="btn-outline" onclick="backToScrList()">Back</button>';
  /* Straight into the quantity step from the record itself — the whole reason
     the planner is standing here. */
  if (r.status === 'Approved' && p && p.status === 'Approved' &&
      r.issueItems.some(l => openIssueQty(r.id, l.line) > 0.001) && canDo('create-shipment'))
    actions += '<button class="btn-primary" onclick="startShipmentFor(\'' + r.id + '\')">Create shipment</button>';
  if (editable) actions += '<button class="btn-outline" onclick="openScrForm(\'' + r.id + '\')">Edit</button>';
  if (editable && r.status !== 'Created')
    actions += '<button class="btn-primary" onclick="resubmitScr(\'' + r.id + '\')">Resubmit</button>';
  if (editable && r.status === 'Created')
    actions += '<button class="btn-primary" onclick="submitScrNow(\'' + r.id + '\')">Submit for approval</button>';
  if (r.status === 'Sent for Approval') {
    actions += actionBtn('Reject', 'rejectScrAction(\'' + r.id + '\')', canApprove && !blocked,
      blocked ? 'Maker-checker: you submitted this request.' : 'Only the approver can reject.');
    actions += actionBtn('Return', 'returnScrAction(\'' + r.id + '\')', canApprove && !blocked,
      blocked ? 'Maker-checker: you submitted this request.' : 'Only the approver can return.');
    actions += actionBtn('Approve', 'approveScrAction(\'' + r.id + '\')', canApprove && !blocked,
      blocked ? 'Maker-checker: you submitted this request, so you cannot approve it.' : 'Only the approver can approve.',
      'btn-primary');
  }

  return buildPageHead(r.id + ' · ' + r.title,
      'Raised ' + esc(r.createdOn) + ' · ' + esc(currentTeam().name), actions) +
    buildNextStep(r.id) +
    buildStageBar(journeyIndex(r.id)) +
    (r.status === 'Returned' && r.reason ?
      buildNotice('<b>Returned for correction.</b> ' + esc(r.reason) +
        (r.remarks ? ' — ' + esc(r.remarks) : ''), 'wait') : '') +
    (r.status === 'Rejected' && r.reason ?
      buildNotice('<b>Rejected.</b> ' + esc(r.reason) + (r.remarks ? ' — ' + esc(r.remarks) : ''), 'idle') : '') +
    /* The "what happens next" panel already names who holds this and offers to
       continue as them. A notice repeating it — and telling you to use the top
       bar instead — was the same fact stated a third time, in a third visual
       weight, with conflicting instructions. */
    '<div class="split"><div>' +
      buildCard('Request', buildFieldGrid([
        ['Status', sbStatus(r.status)],
        ['Deal Type', esc(r.dealType)],
        ['Sub-type', esc(r.subType)],
        ['Order Category', esc(r.orderCategory)],
        ['Order Type', esc(r.orderType)],
        ['Work Type', esc(r.workType)],
        ['Vendor', esc(v.name) + ' <span class="dim">(' + esc(v.category) + ')</span>'],
        ['Vendor GSTIN', '<span class="mono">' + esc(v.gstin) + '</span>'],
        ['Plant', esc(plant(r.plantId).name)],
        ['Billable', r.billable ? 'Yes' : 'No — ' + esc(r.nonBillableReason || 'reason missing')],
        ['Inter-Unit', r.interUnit ? 'Yes · order value 0' : 'No'],
        ['Logistics', r.logistics ? 'Required' : 'Skipped'],
        ['FIM', r.fim ? 'Yes' : 'No'],
        ['Rate Contract', r.rateContractId ? maskCommercial(esc(r.rateContractId)) : '<span class="fg-none">None</span>'],
        ['Order / PO', p ? refLink(p.id) + ' ' + sbStatus(p.status) : '<span class="fg-none">Not yet created</span>'],
        ['Remarks', esc(r.remarks)],
        ['Header Text', esc(r.headerText)]
      ], 3)) +
      buildScrBaseDetail(r) +
      buildBomCard(r) +
      buildScrDocumentsCard(r) +
      buildCard('Issue Items', scrLineTable(r, 'issue')) +
      buildCard('Receivable Items', scrLineTable(r, 'receivable')) +
    '</div><div>' + buildActivityPanelHTML(r.id) + '</div></div>';
}

/* ── FR3 on the detail screen ───────────────────────────────────────────────
   Stage 03 has no actor and no screen of its own, which is precisely why it
   needs to leave something visible. The BOM ratio derived at approval is the
   number stage 17 consumes issue material against — the fix for the client's
   loudest complaint — and until now it existed only inside the ledger.

   Shown with its arithmetic spelled out rather than as a bare figure: "2.500
   KG per PCS" is checkable, "2.5" is something you either trust or do not. */
function buildBomCard(r) {
  const s = r.bomProcessed;
  if (!s || !s.bom.length) return '';

  const rows = s.bom.map(b =>
    '<tr>' +
      '<td>' + esc(product(b.issue).name) + '</td>' +
      '<td>' + esc(product(b.receivable).name) + '</td>' +
      '<td class="ta-right mono">' + fmtQty(b.ratio) + '</td>' +
      '<td>' + esc(product(b.issue).uom) + ' per ' + esc(product(b.receivable).uom) + '</td>' +
      '<td class="dim">' + esc(b.source) + '</td>' +
    '</tr>').join('');

  const made = s.products.filter(p => p.action === 'created');
  const note = made.length
    ? buildNotice('<b>' + esc(made.map(p => p.id).join(', ')) +
        '</b> created as a WIP product and held at Pending. It becomes Active on the first confirmed receipt.', 'wait')
    : '';

  /* Plain ampersand — buildCard escapes the title itself, so an entity here
     comes out as literal "&amp;" on screen. */
  return buildCard('Product and BOM processing',
    note +
    '<p class="card-note">Derived automatically when the request was approved. ' +
    'Consumption at stage 17 is calculated as <b>Received &times; Ratio</b> against these figures.</p>' +
    '<div class="lines-wrap"><table class="lines"><thead><tr>' +
      '<th>Issue item</th><th>Receivable item</th><th class="ta-right">Ratio</th><th>Basis</th><th>Source</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>');
}

/* ── FR1.3 on the detail screen ─────────────────────────────────────────────
   The base is what the whole request is costed against, so it gets its own
   card rather than four more rows in a grid of sixteen. For a Production
   Order it also carries the routing strip, because "operations 20 to 30" is
   an answer only somebody holding the routing can check — and the strip puts
   the routing right there. */
function buildScrBaseDetail(r) {
  if (r.scrBase === 'Production Order') {
    const po = productionOrder(r.productionOrderId);
    return buildCard('Production Order', buildFieldGrid([
        ['SCR Base', 'Production Order'],
        ['Production Order', esc(r.productionOrderId)],
        ['Product', esc(product(po.productId).name || '')],
        ['Order Quantity', po.qty != null ? fmtQty(po.qty) + ' ' + esc(po.uom) : ''],
        ['Window', esc(fmtDate(po.startDate)) + ' – ' + esc(fmtDate(po.endDate))],
        ['Status', esc(po.status || '')],
        ['Operation From', esc(opLabel(r.productionOrderId, r.operationFrom))],
        ['Operation To', esc(opLabel(r.productionOrderId, r.operationTo))],
        ['Subcontracted work', esc(r.operationDesc || '')]
      ], 3) + buildRoutingStrip(r, routingFor(r.productionOrderId)));
  }
  const p = project(r.projectId);
  return buildCard('Project', buildFieldGrid([
      ['SCR Base', 'Project'],
      ['Project', esc(r.projectId) + (p.name ? ' <span class="dim">' + esc(p.name) + '</span>' : '')],
      ['Customer', esc(p.customer || '')],
      ['Element', r.projectElement
        ? esc(r.projectElement) + ' <span class="dim">' + esc(projectElement(r.projectId, r.projectElement).name || '') + '</span>'
        : '<span class="fg-none">Not set</span>'],
      ['Activity / Cost Object', r.activity
        ? esc(r.activity) + ' <span class="dim">' + esc(ACTIVITY_MASTER[r.activity] || '') + '</span>'
        : '<span class="fg-none">Not set</span>'],
      ['SCR Unpeg', r.scrUnpeg ? 'Yes' : 'No']
    ], 3));
}

/* THE REQUEST IS THE HUB. Its own subtitle promises it "carries every document
   produced along the way" — yet nothing on this screen listed a single one,
   and reaching a shipment meant going to the Shipments page and scanning.
   Every movement and document against the deal, each one a link. */
function buildScrDocumentsCard(r) {
  const rows = [];
  shipmentsForScr(r.id).forEach(s => {
    rows.push({ kind: 'Shipment', id: s.id, extra: s.direction, status: s.status });
    const d = dnoteForShipment(s.id);
    if (d) rows.push({ kind: 'Delivery Note', id: d.id, extra: 'for ' + s.id, status: d.status });
    const c = challanForShipment(s.id);
    if (c) {
      rows.push({ kind: 'Challan', id: c.id, extra: c.returnByDate ? 'return by ' + c.returnByDate : '', status: c.status });
      imrsForChallan(c.id).forEach(i =>
        rows.push({ kind: 'Receipt', id: i.id, extra: 'against ' + c.id, status: i.status }));
    }
  });
  if (!rows.length) return '';
  return buildCard('Documents & movements',
    '<div class="lines-wrap"><table class="lines"><thead><tr>' +
    '<th>Type</th><th>Document</th><th>Detail</th><th>Status</th>' +
    '</tr></thead><tbody>' + rows.map(x =>
      '<tr><td>' + esc(x.kind) + '</td>' +
      '<td>' + refLink(x.id) + '</td>' +
      '<td class="dim">' + esc(x.extra || '—') + '</td>' +
      '<td>' + sbStatus(x.status) + '</td></tr>').join('') +
    '</tbody></table></div>');
}

function scrLineTable(r, kind) {
  const issue = kind === 'issue';
  const lines = issue ? r.issueItems : r.receivableItems;
  if (!lines.length) return '<div class="lst-empty">No lines.</div>';
  const head = issue
    ? '<th>#</th><th>Product</th><th class="ta-right">Issue qty</th><th>UOM</th><th class="ta-right">Open</th><th>Location</th><th>Reason</th>'
    : '<th>#</th><th>Product</th><th class="ta-right">Expected</th><th class="ta-right">Received</th><th class="ta-right">Outstanding</th><th>UOM</th><th>Expected on</th><th>Status</th>';
  const body = lines.map(l => {
    if (issue) {
      return '<tr><td class="mono">' + l.line + '</td><td>' + esc(product(l.productId).name) + '</td>' +
        '<td class="ta-right">' + fmtQty(l.qty) + '</td><td>' + esc(l.uom) + '</td>' +
        '<td class="ta-right">' + fmtQty(openIssueQty(r.id, l.line)) + '</td>' +
        '<td>' + esc(storageLocation(r.plantId, l.locationId).name || '—') + '</td>' +
        '<td class="dim">' + esc(l.reasonRemoval || '—') + '</td></tr>';
    }
    const got = receivableReceived(r.id, l.line);
    const out = receivableOutstanding(r.id, l.line);
    const st = l.shortClosed ? 'Short-Closed' : out <= 0.001 ? 'Fully Received'
             : got > 0 ? 'Partially Received' : 'Open';
    return '<tr><td class="mono">' + l.line + '</td><td>' + esc(product(l.productId).name) + '</td>' +
      '<td class="ta-right">' + fmtQty(l.qty) + '</td>' +
      '<td class="ta-right">' + fmtQty(got) + '</td>' +
      '<td class="ta-right">' + fmtQty(out) + '</td>' +
      '<td>' + esc(l.uom) + '</td><td class="nowrap">' + esc(fmtDate(l.expectedDate)) + '</td>' +
      '<td>' + sbStatus(st) + '</td></tr>';
  }).join('');
  return '<div class="lines-wrap"><table class="lines"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
}

/* ── Actions ────────────────────────────────────────────────────────────── */
function submitScrNow(id) {
  const res = submitScr(id);
  if (!res.ok) { scrErrors = res.errors; scrView = 'form'; scrDraft = JSON.parse(JSON.stringify(scr(id))); renderPage(); return; }
  toast(handoffMsg(id, 'Submitted.'));
  renderPage();
}
function resubmitScr(id) {
  const res = submitScr(id);
  if (!res.ok) { scrErrors = res.errors; renderPage(); return; }
  toast(handoffMsg(id, 'Resubmitted.'));
  renderPage();
}
function approveScrAction(id) {
  openConfirm('Approve request',
    'Approving creates the linked Order automatically and carries the vendor, products and quantities forward. Continue?',
    'Approve', () => {
      const res = approveScr(id);
      if (!res.ok) { toast(res.error, 'bad'); return; }
      toast(handoffMsg(id, 'Approved. Order ' + res.po.id + ' raised.'));
      renderPage();
    });
}
function returnScrAction(id) {
  openReasonModal('RC-SCRRET', 'Return for correction', (reason, remarks) => {
    const res = returnScr(id, reason, remarks);
    if (!res.ok) { toast(res.error, 'bad'); return; }
    toast('Returned to the planner.');
    renderPage();
  });
}
function rejectScrAction(id) {
  openReasonModal('RC-SCRREJ', 'Reject request', (reason, remarks) => {
    const res = rejectScr(id, reason, remarks);
    if (!res.ok) { toast(res.error, 'bad'); return; }
    toast('Request rejected.');
    renderPage();
  });
}

registerPage('scr', () =>
  scrView === 'form' ? buildScrForm() :
  scrView === 'detail' ? buildScrDetail() : buildScrListing());

/* ══════════════════════════════════════════════════════════════════════════
   STAGE 02 ON A PHONE  —  FR2 / User Story 2

   THE THREE ACTIONS ARE THE SAME FUNCTIONS THE WEB SCREEN CALLS.
   approveScrAction, returnScrAction and rejectScrAction are reused verbatim,
   which means the maker-checker rule, the reason master and the "Other forces
   remarks" validation cannot behave differently on a phone. That is not a
   convenience — it is the claim this whole build is making, and implementing
   it twice would quietly falsify it.

   What IS different is the reading. An approver on a phone wants the headline,
   then the exception, then the detail only if something looks wrong — so the
   sections are collapsed, the previous return reason is promoted to the top,
   and the actions sit at the thumb rather than at the end of a scroll.
   ========================================================================== */
function buildMobileScr() {
  const id = activeDeal();
  const st = id ? dealStage(id) : null;
  const s = st && st.stage;
  /* The review screen is shown only when this really is the person the deal is
     waiting on. Anyone else gets their own queue, which for them is the
     correct and more useful answer. */
  if (s && s.id === 'scr-approve' && isMyStage(s)) return buildMobileScrApproval(scr(id));
  return buildMobilePending();
}

function buildMobileScrApproval(r) {
  const v = vendor(r.vendorId);
  const blocked = sameUserBlocked(r, 'approve-scr');

  const head =
    '<div class="mob-rec">' +
      '<span class="mob-rec-id">' + esc(r.id) + '</span>' +
      '<span class="mob-rec-title">' + esc(r.title) + '</span>' +
      '<span class="mob-rec-foot">' + sbStatus(r.status) +
        '<span class="mob-rec-vendor">' + esc(v.name || '') + '</span></span>' +
    '</div>';

  /* FR1.3 — the base half that actually applies, never both. */
  const baseRows = r.scrBase === 'Production Order'
    ? [ { label: 'SCR Base', value: 'Production Order' },
        { label: 'Production Order', value: esc(r.productionOrderId) },
        { label: 'Operations out', value: r.operationFrom
            ? esc(opLabel(r.productionOrderId, r.operationFrom)) + ' &rarr; ' +
              esc(opLabel(r.productionOrderId, r.operationTo)) : '' },
        { label: 'Work', value: esc(r.operationDesc || '') } ]
    : [ { label: 'SCR Base', value: 'Project' },
        { label: 'Project', value: esc(r.projectId) },
        { label: 'Element', value: r.projectElement
            ? esc(r.projectElement + ' · ' + projectElement(r.projectId, r.projectElement).name) : '' },
        { label: 'Activity', value: r.activity
            ? esc(r.activity + ' · ' + (ACTIVITY_MASTER[r.activity] || '')) : '' } ];

  const issue = r.issueItems.map(l =>
    ({ label: product(l.productId).name, value: fmtQty(l.qty) + ' ' + esc(l.uom) }));
  const recv = r.receivableItems.map(l =>
    ({ label: product(l.productId).name, value: fmtQty(l.qty) + ' ' + esc(l.uom) }));

  /* The relationship the approver is really signing off: what goes out, what
     comes back, and at what ratio. It is the number the reconciliation
     fifteen stages later consumes against, so it is worth showing here rather
     than leaving it implicit in two separate lists. */
  const bom = [];
  r.receivableItems.forEach(rc => {
    r.issueItems.forEach(is => {
      const ratio = bomRatio(is.productId, rc.productId);
      if (ratio == null) return;
      bom.push({ label: product(is.productId).name + ' → ' + product(rc.productId).name,
                 value: fmtQty(ratio) + ' ' + product(is.productId).uom + ' per ' + product(rc.productId).uom });
    });
  });

  const flags = [];
  if (!r.billable) flags.push('Non-billable · ' + (r.nonBillableReason || ''));
  if (r.interUnit) flags.push('Inter-unit');
  if (!r.logistics) flags.push('No logistics');
  if (r.fim) flags.push('FIM');

  const body =
    head +
    mobReturnBanner(r) +
    mobSection('Request', [
      { label: 'Raised by', value: esc(USERS[r.submittedBy || r.createdBy].name) },
      { label: 'Plant', value: esc(plant(r.plantId).name) },
      { label: 'Work Type', value: esc(r.workType) },
      { label: 'Billable', value: r.billable ? 'Yes' : 'No' },
      { label: 'Flags', value: flags.length ? esc(flags.join(' · ')) : '—' }
    ], true) +
    mobSection(r.scrBase === 'Production Order' ? 'Production Order' : 'Project', baseRows, true) +
    mobSection('Vendor', [
      { label: r.interUnit ? 'Receiving unit' : 'Vendor', value: esc(v.name || '') },
      { label: 'Category', value: esc(v.category || '') },
      { label: 'GSTIN', value: esc(v.gstin || '') }
    ]) +
    /* OPEN, AND IN THE FORM'S OWN ORDER.
       The material is the thing being signed off, so hiding it behind a tap
       while the action bar sits pinned invites approval without reading it.
       Issue before Receivable matches the creation form's stated order —
       what goes out, then what comes back. */
    mobSection('Issue items — what goes out', issue, true) +
    mobSection('Receivable — what comes back', recv, true) +
    mobSection('BOM relationship', bom) +
    (blocked
      ? buildMobileBlockNote('You raised this request. Maker-checker means somebody else has to approve it.')
      : '') +
    /* ORDER IS THE BUTTON CONTRACT, NOT A PREFERENCE.
       buttons.css: "In an Approve/Reject pair the DESTRUCTIVE one sits LEFT
       and outlined, the affirmative one sits RIGHT and filled." The web
       detail screen already obeys it. Emitting Approve-first here taught two
       opposite habits for the same decision, and put the filled affirmative
       exactly where a thumb lands by default. */
    buildMobileActions([
      { label: 'Reject', fn: "rejectScrAction('" + attrSafe(r.id) + "')",
        blocked: blocked ? 'You submitted this request' : null },
      { label: 'Return', fn: "returnScrAction('" + attrSafe(r.id) + "')",
        blocked: blocked ? 'You submitted this request' : null },
      { label: 'Approve', tone: 'primary', fn: "approveScrAction('" + attrSafe(r.id) + "')",
        blocked: blocked ? 'You submitted this request' : null }
    ]);

  return body;
}

registerMobile('scr', buildMobileScr);

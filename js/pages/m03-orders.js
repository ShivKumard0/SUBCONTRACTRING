/* ==========================================================================
   M-03  ORDER / PO   (US3, US4, and US18 restored)

   A Draft order is created automatically the moment a request is approved,
   carrying everything already known so the Buyer re-enters nothing.

   COMMERCIAL MASKING LIVES HERE MOST VISIBLY.  Every price on this screen
   passes through maskCommercial(), so a Planner or a Stores user who can open
   the order still sees no money — the RBAC rule that Team access alone cannot
   deliver.
   ========================================================================== */

let poView = 'list';
let poSelected = null;
let poErrors = [];

function openPoDetail(id) { poSelected = id; poView = 'detail'; poErrors = []; renderPage(); }
function backToPoList()   { poView = 'list'; poErrors = []; renderPage(); }

/* ── Listing ────────────────────────────────────────────────────────────── */
function buildPoListing() {
  const all = poStore;
  const rows = orderForJourney(all.filter(p =>
    passesFilter('Status', p.status) &&
    passesFilter('Order Type', p.orderType) &&
    passesFilter('Vendor', vendor(p.vendorId).name)));

  return buildPageHead('Sub-Contracting Orders',
      'One order per approved request, created automatically. Non-Billable and Inter-Unit orders are still created and still approved — their value is simply zero.') +
    buildListing({
      filters: [
        { label: 'Status', options: ['Draft', 'Created', 'Approved', 'Short-Closed', 'Closed'] },
        { label: 'Order Type', options: ['Billable', 'Non-Billable'] },
        { label: 'Vendor', options: vendorMaster.map(v => v.name) }
      ],
      stats: [
        { label: 'All', count: all.length, onClick: 'clearFilters()' },
        { label: 'Draft', count: all.filter(p => p.status === 'Draft').length, filter: ['Status', 'Draft'] },
        { label: 'Awaiting approval', count: all.filter(p => p.status === 'Created').length, filter: ['Status', 'Created'] },
        { label: 'Approved', count: all.filter(p => p.status === 'Approved').length, filter: ['Status', 'Approved'] },
        { label: 'Non-billable', count: all.filter(p => p.orderType === 'Non-Billable').length, filter: ['Order Type', 'Non-Billable'] }
      ],
      columns: [
        { label: 'Order', cell: p => '<b>' + esc(p.id) + '</b>' + nowBadge(p) },
        { label: 'Request', cell: p => '<span class="mono">' + esc(p.scrId) + '</span>' },
        { label: 'Vendor', cell: p => esc(vendor(p.vendorId).name) },
        { label: 'Type', cell: p => esc(p.orderType) + (p.interUnit ? ' <span class="sb-st sb-st-info">Inter-Unit</span>' : '') },
        { label: 'Rate', cell: p => p.zeroValue ? '<span class="dim">—</span>' : maskCommercial(fmtMoney(p.rate)), align: 'right' },
        { label: 'Order value', cell: p => p.zeroValue ? '<b>0</b>' : maskCommercial(fmtMoney(poOrderValue(p))), align: 'right' },
        { label: 'Expected receipt', cell: p => esc(fmtDate(p.expectedReceiptDate)) || '<span class="dim">—</span>' },
        { label: 'Age', cell: p => ageCell(p.id), align: 'right' },
        { label: 'Status', cell: p => sbStatus(p.status) }
      ],
      rows: rows,
      onRow: p => 'openPoDetail(\'' + p.id + '\')',
      empty: 'No orders yet. An order appears here as soon as a request is approved.'
    });
}

/* ── Detail ─────────────────────────────────────────────────────────────── */
function buildPoDetail() {
  const p = po(poSelected);
  if (!p) { poView = 'list'; return buildPoListing(); }
  const r = scr(p.scrId);
  const v = vendor(p.vendorId);
  const isBuyer = canDo('complete-po');
  const isApprover = canDo('approve-po');
  const blocked = sameUserBlocked(p, 'approve-po');
  const draft = p.status === 'Draft';
  const pendingNb = p.nonBillableConfirmed === false;

  let actions = '<button class="btn-outline" onclick="backToPoList()">Back</button>';
  if (draft && isBuyer) {
    actions += actionBtn('Generate order', 'generatePoAction(\'' + p.id + '\')', !pendingNb,
      'Finance has not yet confirmed this Non-Billable request.', 'btn-primary');
  }
  if (p.status === 'Created') {
    actions += actionBtn('Return', 'returnPoAction(\'' + p.id + '\')', isApprover && !blocked,
      blocked ? 'Maker-checker: you completed this order.' : 'Only the approver can return an order.');
    actions += actionBtn('Approve', 'approvePoAction(\'' + p.id + '\')', isApprover && !blocked,
      blocked ? 'Maker-checker: you completed this order, so you cannot approve it.' : 'Only the approver can approve.',
      'btn-primary');
  }
  if (pendingNb && canDo('confirm-non-billable')) {
    actions += '<button class="btn-outline" onclick="rejectNbAction(\'' + p.id + '\')">Reject</button>';
    actions += '<button class="btn-primary" onclick="confirmNbAction(\'' + p.id + '\')">Confirm non-billable</button>';
  }

  return buildPageHead(p.id, 'Linked to request ' + esc(p.scrId) + ' · ' + esc(v.name), actions) +
    buildNextStep(p.scrId) +
    buildStageBar(journeyIndex(p.scrId)) +
    buildErrors(poErrors) +
    /* "Awaiting Finance" is what the next-step panel above already says, and
       who it is with. Only the reason it is non-billable is new. */
    (pendingNb ? buildNotice('Non-Billable because: <b>' + esc(r.nonBillableReason) + '</b>.', 'wait') : '') +
    (p.reason && p.status === 'Draft' ? buildNotice('<b>Returned for correction.</b> ' + esc(p.reason) +
      (p.remarks ? ' — ' + esc(p.remarks) : ''), 'wait') : '') +
    (p.zeroValue ? buildNotice(p.interUnit
      ? 'Inter-Unit order. The order is created for traceability and its value stays at zero; the internal unit is the vendor with Category = Internal.'
      : 'Non-Billable order. No price is entered by anyone and the value stays at zero.', 'info') : '') +
    (!seesCommercial() ? buildNotice('Commercial information on this order is not visible to your position.', 'idle') : '') +
    '<div class="split"><div>' +
      (draft && isBuyer ? buildPoForm(p, r) : buildPoRead(p, r, v)) +
      buildCard('Lines from the request', scrLineTable(r, 'receivable')) +
    '</div><div>' + buildActivityPanelHTML(p.id) + '</div></div>';
}

function buildPoRead(p, r, v) {
  return buildCard('Order', buildFieldGrid([
    ['Status', sbStatus(p.status)],
    ['Order Category', esc(p.orderCategory)],
    ['Order Type', esc(p.orderType)],
    ['Purchase Office', esc(p.purchaseOffice)],
    ['PO Series', '<span class="mono">' + esc(p.id) + '</span>'],
    ['Vendor', esc(v.name)],
    ['Vendor GSTIN', '<span class="mono">' + esc(p.gstin) + '</span>'],
    ['Vendor address', esc(p.vendorAddress)],
    ['Rate Contract', p.rateContractId ? maskCommercial(esc(p.rateContractId)) : '<span class="fg-none">None — rate entered manually</span>'],
    ['Rate', p.zeroValue ? '0' : maskCommercial(fmtMoney(p.rate))],
    ['Price Basis', p.zeroValue ? '—' : maskCommercial(esc(p.priceBasis))],
    ['Currency', maskCommercial(esc(p.currency))],
    ['Tax Code', esc(p.taxCode)],
    ['Payment Terms', maskCommercial(esc(p.paymentTerms))],
    ['Expected Receipt Date', esc(fmtDate(p.expectedReceiptDate))],
    ['Lot Type', esc(p.lotType)]
  ], 3) +
  /* The money was one 12px cell among twelve, so a committed order value was
     LESS prominent than the same number on the draft form. Same treatment
     either side of approval. */
  '<div class="po-total">Order value <b>' +
    (p.zeroValue ? '0' : maskCommercial(fmtMoney(poOrderValue(p)))) + '</b></div>');
}

function buildPoForm(p, r) {
  const contracts = contractsFor(p.vendorId, null);
  const locked = !!p.rateContractId;
  const rc = locked ? rateContract(p.rateContractId) : null;
  return buildCard('Complete commercial details',
    '<div class="form-grid">' +
      fField('Purchase Office', customSelect('p-office', p.purchaseOffice,
        purchaseOfficeMaster.filter(o => o.status === 'Active').map(o => o.name), 'Select office'), true,
        p.purchaseOffice ? 'Pre-filled from the plant.' : '') +
      fField('Expected Receipt Date', fDate('p-erd', p.expectedReceiptDate), true) +
      /* Picking a contract repaints immediately — the hint used to promise
         "populates and locks" while nothing happened until Save draft. */
      fField('Rate Contract', customSelect('p-rc', p.rateContractId || '',
        ['None'].concat(contracts.map(c => c.id + ' · ' + product(c.productId).name)), 'None', '', 'onPoContractChange'), false,
        locked ? 'Rate, basis and currency come from ' + rc.id + ' and are locked.'
               : 'Selecting a contract sets and locks rate, basis and currency.') +
      fField('Tax Code', customSelect('p-tax', p.taxCode, ['GST 18%', 'GST 12%', 'GST 5%', 'Exempt'], 'GST 18%'), true) +
      fField('Rate', p.zeroValue
        ? '<input class="inp inp-num" value="0" disabled>'
        : (locked ? '<span class="qty-wrap"><span class="qty-cur">&#8377;</span><input class="inp inp-num" value="' + attrSafe(rc.rate) + '" disabled></span>'
                  : '<span class="qty-wrap"><span class="qty-cur">&#8377;</span><input class="inp inp-num" type="number" id="p-rate" value="' +
                    attrSafe(p.rate == null ? '' : p.rate) + '" step="0.01" min="0" placeholder="0.00" oninput="livePoValue()"></span>'),
        !p.zeroValue, p.zeroValue ? 'Zero-value order — no rate applies.' : '') +
      fField('Price Basis', p.zeroValue
        ? '<input class="inp" value="—" disabled>'
        : (locked ? '<input class="inp" value="' + attrSafe(rc.priceBasis) + '" disabled>'
                  : customSelect('p-basis', p.priceBasis, ['Per PCS', 'Per KG', 'Per MT', 'Lump Sum'], 'Select basis')),
        !p.zeroValue) +
      /* A zero-value order asks no commercial questions at all — Currency and
         Payment Terms were still active required fields on an order whose
         value cannot be anything but 0. */
      fField('Currency', (locked || p.zeroValue) ? '<input class="inp" value="' + attrSafe(p.zeroValue ? '—' : rc.currency) + '" disabled>'
        : customSelect('p-ccy', p.currency || 'INR', ['INR', 'USD', 'EUR'], 'INR'), !p.zeroValue) +
      (p.zeroValue ? '' : fField('Payment Terms', fText('p-terms', p.paymentTerms, '30 days from receipt'))) +
      fField('Lot Type', customSelect('p-lot', p.lotType || 'Specific', ['Specific', 'Any'], 'Specific'), true,
        'Defaults to Specific: sub-contracting needs the exact stock identified.') +
    '</div>' +
    '<div class="po-total">Order value <b id="po-live">' +
      (p.zeroValue ? '0' : maskCommercial(fmtMoney(poOrderValue(p)))) + '</b></div>',
    '<button class="btn-outline btn-sm" onclick="savePoDraft()">Save draft</button>');
}

/* The total tracks the rate as it is typed — it used to sit at its last saved
   figure until Save draft, so the one number the buyer is producing looked
   frozen while they worked. */
function livePoValue() {
  const p = po(poSelected);
  const el = document.getElementById('po-live');
  if (!p || !el) return;
  const r = scr(p.scrId);
  const qty = r.receivableItems.reduce((s, l) => s + Number(l.qty || 0), 0);
  const rate = numValue('p-rate');
  el.innerHTML = maskCommercial(fmtMoney(+(rate * qty).toFixed(2)));
}

function onPoContractChange() { capturePo(); renderPage(); }

function capturePo() {
  const p = po(poSelected);
  if (!p || !document.getElementById('p-office')) return;
  p.purchaseOffice = getSelectValue('p-office');
  p.expectedReceiptDate = inputValue('p-erd');
  const rcSel = getSelectValue('p-rc');
  p.rateContractId = (!rcSel || rcSel === 'None') ? '' : rcSel.split(' · ')[0];
  p.taxCode = getSelectValue('p-tax');
  if (p.rateContractId) {
    const rc = rateContract(p.rateContractId);
    p.rate = rc.rate; p.priceBasis = rc.priceBasis; p.currency = rc.currency;
  } else if (!p.zeroValue) {
    if (document.getElementById('p-rate')) p.rate = numValue('p-rate');
    if (document.getElementById('p-basis')) p.priceBasis = getSelectValue('p-basis');
    if (document.getElementById('p-ccy')) p.currency = getSelectValue('p-ccy');
  }
  if (document.getElementById('p-terms')) p.paymentTerms = inputValue('p-terms');
  p.lotType = getSelectValue('p-lot') || 'Specific';
  p.value = poOrderValue(p);
}

function savePoDraft() {
  capturePo();
  logAction(poSelected, 'Commercial terms saved', {});
  notify('terms-saved', 'Commercial terms saved on ' + poSelected,
         'Ready for review once the buyer generates it.', poSelected);
  toast('Draft saved.');
  renderPage();
}

function generatePoAction(id) {
  capturePo();
  const res = generatePo(id);
  if (!res.ok) { poErrors = res.errors; renderPage(); return; }
  poErrors = [];
  toast(handoffMsg(po(id).scrId, 'Order generated.'));
  renderPage();
}
function approvePoAction(id) {
  openConfirm('Approve order',
    'Approving releases shipment creation against this request. Continue?', 'Approve', () => {
      const res = approvePo(id);
      if (!res.ok) { toast(res.error, 'bad'); return; }
      toast(handoffMsg(po(id).scrId, 'Order approved.'));
      renderPage();
    });
}
function returnPoAction(id) {
  openReasonModal('RC-PORET', 'Return order', (reason, remarks) => {
    const res = returnPo(id, reason, remarks);
    if (!res.ok) { toast(res.error, 'bad'); return; }
    toast('Order returned to the buyer.');
    renderPage();
  });
}
function confirmNbAction(id) {
  openConfirm('Confirm non-billable',
    'Confirming lets the buyer generate this zero-value order. Continue?', 'Confirm', () => {
      confirmNonBillable(id);
      toast('Non-billable request confirmed.');
      renderPage();
    });
}
function rejectNbAction(id) {
  openReasonModal('RC-NBREJ', 'Reject non-billable', (reason, remarks) => {
    rejectNonBillable(id, reason, remarks);
    toast('Rejected. The request has gone back to the planner.');
    renderPage();
  });
}

registerPage('orders', () => poView === 'detail' ? buildPoDetail() : buildPoListing());

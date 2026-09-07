/* ==========================================================================
   M-08  VENDOR PORTAL AND ASN

   The subcontractor's own view, on its own shell.  An external user should
   never see the shape of the internal application, so this is NOT the internal
   sidebar with items hidden — there is no sidebar at all, and no internal page
   is reachable from here.

   AN ASN IS OPTIONAL.  A vendor may raise one or not.  Nothing internal waits
   on one: every wire from this module enriches an internal screen when a
   notice exists and changes nothing when it does not.  That is why "No ASN
   raised" renders as a neutral state and never as a warning — the vendor is
   under no obligation, and amber would claim somebody is late.

   External permission set (the RBAC doc defers this until the portal is
   confirmed; building it confirms it):
     · sees only challans where they are the assigned vendor
     · View everywhere, plus a single Add action — raise ASN
     · no commercial value anywhere
     · no internal screen at all
   ========================================================================== */

let vendorId = 'V-2001';        /* which vendor is signed in */
let vpView = 'list';
let vpSelected = null;

function vpChallans() {
  return challanStore.filter(c => c.vendorId === vendorId && c.gateOutAt && c.status !== 'Closed');
}
function vpHistory() {
  return challanStore.filter(c => c.vendorId === vendorId && c.status === 'Closed');
}

function renderVendorPortal() {
  const host = document.getElementById('vp-content');
  if (!host) return;
  refreshReturnWindows();
  const v = vendor(vendorId);
  const acct = document.getElementById('vp-acct');
  if (acct) acct.innerHTML =
    '<span class="vp-acct-avatar">' + esc(initials(v.name)) + '</span>' +
    '<span class="vp-acct-name">' + esc(v.name) + '</span>';
  host.innerHTML = vpView === 'detail' && challan(vpSelected)
    ? vpDetail(challan(vpSelected)) : vpList();
}

function vpOpen(id) { vpSelected = id; vpView = 'detail'; renderVendorPortal(); }
function vpBack()   { vpView = 'list'; renderVendorPortal(); }

function vpSwitchVendor(id) {
  vendorId = id;
  vpView = 'list';
  renderVendorPortal();
}

/* ── Open challans ──────────────────────────────────────────────────────── */
function vpList() {
  const open = vpChallans();
  const closed = vpHistory();
  const mine = asnStore.filter(a => a.vendorId === vendorId);

  /* One hero that answers the vendor's whole situation in a sentence, with
     the nearest deadline as an aging bar — four stat tiles (two reading 0)
     said less with more furniture. */
  const nearest = open.slice().sort((a, b) => (daysRemaining(a) || 1e9) - (daysRemaining(b) || 1e9))[0];
  const overdueN = open.filter(c => c.status === 'Overdue').length;
  const hero = open.length
    ? '<div class="vp-hero"><div class="vp-hero-main">' +
        '<span class="vp-hero-cap">Your position</span>' +
        '<span class="vp-hero-line">Material held on ' + open.length + ' challan' + (open.length > 1 ? 's' : '') +
          (overdueN ? ' — <b style="color:var(--st-bad-fg)">' + overdueN + ' overdue</b>' : '') + '</span>' +
        '<span class="vp-hero-sub">' + (nearest ? 'Next return due ' + esc(nearest.returnByDate) +
          ' on ' + esc(nearest.id) : '') +
          (mine.length ? ' · ' + mine.length + ' notice' + (mine.length > 1 ? 's' : '') + ' raised' : '') +
          (closed.length ? ' · ' + closed.length + ' completed' : '') + '</span>' +
      '</div>' +
      (nearest ? '<div class="vp-hero-bar">' + agingBar(nearest) + '</div>' : '') +
    '</div>'
    : '';

  return buildPageHead('Material you are holding',
      'Everything below belongs to the despatching unit and must come back. Telling us when you expect to return it is helpful but entirely optional.') +
    hero +
    '<div class="listing-card">' + (open.length
      ? '<table class="listing-table"><thead><tr>' +
        /* Labelled honestly: the obligation is held against the request, not
           the challan, so a per-challan figure would be a guess. */
        '<th>Challan</th><th>Request</th><th>Received on</th><th>Return by</th><th class="ta-right">Days left</th>' +
        '<th>Material held</th><th class="ta-right">Owed on request</th><th>Your notice</th><th></th></tr></thead><tbody>' +
        open.map(c => {
          const a = latestAsn(c.id);
          const left = daysRemaining(c);
          const cls = left < 0 ? 'vp-days-over' : (left <= subConParams.returnWarnDays ? 'vp-days-warn' : '');
          const s = shipment(c.shipmentId);
          const r = scr(c.scrId);
          return '<tr tabindex="0" role="button" onclick="vpOpen(\'' + c.id + '\')"' +
            ' onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();vpOpen(\'' + c.id + '\')}">' +
            '<td><b class="mono">' + esc(c.id) + '</b></td>' +
            '<td class="mono dim">' + esc(c.scrId) + '</td>' +
            '<td>' + esc(String(c.gateOutAt).split(' · ')[0]) + '</td>' +
            '<td>' + esc(c.returnByDate) + '</td>' +
            '<td class="ta-right"><span class="vp-days ' + cls + '">' +
              (left < 0 ? Math.abs(left) + ' over' : left) + '</span></td>' +
            '<td>' + s.lines.map(l => { const il = r.issueItems.find(x => x.line === l.line) || {};
              return esc(product(il.productId).name) + ' · ' + fmtQty(l.qty) + ' ' + esc(il.uom); }).join('<br>') + '</td>' +
            '<td class="ta-right">' + fmtQty(challanOutstanding(c.id)) + '</td>' +
            '<td>' + (a ? '<span class="chip chip-on">' + esc(fmtDate(a.expectedDate)) + '</span>'
                        : '<span class="vp-none">None raised</span>') + '</td>' +
            '<td class="ta-right"><button class="btn-outline btn-sm" onclick="event.stopPropagation();vpAsnForm(\'' + c.id + '\')">' +
              (a ? 'Update notice' : 'Tell us when') + '</button></td></tr>';
        }).join('') + '</tbody></table>'
      : '<div class="lst-empty">You are not holding any material at the moment.</div>') + '</div>' +
    (mine.length ? buildCard('Notices you have raised',
      '<div class="lines-wrap"><table class="lines"><thead><tr>' +
      '<th>Notice</th><th>Challan</th><th>Item</th><th class="ta-right">Quantity</th>' +
      '<th>Expected</th><th>Vehicle</th><th>Raised</th></tr></thead><tbody>' +
      mine.map(a => '<tr><td><b class="mono">' + esc(a.id) + '</b></td>' +
        '<td class="mono">' + esc(a.challanId) + '</td>' +
        '<td>' + esc(product(a.productId).name) + '</td>' +
        '<td class="ta-right">' + fmtQty(a.qty) + '</td>' +
        '<td>' + esc(fmtDate(a.expectedDate)) + '</td>' +
        '<td class="mono">' + esc(a.vehicle || '—') + '</td>' +
        '<td class="dim">' + esc(a.raisedOn) + '</td></tr>').join('') +
      '</tbody></table></div>') : '');
}

/* ── One challan ────────────────────────────────────────────────────────── */
function vpDetail(c) {
  const s = shipment(c.shipmentId);
  const r = scr(c.scrId);
  const a = latestAsn(c.id);
  const left = daysRemaining(c);

  return buildPageHead(c.id,
      'Received ' + esc(c.gateOutAt) + ' · return by ' + esc(c.returnByDate),
      '<button class="btn-outline" onclick="vpBack()">Back</button>' +
      '<button class="btn-primary" onclick="vpAsnForm(\'' + c.id + '\')">' +
        (a ? 'Update notice' : 'Tell us when it is coming back') + '</button>') +
    (c.status === 'Overdue'
      ? buildNotice('This challan passed its return date on <b>' + esc(c.returnByDate) + '</b>.', 'bad')
      : (left <= subConParams.returnWarnDays
          ? buildNotice('The return date is in <b>' + left + ' days</b>.', 'wait')
          : '')) +
    (a ? buildNotice('You told us to expect <b>' + fmtQty(a.qty) + ' ' + esc(product(a.productId).uom) +
        '</b> of ' + esc(product(a.productId).name) + ' on <b>' + esc(fmtDate(a.expectedDate)) + '</b>.', 'info') : '') +
    buildCard('Material you received', '<div class="lines-wrap"><table class="lines"><thead><tr>' +
      '<th>Item</th><th class="ta-right">Quantity</th><th>UOM</th></tr></thead><tbody>' +
      s.lines.map(l => { const il = r.issueItems.find(x => x.line === l.line) || {};
        return '<tr><td>' + esc(product(il.productId).name) + '</td>' +
          '<td class="ta-right">' + fmtQty(l.qty) + '</td><td>' + esc(il.uom) + '</td></tr>'; }).join('') +
      '</tbody></table></div>') +
    buildCard('What we expect back', '<div class="lines-wrap"><table class="lines"><thead><tr>' +
      '<th>Item</th><th class="ta-right">Expected</th><th class="ta-right">Returned so far</th>' +
      '<th class="ta-right">Still owed</th><th>By</th></tr></thead><tbody>' +
      r.receivableItems.map(l => '<tr><td>' + esc(product(l.productId).name) + '</td>' +
        '<td class="ta-right">' + fmtQty(l.qty) + ' ' + esc(l.uom) + '</td>' +
        '<td class="ta-right">' + fmtQty(receivableReceived(r.id, l.line)) + '</td>' +
        '<td class="ta-right">' + fmtQty(receivableOutstanding(r.id, l.line)) + '</td>' +
        '<td class="nowrap">' + esc(fmtDate(l.expectedDate)) + '</td></tr>').join('') +
      '</tbody></table></div>') +
    /* The legal document the vendor is holding material against — they could
       not see or print it before, on the portal whose whole purpose is that
       accountability. Values on a job-work challan are declared for movement,
       so the document is commercial-safe by construction. */
    buildCard('The challan you are holding',
      buildChallanDocument(c, s, r, vendor(c.vendorId)),
      '<button class="btn-outline btn-sm" onclick="window.print()">Print</button>');
}

/* ── Raise an ASN ───────────────────────────────────────────────────────── */
function vpAsnForm(cid) {
  const c = challan(cid);
  const r = scr(c.scrId);
  const items = r.receivableItems.filter(l => receivableOutstanding(r.id, l.line) > 0.001);
  if (!items.length) { toast('Nothing is outstanding on this challan.'); return; }

  /* Pre-filled with what the page itself says is owed — asking the vendor to
     retype a number two cards above, then rejecting them for getting it
     wrong, was the portal arguing with itself. Single-item challans skip the
     question entirely. */
  const first = items[0];
  const firstOwed = receivableOutstanding(r.id, first.line);
  openModal('Advance shipping notice',
    '<div id="vp-err"></div>' +
    '<p class="modal-msg">Optional — it just helps the stores team be ready. Nothing is held up if you skip it.</p>' +
    '<div class="form-grid" style="--f-cols:2">' +
      fField('Item', customSelect('vp-item', product(first.productId).name,
        items.map(l => product(l.productId).name), 'Select item'), true) +
      fField('Quantity', '<span class="qty-wrap">' +
        '<input class="inp inp-num" type="number" id="vp-qty" value="' + attrSafe(firstOwed) + '" step="0.001" min="0">' +
        '<span class="qty-uom">' + esc(first.uom) + '</span></span>', true,
        'Still owed: ' + fmtQty(firstOwed) + ' ' + first.uom) +
      fField('Expected return date', '<input class="inp" type="date" id="vp-date" min="2026-08-24">', true) +
      fField('Vehicle', fText('vp-veh', '', 'TN 45 BQ 1123')) +
    '</div>', 'Send notice', () => {
      const p = productMaster.find(x => x.name === getSelectValue('vp-item'));
      const qty = numValue('vp-qty');
      const date = inputValue('vp-date');
      const errs = [];
      if (!p) errs.push('Choose which item is coming back.');
      if (!(qty > 0)) errs.push('Enter how much is coming back.');
      if (!date) errs.push('Enter the date you expect to return it.');
      /* Unbounded before: a notice for 99,999 PCS against 8 outstanding was
         accepted, and that figure is quoted back to the planner as grounds for
         waiting rather than short-closing. */
      /* Measured against the SAME figure the list column shows. It used to
         validate per line while the screen displayed the request total, so the
         portal refused the exact number it had just told the vendor they owed. */
      if (p && qty > 0) {
        const line = items.find(l => l.productId === p.id);
        const out = line ? receivableOutstanding(r.id, line.line) : 0;
        if (qty > out + 0.001)
          errs.push('Only ' + fmtQty(out) + ' ' + (line ? line.uom : '') +
                    ' of ' + p.name + ' is still owed on request ' + r.id + '.');
      }
      if (errs.length) { document.getElementById('vp-err').innerHTML = buildErrors(errs); return false; }
      createAsn(cid, { productId: p.id, qty: qty, expectedDate: date, vehicle: inputValue('vp-veh') });
      toast('Thank you — the stores team can see your notice.');
      renderVendorPortal();
      return true;
    });
}

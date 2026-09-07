/* ==========================================================================
   M-01  MASTER DATA   (US20)

   Seven masters, one shape.  Each declares its columns and its form; the
   listing, filtering, add/edit and activate/deactivate behaviour is shared,
   because seven hand-written master screens would drift apart within a week.

   ACTIVE / INACTIVE, NOT DELETE.  Delete exists on masters only, and only
   where the record is unused — an inactive master stays selectable on the
   historical transactions that already reference it (US20/AC9) and simply
   disappears from new ones.
   ========================================================================== */

let masterEditing = null;      /* id being edited, or '' for a new record */

/* ── Declarations ───────────────────────────────────────────────────────── */
const MASTERS = {
  products: {
    store: () => productMaster,
    label: 'Product',
    sub: 'Raw, Semi-Finished and Finished materials. Product Type drives the journey — Raw goes out as Issue Material, Semi-Finished comes back as a Receivable.',
    filters: [{ label: 'Product Type', options: PRODUCT_TYPES }, { label: 'Status', options: ['Active', 'Inactive'] }],
    match: r => passesFilter('Product Type', r.type) && passesFilter('Status', r.status),
    columns: [
      { label: 'Code', cell: r => '<b>' + esc(r.id) + '</b>' },
      { label: 'Product', cell: r => esc(r.name) },
      { label: 'Type', cell: r => esc(r.type) },
      { label: 'Category', cell: r => esc(r.main) + ' <span class="dim">/ ' + esc(r.child) + '</span>' },
      { label: 'HSN', cell: r => esc(r.hsn) },
      { label: 'UOM', cell: r => esc(r.uom) },
      { label: 'Lot', cell: r => r.lotControlled ? 'Controlled' : '<span class="dim">—</span>' },
      { label: 'Status', cell: r => sbStatus(r.status) }
    ],
    form: r => '<div class="form-grid">' +
      fField('Product Name', fText('m-name', r.name), true) +
      fField('Product Type', customSelect('m-type', r.type || '', PRODUCT_TYPES, 'Select type'), true) +
      fField('Main Category', fText('m-main', r.main), true) +
      fField('Child Category', fText('m-child', r.child)) +
      fField('HSN Code', fText('m-hsn', r.hsn), true) +
      fField('UOM', customSelect('m-uom', r.uom || '', UOMS, 'Select UOM'), true) +
      fField('Cost Price', fNum('m-cost', r.cost, '0', '0.01')) +
      /* A real default, not a placeholder posing as one — the "18" hint used
         to store 0 when left blank, and issue lines then derived "GST 0%". */
      fField('Tax %', fNum('m-tax', r.taxPct == null ? 18 : r.taxPct, '', '0.01')) +
      fField('Lot Controlled', fToggle('m-lot', !!r.lotControlled, 'Yes', 'No'), false,
             'Controlled material must have exact lots allocated before Stores can issue it.') +
      fField('Status', fToggle('m-status', r.status !== 'Inactive', 'Active', 'Inactive')) +
      '</div>',
    read: () => ({
      name: inputValue('m-name'), type: getSelectValue('m-type'), main: inputValue('m-main'),
      child: inputValue('m-child'), hsn: inputValue('m-hsn'), uom: getSelectValue('m-uom'),
      cost: numValue('m-cost'), taxType: 'GST', taxPct: numValue('m-tax'),
      lotControlled: toggleValue('m-lot'), status: toggleValue('m-status') ? 'Active' : 'Inactive'
    }),
    validate: d => {
      const e = [];
      if (!d.name) e.push('Product Name is required.');
      if (!d.type) e.push('Product Type is required.');
      if (!d.hsn) e.push('HSN Code is required.');
      if (!d.uom) e.push('UOM is required.');
      return e;
    },
    idPrefix: 'P-'
  },

  plants: {
    store: () => plantMaster,
    label: 'Plant',
    sub: 'Store Category = Manufacturing. Three location roles matter and the process is meaningless without all three: Main is what is genuinely available, Reserved is virtual, and Receiving is where processed material lands on the way back.',
    filters: [{ label: 'Status', options: ['Active', 'Inactive'] }],
    match: r => passesFilter('Status', r.status),
    columns: [
      { label: 'Code', cell: r => '<b>' + esc(r.id) + '</b>' },
      { label: 'Plant / Warehouse', cell: r => esc(r.name) },
      { label: 'GSTIN', cell: r => '<span class="mono">' + esc(r.gstin) + '</span>' },
      { label: 'Location', cell: r => esc(r.city + ', ' + r.state) },
      { label: 'Storage Locations', cell: r => (r.locations || []).map(l =>
          '<span class="sb-st sb-st-idle" style="margin-right:4px">' + esc(l.role) +
          (l.virtual ? ' · virtual' : '') + '</span>').join('') },
      { label: 'Status', cell: r => sbStatus(r.status) }
    ],
    form: r => '<div class="form-grid">' +
      fField('Plant / Warehouse Name', fText('m-name', r.name), true) +
      fField('GSTIN', fText('m-gstin', r.gstin), true) +
      fField('Street', fText('m-street', r.street)) +
      fField('City', fText('m-city', r.city), true) +
      fField('State', fText('m-state', r.state), true) +
      fField('Pincode', fText('m-pin', r.pincode)) +
      fField('Status', fToggle('m-status', r.status !== 'Inactive', 'Active', 'Inactive')) +
      '</div>' +
      (r.locations ? '<div class="doc-sec">Storage locations</div><div class="lines-wrap"><table class="lines">' +
        '<thead><tr><th>Code</th><th>Name</th><th>Role</th><th>Zone</th><th>Status</th></tr></thead><tbody>' +
        r.locations.map(l => '<tr><td class="mono">' + esc(l.id) + '</td><td>' + esc(l.name) + '</td>' +
          '<td>' + esc(l.role) + (l.virtual ? ' <span class="dim">(virtual)</span>' : '') + '</td>' +
          '<td>' + esc(l.zone) + '</td><td>' + sbStatus(l.status) + '</td></tr>').join('') +
        '</tbody></table></div>' : ''),
    read: () => ({
      name: inputValue('m-name'), gstin: inputValue('m-gstin'), street: inputValue('m-street'),
      city: inputValue('m-city'), state: inputValue('m-state'), pincode: inputValue('m-pin'),
      country: 'India', category: 'Manufacturing',
      status: toggleValue('m-status') ? 'Active' : 'Inactive'
    }),
    validate: d => {
      const e = [];
      if (!d.name) e.push('Plant Name is required.');
      if (!d.gstin) e.push('GSTIN is required.');
      if (!d.city) e.push('City is required.');
      if (!d.state) e.push('State is required.');
      return e;
    },
    idPrefix: 'PL-'
  },

  vendors: {
    store: () => vendorMaster,
    label: 'Vendor',
    sub: 'Vendor Category is the single source of internal versus external — there is no separate Internal Unit master. Category = Internal means the party is another L&T unit, which is what makes an Inter-Unit deal zero-value.',
    filters: [{ label: 'Category', options: ['Internal', 'External'] }, { label: 'Status', options: ['Active', 'Inactive'] }],
    match: r => passesFilter('Category', r.category) && passesFilter('Status', r.status),
    columns: [
      { label: 'Code', cell: r => '<b>' + esc(r.id) + '</b>' },
      { label: 'Vendor', cell: r => esc(r.name) },
      /* A taxonomy, not a health signal. Internal used to render in the same
         green as the Active status pill two columns to its right. */
      { label: 'Category', cell: r => '<span class="chip' + (r.category === 'Internal' ? ' chip-on' : '') +
          '">' + esc(r.category) + '</span>' },
      { label: 'GSTIN', cell: r => '<span class="mono">' + esc(r.gstin) + '</span>' },
      { label: 'Location', cell: r => esc(r.city + ', ' + r.state) },
      { label: 'Capability', cell: r => (r.capabilities || []).map(c =>
          '<span class="sb-st sb-st-idle" style="margin-right:3px">' + esc(c) + '</span>').join('') },
      { label: 'Status', cell: r => sbStatus(r.status) }
    ],
    form: r => '<div class="form-grid">' +
      fField('Vendor Name', fText('m-name', r.name), true) +
      fField('Vendor Category', customSelect('m-cat', r.category || '', ['External', 'Internal'], 'Select'), true,
             'Internal = another L&T unit. External = a sub-contractor.') +
      fField('GSTIN', fText('m-gstin', r.gstin), true) +
      fField('Primary Contact', fText('m-contact', r.contact)) +
      fField('Email', fText('m-email', r.email)) +
      fField('Phone', fText('m-phone', r.phone)) +
      fField('City', fText('m-city', r.city), true) +
      fField('State', fText('m-state', r.state)) +
      fField('Sub-Contracting Experience (yrs)', fNum('m-exp', r.experience, '0', '1')) +
      fField('Status', fToggle('m-status', r.status !== 'Inactive', 'Active', 'Inactive')) +
      '<div class="ff ff-span2">' + fField('Works Address', fArea('m-addr', r.address), true) + '</div>' +
      '<div class="ff ff-span2">' + fField('Product Capability',
        fText('m-caps', (r.capabilities || []).join(', '), 'Steel, Plate, Fabrication, Shell'), false,
        'Comma separated. A vendor is only offered on a request whose material matches one of these.') + '</div>' +
      '</div>',
    read: () => ({
      name: inputValue('m-name'), category: getSelectValue('m-cat'), gstin: inputValue('m-gstin'),
      contact: inputValue('m-contact'), email: inputValue('m-email'), phone: inputValue('m-phone'),
      city: inputValue('m-city'), state: inputValue('m-state'), country: 'India',
      address: inputValue('m-addr'), experience: numValue('m-exp'),
      capabilities: inputValue('m-caps').split(',').map(s => s.trim()).filter(Boolean),
      plants: ['PL-TRY'],
      status: toggleValue('m-status') ? 'Active' : 'Inactive'
    }),
    validate: d => {
      const e = [];
      if (!d.name) e.push('Vendor Name is required.');
      if (!d.category) e.push('Vendor Category is required.');
      if (!d.gstin) e.push('GSTIN is required.');
      if (!d.address) e.push('Works Address is mandatory.');
      if (!d.city) e.push('City is required.');
      return e;
    },
    idPrefix: 'V-'
  },

  'rate-contracts': {
    store: () => rateContractMaster,
    label: 'Rate Contract',
    sub: 'Held against a Vendor and a Product. Where one applies, the Buyer does not type a price — Rate, Price Basis and Currency are populated from here and locked.',
    filters: [{ label: 'Status', options: ['Active', 'Expired'] }],
    match: r => passesFilter('Status', r.status),
    columns: [
      { label: 'Contract', cell: r => '<b>' + esc(r.id) + '</b>' },
      { label: 'Vendor', cell: r => esc(vendor(r.vendorId).name) },
      { label: 'Product', cell: r => esc(product(r.productId).name) },
      { label: 'Rate', cell: r => maskCommercial(fmtMoney(r.rate)), align: 'right' },
      { label: 'Basis', cell: r => esc(r.priceBasis) },
      { label: 'Quantity', cell: r => fmtQty(r.qty, 0), align: 'right' },
      { label: 'Amount', cell: r => maskCommercial(fmtMoney(r.amount)), align: 'right' },
      { label: 'Period', cell: r => '<span class="nowrap">' + esc(r.from) + ' – ' + esc(r.to) + '</span>' },
      { label: 'Status', cell: r => sbStatus(r.status === 'Active' ? 'Active' : 'Closed', r.status) }
    ],
    form: r => '<div class="form-grid">' +
      fField('Vendor', customSelect('m-vendor', r.vendorId ? vendor(r.vendorId).name : '',
        activeVendors().map(v => v.name), 'Select vendor'), true) +
      fField('Product', customSelect('m-product', r.productId ? product(r.productId).name : '',
        activeProducts().map(p => p.name), 'Select product'), true) +
      fField('Rate', fNum('m-rate', r.rate, '0', '0.01'), true) +
      fField('Price Basis', customSelect('m-basis', r.priceBasis || '',
        ['Per PCS', 'Per KG', 'Per MT', 'Lump Sum'], 'Select basis'), true) +
      fField('Currency', customSelect('m-ccy', r.currency || 'INR', ['INR', 'USD', 'EUR'], 'INR'), true) +
      fField('Contract Quantity', fNum('m-qty', r.qty, '0', '1')) +
      fField('Valid From', fText('m-from', r.from, '01 Apr 2026'), true) +
      fField('Valid To', fText('m-to', r.to, '31 Mar 2027'), true) +
      '</div>',
    read: () => {
      const v = vendorMaster.find(x => x.name === getSelectValue('m-vendor')) || {};
      const p = productMaster.find(x => x.name === getSelectValue('m-product')) || {};
      const rate = numValue('m-rate'), qty = numValue('m-qty');
      return {
        vendorId: v.id, productId: p.id, rate: rate, priceBasis: getSelectValue('m-basis'),
        currency: getSelectValue('m-ccy'), qty: qty, amount: +(rate * qty).toFixed(2),
        from: inputValue('m-from'), to: inputValue('m-to')
        /* status deliberately absent: editing an Expired contract used to
           resurrect it to Active on save, silently. Object.assign leaves the
           existing status untouched; saveMaster sets Active on creation. */
      };
    },
    validate: d => {
      const e = [];
      if (!d.vendorId) e.push('Vendor is required.');
      if (!d.productId) e.push('Product is required.');
      if (!(d.rate > 0)) e.push('Rate must be greater than zero.');
      if (!d.priceBasis) e.push('Price Basis is required.');
      if (!d.from || !d.to) e.push('A contract period is required.');
      return e;
    },
    idPrefix: 'RC-',
    commercial: true
  },

  'purchase-offices': {
    store: () => purchaseOfficeMaster,
    label: 'Purchase Office',
    sub: 'Each office owns its own number series per document type, so a second plant issues its own sequence rather than sharing Trichy’s.',
    filters: [{ label: 'Status', options: ['Active', 'Inactive'] }],
    match: r => passesFilter('Status', r.status),
    columns: [
      { label: 'Code', cell: r => '<b>' + esc(r.id) + '</b>' },
      { label: 'Office', cell: r => esc(r.name) },
      { label: 'Plant', cell: r => esc(plant(r.plantId).name) },
      { label: 'In-charge', cell: r => esc(r.incharge) },
      { label: 'Number series', cell: r => '<span class="mono dim">' +
          esc(r.series.scr + ' · ' + r.series.po + ' · ' + r.series.challan) + '</span>' },
      { label: 'Status', cell: r => sbStatus(r.status) }
    ],
    form: r => '<div class="form-grid">' +
      fField('Office Name', fText('m-name', r.name), true) +
      fField('Plant', customSelect('m-plant', r.plantId ? plant(r.plantId).name : '',
        activePlants().map(p => p.name), 'Select plant'), true) +
      fField('In-charge', fText('m-inch', r.incharge)) +
      fField('Email', fText('m-email', r.email)) +
      '</div>' +
      /* A NEW office starts with blank series — defaulting them to Trichy's
         exact patterns contradicted this page's own description ("a second
         plant issues its own sequence") and invited duplicate numbering. */
      '<div class="doc-sec">Number series</div><div class="form-grid">' +
      fField('Request', fText('m-s-scr', r.series ? r.series.scr : '', 'e.g. SUBH-######'), true) +
      fField('Order / PO', fText('m-s-po', r.series ? r.series.po : '', 'e.g. PO-HZR-######'), true) +
      fField('Shipment', fText('m-s-ship', r.series ? r.series.shipment : '', 'e.g. CSNH-######'), true) +
      fField('Delivery Note', fText('m-s-dn', r.series ? r.series.dnote : '', 'e.g. DNH-######'), true) +
      fField('Challan', fText('m-s-ch', r.series ? r.series.challan : '', 'e.g. CHN-24-######'), true) +
      fField('IMR', fText('m-s-imr', r.series ? r.series.imr : '', 'e.g. IMRH-######'), true) +
      '</div>',
    read: () => {
      const p = plantMaster.find(x => x.name === getSelectValue('m-plant')) || {};
      return {
        name: inputValue('m-name'), plantId: p.id, incharge: inputValue('m-inch'),
        email: inputValue('m-email'),
        series: { scr: inputValue('m-s-scr'), po: inputValue('m-s-po'), shipment: inputValue('m-s-ship'),
                  dnote: inputValue('m-s-dn'), challan: inputValue('m-s-ch'), imr: inputValue('m-s-imr'),
                  asn: 'ASN-######' }
      };
    },
    validate: d => {
      const e = [];
      if (!d.name) e.push('Office Name is required.');
      if (!d.plantId) e.push('Plant is required.');
      ['scr', 'po', 'shipment', 'dnote', 'challan', 'imr'].forEach(k => {
        if (!d.series[k]) e.push('A number series is required for every document type.');
      });
      return e.filter((v, i, a) => a.indexOf(v) === i);
    },
    idPrefix: 'PO-'
  }
};

/* ── Listing ────────────────────────────────────────────────────────────── */
function buildMasterListing(key) {
  const m = MASTERS[key];
  const rows = m.store().filter(m.match);
  const all = m.store();
  return buildPageHead(getPageTitle(key), m.sub,
      actionBtn('Add ' + m.label, 'openMasterForm(\'' + key + '\',\'\')', canAdd(key),
                'Only an administrator can add a master record.', 'btn-primary')) +
    buildListing({
      filters: m.filters,
      stats: [
        { label: 'Total', count: all.length },
        { label: 'Active', count: all.filter(r => r.status === 'Active').length },
        { label: 'Not in use', count: all.filter(r => r.status !== 'Active').length }
      ],
      columns: m.columns.concat([{
        label: '', align: 'right',
        cell: r => canEdit(key)
          ? '<button class="btn-outline btn-sm" onclick="event.stopPropagation();openMasterForm(\'' + key + '\',\'' + r.id + '\')">Edit</button>'
          : ''
      }]),
      rows: rows,
      empty: 'No ' + m.label.toLowerCase() + ' records match these filters.'
    });
}

/* ── Add / edit ─────────────────────────────────────────────────────────── */
function openMasterForm(key, id) {
  const m = MASTERS[key];
  const rec = id ? m.store().find(r => r.id === id) : {};
  masterEditing = { key: key, id: id };
  openModal((id ? 'Edit ' : 'Add ') + m.label,
    '<div id="m-err"></div>' + m.form(rec || {}),
    id ? 'Save changes' : 'Create ' + m.label,
    () => saveMaster(key, id));
}

function saveMaster(key, id) {
  const m = MASTERS[key];
  const data = m.read();
  const errs = m.validate(data);

  /* Unique name check (US20 negative flow) — on edits too: renaming Vendor B
     to Vendor A's exact name used to be accepted without a word. */
  if (m.store().some(r => r.id !== id && (r.name || '').toLowerCase() === (data.name || '').toLowerCase()))
    errs.push('A record with this name already exists.');

  /* GSTIN is printed on legal challans; a malformed one should not get that
     far. 15 characters: state code, PAN, entity, Z, checksum. */
  if (data.gstin != null && data.gstin !== '' &&
      !/^[0-9]{2}[A-Z0-9]{10}[A-Z0-9]Z[A-Z0-9]$/i.test(data.gstin.replace(/\s/g, '')))
    errs.push('GSTIN should be 15 characters — e.g. 33ABCDE1234F1Z5.');

  if (errs.length) {
    document.getElementById('m-err').innerHTML = buildErrors(errs);
    return false;
  }

  if (id) {
    const rec = m.store().find(r => r.id === id);
    const wasStatus = rec.status;
    Object.assign(rec, data);
    logAction(rec.id, 'Master updated', wasStatus !== rec.status ? { from: wasStatus, to: rec.status } : {});
    toast(m.label + ' updated.');
  } else {
    const seq = m.store().length + 1;
    const rec = Object.assign({ id: m.idPrefix + String(1000 + seq) }, data);
    m.store().push(rec);
    logAction(rec.id, m.label + ' created', { to: rec.status });
    toast(m.label + ' created.');
  }
  renderPage();
  return true;
}

/* ── Reason codes: read-only, grouped ───────────────────────────────────── */
function buildReasonCodesPage() {
  const groups = Object.keys(reasonMaster);
  return buildPageHead('Reason Codes',
      'Every exception in the journey is reason-gated. “Other” appears in every list and always forces mandatory remarks — enforced centrally, so it can never be forgotten on a new group.') +
    '<div class="card"><div class="card-head"><span class="card-title">' + groups.length +
      /* The card-body keeps its padding: `.card-body > .listing-table` already
         does the full-bleed with a -18px margin, and zeroing the padding too
         pulled the table outside the card, where overflow:hidden clipped its
         header into the title and sliced the last row in half. */
      ' reason groups</span></div><div class="card-body">' +
    '<table class="listing-table"><thead><tr><th>Code</th><th>Group</th><th>Applies at</th><th>Predefined reasons</th></tr></thead><tbody>' +
    groups.map(k => '<tr><td><b class="mono">' + esc(k) + '</b></td><td>' + esc(reasonMaster[k].label) + '</td>' +
      '<td class="dim">' + esc(reasonMaster[k].at) + '</td><td>' +
      reasonMaster[k].reasons.map(r => '<span class="sb-st sb-st-idle" style="margin:1px 3px 1px 0">' +
        esc(r) + '</span>').join('') + '</td></tr>').join('') +
    '</tbody></table></div></div>';
}

/* ── Parameters ─────────────────────────────────────────────────────────── */
function buildParametersPage() {
  const editable = canEdit('parameters');
  return buildPageHead('Sub-Contracting Parameters',
      'The configurable numbers the BRD refers to but never fixes. Each is read at the point of use, never hard-coded into a screen.') +
    '<div class="card"><div class="card-head"><span class="card-title">Configuration</span>' +
      (editable ? '<div class="card-actions"><button class="btn-primary btn-sm" onclick="saveParams()">Save</button></div>' : '') +
    '</div><div class="card-body"><div class="form-grid">' +
      fField('Return window (days)', fNum('pp-window', subConParams.returnWindowDays, '45', '1'), true,
             'Runs from the recorded Gate Outward timestamp — not from challan generation.') +
      fField('Expiry warning (days)', fNum('pp-warn', subConParams.returnWarnDays, '7', '1'), true,
             'How early the “return window closing” notification fires.') +
      fField('Decimal precision', fNum('pp-dp', subConParams.decimalPrecision, '3', '1'), true,
             'Applied to every quantity and to BOM-ratio consumption.') +
      fField('Receipt tolerance (%)', fNum('pp-tol', subConParams.receiptTolerancePct, '2', '0.1'), true,
             'Over-receipt permitted against the outstanding quantity.') +
      fField('Default BOM ratio', fNum('pp-bom', subConParams.bomRatioDefault, '12.9', '0.01'), false,
             'Used where no product-specific ratio is maintained.') +
      fField('FIM buffer (%)', fNum('pp-fim', subConParams.fimBufferPct, '3.2', '0.1'), false,
             'Free-issue buffer added on top of the calculated issue quantity.') +
    '</div></div></div>' +
    '<div class="card"><div class="card-head"><span class="card-title">BOM ratios</span></div>' +
    '<div class="card-body"><table class="listing-table"><thead><tr>' +
    '<th>Issue material</th><th>Receivable item</th><th class="ta-right">Ratio</th><th>Meaning</th>' +
    '</tr></thead><tbody>' + bomRatios.map(b => '<tr>' +
      '<td>' + esc(product(b.issueProductId).name) + '</td>' +
      '<td>' + esc(product(b.receivableProductId).name) + '</td>' +
      '<td class="ta-right"><b>' + esc(String(b.ratio)) + '</b></td>' +
      '<td class="dim">' + esc(b.ratio + ' ' + product(b.issueProductId).uom + ' consumed per ' +
        product(b.receivableProductId).uom + ' received') + '</td></tr>').join('') +
    '</tbody></table></div></div>';
}

/* Bounded. A cleared field used to store 0 — and a 0-day return window flips
   every open challan Overdue on the next render, from one stray backspace on
   a settings screen. */
function saveParams() {
  const errs = [];
  const bounded = (id, label, min, max) => {
    const v = numValue(id);
    if (!(v >= min && v <= max)) { errs.push(label + ' must be between ' + min + ' and ' + max + '.'); return null; }
    return v;
  };
  const win = bounded('pp-window', 'Return window', 1, 365);
  const warn = bounded('pp-warn', 'Expiry warning', 1, 60);
  const dp = bounded('pp-dp', 'Decimal precision', 0, 4);
  const tol = bounded('pp-tol', 'Receipt tolerance', 0, 25);
  if (errs.length) { toast(errs[0], 'bad'); return; }
  subConParams.returnWindowDays = win;
  subConParams.returnWarnDays = warn;
  subConParams.decimalPrecision = dp;
  subConParams.receiptTolerancePct = tol;
  subConParams.bomRatioDefault = numValue('pp-bom') || subConParams.bomRatioDefault;
  subConParams.fimBufferPct = numValue('pp-fim') || subConParams.fimBufferPct;
  refreshReturnWindows();
  logAction('Sub-Con Parameters', 'Configuration updated', {});
  toast('Parameters saved.');
  renderPage();
}

/* ── Registration ───────────────────────────────────────────────────────── */
['products', 'plants', 'vendors', 'rate-contracts', 'purchase-offices'].forEach(k => {
  registerPage(k, () => buildMasterListing(k));
});
registerPage('reason-codes', buildReasonCodesPage);
registerPage('parameters', buildParametersPage);

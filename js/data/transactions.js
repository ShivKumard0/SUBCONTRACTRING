/* ==========================================================================
   TRANSACTION STORE AND STATE MACHINES

   Six status tracks are maintained SEPARATELY and never collapsed into one,
   because the BRD is explicit that stage status must not replace business
   status.  A Deal can be Approved while its Shipment is Gate Cleared and its
   Challan is Overdue — three true facts about three different things.

   Nothing here is ever deleted.  Cancel, Return, Reject, Void and Short-Close
   are the only exits, and every one of them leaves the record in place.
   ========================================================================== */

const scrStore = [];
const poStore = [];
const shipmentStore = [];
const dnoteStore = [];
const challanStore = [];
const imrStore = [];
const asnStore = [];

/* Number series come from the Purchase Office master, so a second plant
   issues its own sequence rather than sharing Trichy's. */
const seqCounters = { scr: 317, po: 4105, shipment: 511, dnote: 870, challan: 441, imr: 700, asn: 300,
                      obk: 840, transferOrder: 1290, gatepass: 60 };

function nextId(kind, plantId) {
  const office = purchaseOfficeMaster.find(o => o.plantId === (plantId || 'PL-TRY')) || purchaseOfficeMaster[0];
  const pattern = office.series[kind] || '###-######';
  const n = ++seqCounters[kind];
  return pattern.replace(/#+/, m => String(n).padStart(m.length, '0'));
}

/* ── Lookups ────────────────────────────────────────────────────────────── */
function scr(id)      { return scrStore.find(r => r.id === id); }
function po(id)       { return poStore.find(r => r.id === id); }
function shipment(id) { return shipmentStore.find(r => r.id === id); }
function dnote(id)    { return dnoteStore.find(r => r.id === id); }
function challan(id)  { return challanStore.find(r => r.id === id); }
function imr(id)      { return imrStore.find(r => r.id === id); }

function poForScr(scrId)        { return poStore.find(r => r.scrId === scrId); }
function shipmentsForScr(scrId) { return shipmentStore.filter(r => r.scrId === scrId); }
function dnoteForShipment(sid)  { return dnoteStore.find(r => r.shipmentId === sid && r.status !== 'Voided'); }
function challanForShipment(sid){ return challanStore.find(r => r.shipmentId === sid); }
function imrsForChallan(cid)    { return imrStore.filter(r => r.challanId === cid); }
function asnsForChallan(cid)    { return asnStore.filter(r => r.challanId === cid); }

/* A challan is "live" once it exists and has not been closed — which is what
   blocks shipment cancellation (US15/AC1) and short-close (US14/AC1). */
function hasLiveChallan(shipmentId) {
  const c = challanForShipment(shipmentId);
  return !!c && c.status !== 'Closed';
}

/* ── SCR / Deal ─────────────────────────────────────────────────────────── */
function createScr(data) {
  const rec = Object.assign({
    id: nextId('scr', data.plantId),
    dealType: 'Purchase (Procure-to-Pay)',   /* GATE M-02 — see note below */
    subType: 'External',
    orderCategory: 'Purchase Order',
    workType: 'Job',
    billable: true, nonBillableReason: '', nonBillableRemarks: '',
    interUnit: false, logistics: true, fim: false,
    /* FR1.2 / FR1.3 — SCR Base and its two branches. `scrBase` decides which
       half of the form exists at all, so it defaults to Project: that is the
       route the client demonstrated and the one most requests take. */
    scrBase: 'Project',
    projectId: '', projectElement: '', activity: '',
    productionOrderId: '', operationFrom: '', operationTo: '', operationDesc: '',
    /* Captured and audited, but switched off in the live system today. Shown
       disabled rather than hidden — see the note in m02-scr.js. */
    scrUnpeg: false,
    headerText: '',
    issueItems: [], receivableItems: [],
    status: 'Created', stage: 'In Progress',
    submittedBy: null, approvedBy: null,
    reason: '', remarks: '',
    createdBy: currentUserId, createdOn: stampNow().date
  }, data);
  rec.orderType = rec.billable ? 'Billable' : 'Non-Billable';
  rec.team = currentUser().team;
  scrStore.push(rec);
  logAction(rec.id, 'Request created', { to: 'Created' });
  notify('request-created', rec.id + ' raised', rec.title, rec.id);
  return rec;
}

/* Validation gathers EVERY failure rather than stopping at the first, so the
   form can highlight all of them at once instead of one per attempt. */
function validateScr(r) {
  const e = [];
  if (!r.title) e.push('Deal Title is required.');
  if (!r.vendorId) e.push('A Vendor must be selected.');
  else {
    const v = vendor(r.vendorId);
    if (v.status !== 'Active') e.push('The selected Vendor is Inactive and cannot be used.');
    if (r.interUnit && v.category !== 'Internal') e.push('An Inter-Unit request needs a Vendor with Category = Internal.');
  }
  if (!r.billable && !r.nonBillableReason) e.push('A Non-Billable Reason is mandatory when Billable = No.');

  /* FR1.3 — the SCR Base branch. Each half validates only its own fields, so
     switching base cannot leave the other half's requirements demanding
     values for a section that is no longer on screen. */
  if (r.scrBase === 'Project') {
    if (!r.projectId) e.push('A Project is required when SCR Base = Project.');
    else {
      if (project(r.projectId).status !== 'Active')
        e.push('The selected Project is not Active and cannot be used.');
      if (!r.projectElement) e.push('A Project Element is required.');
      else if (!projectElements(r.projectId).some(el => el.id === r.projectElement))
        e.push('The Project Element does not belong to the selected Project.');
    }
  } else if (r.scrBase === 'Production Order') {
    if (!r.productionOrderId) e.push('A Production Order is required when SCR Base = Production Order.');
    else {
      const po = productionOrder(r.productionOrderId);
      const routing = routingFor(r.productionOrderId);
      if (po.status === 'Closed') e.push('The selected Production Order is Closed.');
      if (!r.operationFrom) e.push('Operation From is required.');
      if (!r.operationTo)   e.push('Operation To is required.');
      if (r.operationFrom && r.operationTo) {
        const a = routing.find(o => String(o.op) === String(r.operationFrom));
        const b = routing.find(o => String(o.op) === String(r.operationTo));
        if (!a) e.push('Operation From does not belong to this Production Order routing.');
        if (!b) e.push('Operation To does not belong to this Production Order routing.');
        /* The client's worked example: cutting stays in house, bending and
           plating go out. Reversing the two would subcontract backwards. */
        if (a && b && a.seq > b.seq)
          e.push('Operation From (' + a.name + ') comes after Operation To (' + b.name + ').');
      }
      if (!r.operationDesc) e.push('Describe the operation the subcontractor will carry out.');
    }
  } else {
    e.push('SCR Base must be either Project or Production Order.');
  }

  if (!r.issueItems.length) e.push('At least one Issue Item is required.');
  if (!r.receivableItems.length) e.push('At least one Receivable Item is required.');
  r.issueItems.forEach((l, i) => {
    if (!(l.qty > 0)) e.push('Issue line ' + (i + 1) + ': quantity must be greater than zero.');
    if (product(l.productId).status === 'Inactive') e.push('Issue line ' + (i + 1) + ': product is Inactive.');
    if (!l.reasonRemoval) e.push('Issue line ' + (i + 1) + ': Reason for Removal is required.');
  });
  r.receivableItems.forEach((l, i) => {
    if (!(l.qty > 0)) e.push('Receivable line ' + (i + 1) + ': quantity must be greater than zero.');
    if (product(l.productId).status === 'Inactive') e.push('Receivable line ' + (i + 1) + ': product is Inactive.');
    if (!l.expectedDate) e.push('Receivable line ' + (i + 1) + ': Expected Receipt Date is required.');
  });
  return e;
}

/* ── FR3 · Receivable Product / WIP and BOM processing ──────────────────────
   Stage 03. No human acts here, which is exactly why it has to leave a record
   — the ratio derived below is invisible until stage 17 consumes against it,
   and a number nobody can see is a number nobody can check.

   THE RATIO IS DERIVED, NOT TYPED.

       BOM Ratio = Issue Quantity ÷ Expected Receivable Quantity

   The FRD's worked example: 100 KG issued against 40 PCS expected gives 2.5 KG
   per PCS. That figure then drives Consumed = Received × Ratio, which is the
   automatic raw-material consumption the client said is broken today and
   admitted is absent from their own BRD.

   An EXISTING ratio always wins. The master may hold an engineering-approved
   figure, and silently overwriting it with one back-computed from whatever
   quantities a planner happened to type would be a quiet corruption of
   reference data — the request would look right and every future consumption
   against that pair would be wrong. */
function processBomForScr(r) {
  const dp = subConParams.decimalPrecision;
  const summary = { products: [], bom: [] };

  r.receivableItems.forEach(rc => {
    /* FR3.1 / FR3.2 — reuse or create. Everything in the demo master already
       exists; the create branch is what the "Create WIP Item" action on the
       receivable line feeds, and a created product stays Pending until the
       first confirmed receipt activates it (FR16.4). */
    let p = productMaster.find(x => x.id === rc.productId);
    if (!p) {
      p = { id: rc.productId, name: rc.description || rc.productId, type: 'Semi - Finished',
            main: 'Job Work', child: 'WIP', hsn: rc.hsn || '', uom: rc.uom,
            cost: 0, taxType: 'GST', taxPct: 18, lotControlled: false,
            status: 'Pending', originatingScr: r.id };
      productMaster.push(p);
      summary.products.push({ id: p.id, action: 'created', status: 'Pending' });
      logAction(r.id, 'WIP product created', { remarks: p.id + ' — Pending until first receipt' });
    } else {
      summary.products.push({ id: p.id, action: 'reused', status: p.status });
    }

    r.issueItems.forEach(is => {
      const existing = bomRatio(is.productId, rc.productId);
      if (existing != null) {
        summary.bom.push({ issue: is.productId, receivable: rc.productId,
                           ratio: existing, source: 'Product master' });
        return;
      }
      if (!(rc.qty > 0)) return;                 /* validation blocks this, but never divide blind */
      const ratio = +(is.qty / rc.qty).toFixed(dp);
      bomRatios.push({ issueProductId: is.productId, receivableProductId: rc.productId,
                       ratio: ratio, source: r.id });
      summary.bom.push({ issue: is.productId, receivable: rc.productId,
                         ratio: ratio, source: 'Derived from ' + r.id });
      logAction(r.id, 'BOM relationship recorded', {
        remarks: product(is.productId).name + ' → ' + product(rc.productId).name +
                 ' at ' + fmtQty(ratio) + ' ' + is.uom + ' per ' + rc.uom });
    });
  });

  r.bomProcessed = summary;
  return summary;
}

function submitScr(id) {
  const r = scr(id);
  const errs = validateScr(r);
  if (errs.length) return { ok: false, errors: errs };
  const from = r.status;
  r.status = 'Sent for Approval';
  r.submittedBy = currentUserId;
  logAction(r.id, 'Submitted for approval', { from, to: r.status });
  return { ok: true };
}

function approveScr(id) {
  const r = scr(id);
  if (r.status !== 'Sent for Approval') return { ok: false, error: 'Only a request awaiting approval can be approved.' };
  if (sameUserBlocked(r, 'approve-scr'))
    return { ok: false, error: 'Maker-checker: you submitted this request, so you cannot approve it.' };
  r.status = 'Approved';
  r.approvedBy = currentUserId;
  logAction(r.id, 'Approved', { from: 'Sent for Approval', to: 'Approved' });
  notify('request-approved', r.id + ' approved', r.title + ' · ' + vendor(r.vendorId).name, r.id);
  /* FR3 runs BEFORE the order. The BOM ratio it derives is what the
     reconciliation fifteen stages later consumes issue material against, so
     if this fails the whole return leg is wrong — and it must happen on
     approval, not on creation, because an unapproved request must never
     create a product. */
  processBomForScr(r);
  const created = createPoForScr(r);           /* US2/AC5 — never a duplicate */
  notify('order-draft', 'Order ' + created.id + ' created in draft',
         'Commercial terms needed for ' + r.id, created.id);
  return { ok: true, po: created };
}

function returnScr(id, reason, remarks) {
  const r = scr(id);
  if (sameUserBlocked(r, 'return-scr'))
    return { ok: false, error: 'Maker-checker: you submitted this request, so you cannot return it.' };
  r.status = 'Returned';
  r.reason = reason; r.remarks = remarks || '';
  logAction(r.id, 'Returned for correction', { from: 'Sent for Approval', to: 'Returned', reason, remarks });
  return { ok: true };
}

function rejectScr(id, reason, remarks) {
  const r = scr(id);
  if (sameUserBlocked(r, 'reject-scr'))
    return { ok: false, error: 'Maker-checker: you submitted this request, so you cannot reject it.' };
  r.status = 'Rejected';
  r.reason = reason; r.remarks = remarks || '';
  logAction(r.id, 'Rejected', { from: 'Sent for Approval', to: 'Rejected', reason, remarks });
  return { ok: true };
}

/* A returned request becomes Modified once corrected, then goes back round. */
function modifyScr(id) {
  const r = scr(id);
  if (r.status !== 'Returned') return;
  r.status = 'Modified';
  logAction(r.id, 'Corrected', { from: 'Returned', to: 'Modified' });
}

/* ── Order / PO ─────────────────────────────────────────────────────────── */
function createPoForScr(r) {
  const existing = poForScr(r.id);
  if (existing) {
    /* A non-billable rejection sends the request back to the planner AND
       leaves nonBillableConfirmed = false on the order. Nothing the planner
       can edit touches that flag, so the corrected request came back approved
       and the buyer still could not generate: "Finance has not yet confirmed".
       Re-approval genuinely re-opens the decision. */
    /* Gated on the flag alone. A one-shot `nbReopened` latch meant a SECOND
       rejection and correction raised nothing at all — no log line, no
       notification, and the first rejection's reason still on the order. */
    if (existing.nonBillableConfirmed === false) {
      /* It stays PENDING, not null. null means "billable, no confirmation
         needed" in this model, so clearing it would let the buyer generate a
         zero-value order with no Finance decision at all — removing the very
         control the rejection was exercising. What was missing is that nothing
         told Finance the corrected request was back. */
      existing.reason = ''; existing.remarks = '';
      logAction(existing.id, 'Returned for a fresh non-billable decision', { by: 'system',
        remarks: 'Request was corrected and re-approved' });
      notify('nonbillable-reopen', existing.id + ' is back with you',
             'The request was corrected and re-approved; the non-billable decision is open again.',
             existing.id);
    }
    return existing;                           /* duplicate guard */
  }
  const zero = !r.billable || r.interUnit;     /* both force value 0 */
  /* The system pre-fills everything it already knows: the plant has exactly
     one purchase office, and the request may carry a rate contract — which
     the SCR form's own hint promised would "populate the rate on the order",
     while this constructor silently dropped it. The buyer confirms; they do
     not re-enter. */
  const office = purchaseOfficeMaster.find(o => o.plantId === r.plantId && o.status === 'Active');
  const rc = (!zero && r.rateContractId) ? rateContract(r.rateContractId) : null;
  const rec = {
    id: nextId('po', r.plantId), scrId: r.id, vendorId: r.vendorId,
    status: 'Draft', orderCategory: 'Purchase Order',
    orderType: r.billable ? 'Billable' : 'Non-Billable',
    interUnit: r.interUnit,
    purchaseOffice: office ? office.name : '', poSeries: '',
    vendorAddress: vendor(r.vendorId).address,
    gstin: vendor(r.vendorId).gstin,
    rateContractId: (rc && rc.status === 'Active') ? rc.id : '',
    rate: zero ? 0 : (rc && rc.status === 'Active' ? rc.rate : null),
    priceBasis: (rc && rc.status === 'Active') ? rc.priceBasis : '',
    currency: (rc && rc.status === 'Active') ? rc.currency : 'INR',
    taxCode: 'GST 18%', paymentTerms: '',
    expectedReceiptDate: '', lotType: 'Specific',
    value: 0, zeroValue: zero,
    nonBillableConfirmed: r.billable ? null : false,
    nonBillableConfirmedBy: null,
    completedBy: null, approvedBy: null, reason: '', remarks: ''
  };
  poStore.push(rec);
  /* Nobody pressed a button. This runs as a consequence of approval, and
     stamping the approver's name on it forges an action they did not take. */
  logAction(rec.id, 'Draft order created', { to: 'Draft', by: 'system' });
  return rec;
}

function poOrderValue(p) {
  if (p.zeroValue) return 0;
  const r = scr(p.scrId);
  if (!r) return 0;
  const qty = r.receivableItems.reduce((s, l) => s + Number(l.qty || 0), 0);
  return +( (Number(p.rate) || 0) * qty ).toFixed(2);
}

function validatePo(p) {
  const e = [];
  if (!p.purchaseOffice) e.push('Purchase Office is required.');
  if (!p.expectedReceiptDate) e.push('Expected Receipt Date is required.');
  if (!p.zeroValue) {
    if (!(Number(p.rate) > 0)) e.push('A Billable order needs a Rate greater than zero.');
    if (!p.priceBasis) e.push('Price Basis is required.');
    if (!p.currency) e.push('Currency is required.');
  } else if (poOrderValue(p) !== 0) {
    e.push('A Non-Billable or Inter-Unit order must have an Order Value of 0.');
  }
  if (p.rateContractId) {
    const rc = rateContract(p.rateContractId);
    if (rc.status !== 'Active') e.push('The selected Rate Contract is expired or inactive.');
    if (rc.vendorId !== p.vendorId) e.push('The Rate Contract does not belong to this Vendor.');
  }
  if (!p.zeroValue && p.nonBillableConfirmed === false) e.push('Non-Billable confirmation is still pending with Finance.');
  return e;
}

function generatePo(id) {
  const p = po(id);
  /* Non-billable orders wait for F&A before they can be generated (US18). */
  if (p.nonBillableConfirmed === false)
    return { ok: false, errors: ['Finance has not yet confirmed this Non-Billable request.'] };
  const errs = validatePo(p);
  if (errs.length) return { ok: false, errors: errs };
  p.value = poOrderValue(p);
  p.status = 'Created';
  p.completedBy = currentUserId;
  logAction(p.id, 'Order generated', { from: 'Draft', to: 'Created' });
  return { ok: true };
}

function approvePo(id) {
  const p = po(id);
  if (p.status !== 'Created') return { ok: false, error: 'Only a generated order can be approved.' };
  if (sameUserBlocked(p, 'approve-po'))
    return { ok: false, error: 'Maker-checker: you completed this order, so you cannot approve it.' };
  if (p.zeroValue && poOrderValue(p) !== 0)
    return { ok: false, error: 'Order Value must be 0 before a Non-Billable or Inter-Unit order can be approved.' };
  p.status = 'Approved';
  p.approvedBy = currentUserId;
  logAction(p.id, 'Approved', { from: 'Created', to: 'Approved' });
  notify('order-approved', 'Order ' + p.id + ' approved',
         'Shipments can now be created against ' + p.scrId, p.id);
  return { ok: true };
}

function returnPo(id, reason, remarks) {
  const p = po(id);
  if (sameUserBlocked(p, 'return-po'))
    return { ok: false, error: 'Maker-checker: you completed this order, so you cannot return it.' };
  p.status = 'Draft';
  p.reason = reason; p.remarks = remarks || '';
  logAction(p.id, 'Returned for correction', { from: 'Created', to: 'Draft', reason, remarks });
  return { ok: true };
}

/* Non-Billable confirmation — US18, restored.  The Variant Routing table says
   a zero-value order is "confirmed by Finance"; the RBAC matrix gives F&A/IDT
   a Confirm/Reject on Non-Billable SCRs.  Neither had a screen. */
function confirmNonBillable(id) {
  const p = po(id);
  if (p.nonBillableConfirmed !== false)
    return { ok: false, error: 'This order is not awaiting a non-billable decision.' };
  p.nonBillableConfirmed = true;
  p.nonBillableConfirmedBy = currentUserId;
  logAction(p.id, 'Non-Billable confirmed', { to: 'Confirmed' });
  return { ok: true };
}
function rejectNonBillable(id, reason, remarks) {
  const p = po(id);
  const r = scr(p.scrId);
  p.nonBillableConfirmed = false;
  r.status = 'Returned';
  r.reason = reason; r.remarks = remarks || '';
  logAction(p.id, 'Non-Billable rejected', { reason, remarks });
  logAction(r.id, 'Returned — non-billable rejected', { from: 'Approved', to: 'Returned', reason, remarks });
  return { ok: true };
}

/* ── Shipment ───────────────────────────────────────────────────────────────
   direction: 'Outward' draws from Issue Items, 'Return' from Receivable
   Items.  That single field is the whole of the Inter-Unit return — the rest
   of the chain runs unchanged either way. */
function openIssueQty(scrId, lineNo) {
  const r = scr(scrId);
  const line = r.issueItems.find(l => l.line === lineNo);
  if (!line) return 0;
  const shipped = shipmentStore
    .filter(s => s.scrId === scrId && s.status !== 'Cancelled')
    .reduce((sum, s) => sum + s.lines.filter(l => l.line === lineNo)
                                     .reduce((x, l) => x + Number(l.qty), 0), 0);
  return +(line.qty - shipped).toFixed(subConParams.decimalPrecision);
}

function createShipment(scrId, lines, direction) {
  const r = scr(scrId);
  const p = poForScr(scrId);
  if (!p || p.status !== 'Approved')
    return { ok: false, errors: ['Shipment creation needs an Approved Order.'] };

  const errs = [];
  lines.forEach(l => {
    const open = openIssueQty(scrId, l.line);
    if (l.qty <= 0) errs.push('Line ' + l.line + ': quantity must be greater than zero.');
    else if (l.qty > open + 0.001)
      errs.push('Line ' + l.line + ': only ' + fmtQty(open) + ' remains open.');
  });
  if (errs.length) return { ok: false, errors: errs };

  const sid = nextId('shipment', r.plantId);
  const rec = {
    id: sid, scrId, poId: p.id, vendorId: r.vendorId, plantId: r.plantId,
    direction: direction || 'Outward',
    status: 'Created', stage: 'In Progress',
    lines: lines.slice(), logistics: null,
    createdBy: currentUserId, createdOn: stampNow().date,
    reason: '', remarks: '',
    /* FRD additions. Blank until the shipment is SUBMITTED — FR7.1 is
       explicit that both read "Not Generated" beforehand, and showing a
       number before Stores can act on it is how a pick list gets printed for
       material nobody has committed yet. */
    outboundKeyNo: '', transferOrderNo: '',
    /* Defaults from the request, per FR6.1, and stays editable on the
       shipment because the decision can change between planning and
       dispatch. */
    logisticsRequired: !!r.logistics,
    logisticsComplete: false,
    /* FR12. Set by confirmShipment(), which is what moves stock out of
       Staging — NOT the gate. */
    confirmedAt: null, confirmedBy: null
  };

  /* Reserve as the shipment is created. A failure here must not leave a
     half-reserved shipment behind, so anything already claimed is rolled back. */
  for (let i = 0; i < lines.length; i++) {
    const il = r.issueItems.find(x => x.line === lines[i].line) || {};
    const res = reserveMaterial(scrId, sid, il.productId, r.plantId, Number(lines[i].qty), null);
    if (!res.ok) { releaseReservation(sid); return { ok: false, errors: [res.error] }; }
  }
  shipmentStore.push(rec);
  logAction(sid, 'Shipment created', { to: 'Created' });
  return { ok: true, shipment: rec };
}

function needsLotAllocation(sid) {
  const s = shipment(sid);
  const r = scr(s.scrId);
  return s.lines.some(l => {
    const il = r.issueItems.find(x => x.line === l.line) || {};
    return product(il.productId).lotControlled;
  });
}
function isAllocated(sid) {
  return reservationsFor(sid).every(r => !product(r.productId).lotControlled || r.allocated);
}

function goodIssueShipment(sid) {
  const s = shipment(sid);
  if (isReturned(s))
    return { ok: false, error: 'This shipment was returned for correction (' + s.returnReason +
                               '). Resolve it before issuing.' };
  if (needsLotAllocation(sid) && !isAllocated(sid))
    return { ok: false, error: 'Lot allocation is incomplete. Controlled material cannot be issued without it.' };
  const res = goodIssue(sid);
  if (!res.ok) return res;
  s.status = 'Freezed Outbound Release';
  s.issuedBy = currentUserId;
  logAction(sid, 'Good issue completed', { from: 'Created', to: 'Freezed Outbound Release' });
  notify('material-released', 'Material released for ' + sid,
         scr(s.scrId).logistics ? 'Logistics details required next.'
                                : 'Ready for a Delivery Note.', sid);
  return { ok: true };
}

/* ── FR7.6 · Submit Shipment ────────────────────────────────────────────────
   The Outbound Key and the Transfer / Warehousing Order are generated TOGETHER
   here, which the client confirmed explicitly. They are not the same document
   and the demo should never let them look like it:

     Outbound Key      the Stores PICK LIST — which item, which project, which
                       lot, how much. Printed or carried on a tab.
     Transfer Order    the matching internal STOCK-MOVEMENT record.

   Nothing moves physically. Submission confirms the reservation made at
   creation and routes the shipment to Stores. */
function submitShipment(sid) {
  const s = shipment(sid);
  if (!s) return { ok: false, error: 'Shipment not found.' };
  if (s.outboundKeyNo)
    return { ok: false, error: 'This shipment has already been submitted.' };
  if (s.status !== 'Created')
    return { ok: false, error: 'Only a Created shipment can be submitted.' };
  if (!reservationsFor(sid).length)
    return { ok: false, error: 'Nothing is reserved against this shipment.' };

  s.outboundKeyNo  = nextId('obk', s.plantId);
  s.transferOrderNo = nextId('transferOrder', s.plantId);
  s.submittedOn = stampNow().date;

  logAction(sid, 'Shipment submitted to Stores', {
    remarks: 'Outbound Key ' + s.outboundKeyNo + ' · Transfer Order ' + s.transferOrderNo });
  notify('outbound-ready', 'Pick list ready for ' + sid,
         s.outboundKeyNo + ' — ' + s.lines.length + ' line(s) to pick.', sid);
  return { ok: true, shipment: s };
}

/* ── FR12 · Planner / PMG Shipment Confirmation ─────────────────────────────
   The stage that catches the system up with reality. Security already let the
   lorry out at FR11; this is where the SYSTEM agrees the material is with the
   subcontractor, and it is the only thing that empties Staging.

   The client stated the sequence plainly: security clearance happens first,
   PMG confirmation performs the Staging-to-subcontracting movement. Doing it
   at the gate instead would be simpler and wrong. */
function confirmShipment(sid) {
  const s = shipment(sid);
  if (!s) return { ok: false, error: 'Shipment not found.' };
  if (s.confirmedAt) return { ok: false, error: 'This shipment is already confirmed.' };

  const c = challanForShipment(sid);
  if (!c) return { ok: false, error: 'No Challan exists against this shipment.' };
  if (c.status !== 'Gate Cleared')
    return { ok: false, error: 'Security has not cleared the gate yet. The material has not left the plant.' };

  const res = confirmShipmentOut(sid);
  if (!res.ok) return res;

  s.confirmedAt = stampNow().date;
  s.confirmedBy = currentUserId;
  logAction(sid, 'Shipment confirmed at vendor', {
    remarks: 'Inventory moved Staging → Sub-Contracting / At Vendor.' });
  notify('at-vendor', 'Material is now with ' + vendor(s.vendorId).name,
         sid + ' — awaiting the vendor ASN.', sid);
  return { ok: true };
}

/* ── FR14 · QC clearance of the ASN ─────────────────────────────────────────
   Gate inward is blocked until this passes, which is the whole point: the
   vendor's own inspection documents are checked before the lorry is let in,
   not after the material is already in the store. */
function clearAsn(asnId) {
  const a = asnStore.find(x => x.id === asnId);
  if (!a) return { ok: false, error: 'ASN not found.' };
  if (a.status === 'QC Cleared') return { ok: false, error: 'This ASN is already cleared.' };
  a.status = 'QC Cleared';
  a.clearedBy = currentUserId;
  a.clearedOn = stampNow().date;
  logAction(a.challanId, 'ASN cleared by QC', { to: 'QC Cleared', remarks: a.id });
  notify('asn-cleared', 'ASN ' + a.id + ' cleared for inward',
         'Security may now record gate entry.', a.challanId);
  return { ok: true };
}

function returnAsn(asnId, reason, remarks) {
  const a = asnStore.find(x => x.id === asnId);
  if (!a) return { ok: false, error: 'ASN not found.' };
  a.status = 'Returned';
  a.returnReason = reason;
  a.returnRemarks = remarks;
  logAction(a.challanId, 'ASN returned to vendor', { to: 'Returned', reason: reason, remarks: remarks });
  notify('asn-returned', 'ASN ' + a.id + ' returned to ' + vendor(a.vendorId).name, reason, a.challanId);
  return { ok: true };
}

/* ── FR15 · Security Gate Inward ────────────────────────────────────────────
   Records physical entry only. No inventory moves — the material is inside
   the plant but has not been received into a store, and conflating the two is
   how stock appears on a shelf nobody has counted. */
function recordGateInward(asnId) {
  const a = asnStore.find(x => x.id === asnId);
  if (!a) return { ok: false, error: 'ASN not found.' };
  if (a.status !== 'QC Cleared')
    return { ok: false, error: 'Gate entry needs a QC-cleared ASN. This one is ' + a.status + '.' };
  if (a.gateEntryAt) return { ok: false, error: 'Gate entry is already recorded for this ASN.' };

  a.gateEntryAt = stampNow().date;
  a.gateEntryBy = currentUserId;
  a.gatePassNo = nextId('gatepass', scr(a.scrId).plantId);
  logAction(a.challanId, 'Gate inward recorded', {
    remarks: a.id + ' · gate pass ' + a.gatePassNo });
  notify('gate-inward', 'Material returned through the gate',
         a.id + ' — Stores may now raise the receipt.', a.challanId);
  return { ok: true };
}

function cancelShipment(sid, reason, remarks) {
  const s = shipment(sid);
  if (hasLiveChallan(sid))
    return { ok: false, error: 'A live Challan exists against this shipment. Cancellation is blocked.' };
  if (s.status === 'Cancelled') return { ok: false, error: 'This shipment is already cancelled.' };
  if (s.status === 'Closed')    return { ok: false, error: 'A closed shipment cannot be cancelled.' };

  if (s.status === 'Created') releaseReservation(sid);
  else {
    const rev = reverseGoodIssue(sid);
    if (!rev.ok) return rev;
  }
  const d = dnoteForShipment(sid);
  if (d) { d.status = 'Voided'; logAction(d.id, 'Voided — shipment cancelled', { to: 'Voided' }); }

  const from = s.status;
  s.status = 'Cancelled';
  s.reason = reason; s.remarks = remarks || '';
  logAction(sid, 'Shipment cancelled', { from, to: 'Cancelled', reason, remarks });
  notify('shipment-cancelled', 'Shipment ' + sid + ' cancelled', reason +
         ' · reserved material is available again', s.scrId);
  return { ok: true };
}

/* ── Return as a state, not a log line ──────────────────────────────────────
   F05 · Four "Return" actions — Stores outbound, Logistics, Challan and the
   Security gate — wrote a log entry and changed nothing. Their toasts then
   asserted blocks that did not exist: a Stores user rejected a shipment, was
   told "good issue stays blocked", and good issue succeeded on the next click.
   A confirmation that lies is worse than a missing feature.

   Return is now the BRD's Stage Status — In Progress / Completed / Returned —
   held separately from the object's own status, exactly as the BRD requires.
   A returned record leaves the actor's queue, appears in the queue of whoever
   must fix it, and blocks the next step until it is resolved. */
function returnStage(rec, toRole, reason, remarks, label) {
  rec.stage = 'Returned';
  rec.returnedTo = toRole;
  rec.returnReason = reason;
  rec.returnRemarks = remarks || '';
  logAction(rec.id, label || 'Returned for correction', { to: 'Returned', reason, remarks });
  /* The role it was returned TO has to hear about it. Without this the record
     leaves the returner's queue and lands in silence: no tile, no badge, and
     the only route to Resolve is already knowing which record to open. */
  notifyReturn(rec, toRole, reason);
  return { ok: true };
}

/* Addressed to the position that must act, so it reaches the right bell. */
function notifyReturn(rec, toRole, reason) {
  NOTIFY_RULES['stage-returned'] = NOTIFY_RULES['stage-returned'] ||
    { rule: 'When a record is returned for correction', email: true, to: [] };
  NOTIFY_RULES['stage-returned'].to = [toRole];
  notify('stage-returned', rec.id + ' returned to you', reason, rec.id);
}

function resolveStage(rec, label) {
  if (rec.stage !== 'Returned') return { ok: false, error: 'This record is not awaiting correction.' };
  rec.stage = 'In Progress';
  const was = rec.returnReason;
  rec.returnedTo = null; rec.returnReason = ''; rec.returnRemarks = '';
  logAction(rec.id, label || 'Correction completed', { from: 'Returned', to: 'In Progress', remarks: was });
  return { ok: true };
}

function isReturned(rec) { return !!rec && rec.stage === 'Returned'; }

/* ── Logistics ──────────────────────────────────────────────────────────── */
const TRANSPORT_MODES = ['Road', 'Rail', 'Sea', 'Air'];
const MODE_REQUIRED = {
  Road: ['vehicleNo', 'driver', 'transporter'],
  Rail: ['transporter', 'lrNo'],
  Sea:  ['transporter', 'lrNo', 'insurance'],
  Air:  ['transporter', 'lrNo', 'insurance']
};

function saveLogistics(sid, data) {
  const s = shipment(sid);
  /* Guarded like goodIssue and generateDnote. Without this, Logistics could
     complete a shipment they had themselves returned, be told it was "ready
     for a Delivery Note", and silently remove it from every queue in the app —
     the Logistics list keys on `!s.logistics`, so filling the form hid it. */
  if (isReturned(s))
    return { ok: false, errors: ['This shipment was returned for correction (' + s.returnReason +
      '). It is with the ' + positionLabel(s.returnedTo) + ' until they resolve it.'] };
  const need = MODE_REQUIRED[data.mode] || [];
  const missing = need.filter(f => !data[f]);
  if (missing.length) {
    const names = { vehicleNo: 'Vehicle Number', driver: 'Driver', transporter: 'Transporter',
                    lrNo: 'LR / Transport Reference', insurance: 'Insurance' };
    return { ok: false, errors: missing.map(f => names[f] + ' is required for transport by ' + data.mode + '.') };
  }
  if (!(Number(data.packages) > 0)) return { ok: false, errors: ['Package count must be greater than zero.'] };
  if (!data.pkgType) return { ok: false, errors: ['Package Type is required.'] };  /* the * was untruthful */
  s.logistics = Object.assign({}, data, { completedBy: currentUserId });
  logAction(sid, 'Logistics completed', {});
  return { ok: true };
}

/* ── Delivery Note ──────────────────────────────────────────────────────── */
function generateDnote(sid) {
  const s = shipment(sid);
  if (s.status !== 'Freezed Outbound Release')
    return { ok: false, error: 'The shipment must be at Freezed Outbound Release first.' };
  if (isReturned(s))
    return { ok: false, error: 'This shipment was returned for correction (' + s.returnReason + ').' };
  const r = scr(s.scrId);
  if (r.logistics && !s.logistics)
    return { ok: false, error: 'Logistics details are required before a Delivery Note can be generated.' };
  const existing = dnoteForShipment(sid);
  if (existing) {
    return { ok: false, error: existing.status === 'Returned'
      ? 'Delivery Note ' + existing.id + ' was returned for correction. Correct and resubmit it rather than raising a new one.'
      : 'A Delivery Note already exists for this shipment.' };
  }
  const rec = {
    id: nextId('dnote', s.plantId), shipmentId: sid, scrId: s.scrId, poId: s.poId,
    status: 'Generated', generatedBy: currentUserId, generatedOn: stampNow().date,
    approvedBy: null, reason: '', remarks: ''
  };
  dnoteStore.push(rec);
  logAction(rec.id, 'Delivery Note generated', { to: 'Generated' });
  return { ok: true, dnote: rec };
}

function approveDnote(id) {
  const d = dnote(id);
  /* Guarded HERE, not only in the UI. The screen used to be the only thing
     stopping a Voided or already-Approved note being approved. */
  if (d.status !== 'Generated')
    return { ok: false, error: 'Only a note awaiting approval can be approved. This one is ' + d.status + '.' };
  const s = shipment(d.shipmentId);
  if (s.status !== 'Freezed Outbound Release')
    return { ok: false, error: 'Approval is blocked unless the shipment is at Freezed Outbound Release.' };
  d.status = 'Approved';
  d.approvedBy = currentUserId;
  logAction(d.id, 'Approved', { from: 'Generated', to: 'Approved' });
  return { ok: true };
}
function returnDnote(id, reason, remarks) {
  const d = dnote(id);
  if (d.status !== 'Generated')
    return { ok: false, error: 'Only a note awaiting approval can be returned.' };
  d.status = 'Returned';
  d.reason = reason; d.remarks = remarks || '';
  logAction(d.id, 'Returned for correction', { from: 'Generated', to: 'Returned', reason, remarks });
  return { ok: true };
}

/* F05 · A RETURNED NOTE WAS A PERMANENT DEAD END.

   Returning one left the shipment issued and outside the store, while
   generateDnote refused ("a Delivery Note already exists") and the detail
   screen offered nothing but Back. No queue counted it — Stores, D'Note
   Approver and Planner all read zero — so the record was both unactionable
   and invisible. The only escape was cancelling the whole shipment and
   reversing the good issue.

   Correcting it puts the same note back in front of the approver, which is
   what "returned for correction" is supposed to mean. */
function reissueDnote(id) {
  const d = dnote(id);
  if (d.status !== 'Returned') return { ok: false, error: 'Only a returned note can be corrected.' };
  const s = shipment(d.shipmentId);
  if (s.status !== 'Freezed Outbound Release')
    return { ok: false, error: 'The shipment has moved on; this note can no longer be corrected.' };
  d.status = 'Generated';
  d.correctedBy = currentUserId;
  d.reason = ''; d.remarks = '';
  logAction(d.id, 'Corrected and resubmitted', { from: 'Returned', to: 'Generated' });
  return { ok: true };
}

function returnedDnotes() { return dnoteStore.filter(d => d.status === 'Returned'); }

/* ── Challan ────────────────────────────────────────────────────────────── */
function generateChallan(dnId) {
  const d = dnote(dnId);
  if (d.status !== 'Approved') return { ok: false, error: 'The Delivery Note must be Approved first.' };
  if (challanForShipment(d.shipmentId)) return { ok: false, error: 'A Challan already exists for this shipment.' };
  const s = shipment(d.shipmentId);
  const rec = {
    id: nextId('challan', s.plantId), dnId: d.id, shipmentId: d.shipmentId,
    scrId: d.scrId, poId: d.poId, vendorId: s.vendorId,
    status: 'Created', generatedBy: currentUserId, generatedOn: stampNow().date,
    gateOutAt: null, returnByDate: null, closedBy: null, reason: '', remarks: ''
  };
  challanStore.push(rec);
  s.status = 'Challan Generated';
  logAction(rec.id, 'Challan generated', { to: 'Created' });
  logAction(s.id, 'Challan generated', { from: 'Freezed Outbound Release', to: 'Challan Generated' });
  notify('challan-generated', 'Challan ' + rec.id + ' generated',
         'Awaiting gate outward · ' + vendor(rec.vendorId).name, rec.id);
  return { ok: true, challan: rec };
}

/* returnChallan() lived here and is gone: the UI calls returnStage(), which
   actually blocks the gate. Leaving the old no-op around invited somebody to
   wire it back up and reintroduce the lying-confirmation bug. */

/* Gate outward — US10.  THE moment the return window starts.  The BRD is
   explicit that challan generation alone does not start it. */
/* F07 · THE GATE USED TO THROW AWAY ITS OWN EVIDENCE.

   Security is asked for the ACTUAL vehicle and package count beside the
   documented ones, and is forced through a mandatory reason when they differ.
   None of it was stored: only the reason was kept, the reason was rendered on
   no screen, and it never reached the activity log. So a substitute lorry left
   the plant and the challan still printed the original registration.

   Actuals are persisted and rendered; the difference reason goes into the
   audit trail where a difference at a gate belongs. */
function recordGateOutward(cid, detail) {
  const c = challan(cid);
  if (c.status !== 'Created') return { ok: false, error: 'Gate outward has already been recorded.' };
  if (isReturned(c))
    return { ok: false, error: 'This challan was returned for correction (' + c.returnReason + ').' };
  const d = dnote(c.dnId);
  if (!d || d.status !== 'Approved') return { ok: false, error: 'The Delivery Note is not Approved.' };

  const t = stampNow();
  c.status = 'Gate Cleared';
  c.gateOutAt = t.date + ' · ' + t.time;
  c.gateOutIso = t.iso;
  c.returnByDate = addDays(t.iso, subConParams.returnWindowDays);
  c.gateBy = currentUserId;

  detail = detail || {};
  c.actualVehicle = detail.actualVehicle || '';
  c.actualPackages = detail.actualPackages == null ? '' : detail.actualPackages;
  c.vehicleReason = detail.vehicleReason || '';
  c.packageReason = detail.packageReason || '';

  const diffs = [];
  if (c.vehicleReason) diffs.push('Vehicle: ' + c.actualVehicle + ' — ' + c.vehicleReason);
  if (c.packageReason) diffs.push('Packages: ' + c.actualPackages + ' — ' + c.packageReason);

  const s = shipment(c.shipmentId);
  s.status = 'Gate Cleared';
  logAction(c.id, 'Gate outward recorded', { from: 'Created', to: 'Gate Cleared',
    reason: diffs.length ? 'Differences recorded at gate' : '',
    remarks: (diffs.length ? diffs.join(' · ') + ' · ' : '') + 'Return by ' + c.returnByDate });
  logAction(s.id, 'Gate cleared', { from: 'Challan Generated', to: 'Gate Cleared' });
  notify('gate-recorded', 'Gate outward recorded for ' + c.id,
         'Return window open until ' + c.returnByDate, c.id);
  return { ok: true };
}

function addDays(iso, days) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
}

/* ── Return window monitoring — US19, restored ──────────────────────────────
   The BRD defines an Overdue challan status and a "close to expiry"
   notification, and nothing in it drives either.  This does.

   "Today" is the demo clock rather than the wall clock, so a walkthrough can
   move time forward deliberately and show an overdue challan on cue. */
let demoToday = null;
function today() { return demoToday ? new Date(demoToday) : new Date(demoClock); }

function daysRemaining(c) {
  if (!c.gateOutIso) return null;
  const due = new Date(c.gateOutIso);
  due.setDate(due.getDate() + subConParams.returnWindowDays);
  return Math.ceil((due - today()) / 86400000);
}

/* Flips challans overdue and clears them when the balance resolves.  Run on
   every render, so the state is never stale. */
/* Runs on every render of five screens, so it must be idempotent and must not
   attribute its transitions to whoever is looking. `by:'system'` keeps the
   audit trail honest — nobody caused a deadline to pass. */
function refreshReturnWindows() {
  challanStore.forEach(c => {
    if (c.status === 'Closed' || !c.gateOutIso) return;
    const left = daysRemaining(c);
    const outstanding = challanOutstanding(c.id) > 0.001;

    /* The BRD's near-expiry alert. challansNearingExpiry() was computed and
       shown on the dashboard but never notified, so the alert the document
       specifies did not exist. Raised once per challan. */
    if (outstanding && left >= 0 && left <= subConParams.returnWarnDays && !c.warnedNearExpiry) {
      c.warnedNearExpiry = true;
      notify('window-closing', 'Return window on ' + c.id + ' closes in ' + left + ' days',
             vendor(c.vendorId).name + ' · ' + fmtQty(challanOutstanding(c.id)) + ' outstanding', c.id);
    }
    /* An ASN that has come and gone without the material. */
    const a = latestAsn(c.id);
    if (a && outstanding && !c.warnedAsnLate && new Date(a.expectedDate) < today()) {
      c.warnedAsnLate = true;
      notify('asn-overdue', vendor(c.vendorId).name + ' has missed its own declared date',
             'Promised ' + fmtQty(a.qty) + ' on ' + fmtDate(a.expectedDate) + ' against ' + c.id, c.id);
    }

    if (left < 0 && outstanding && c.status !== 'Overdue') {
      c.status = 'Overdue';
      logAction(c.id, 'Return window expired', { from: 'Gate Cleared', to: 'Overdue',
        by: 'system', remarks: 'Return-by date ' + c.returnByDate + ' passed' });
    } else if (c.status === 'Overdue' && (!outstanding || left >= 0)) {
      c.status = 'Gate Cleared';
      logAction(c.id, 'Overdue cleared', { from: 'Overdue', to: 'Gate Cleared', by: 'system' });
    }
  });
}

function challansNearingExpiry() {
  return challanStore.filter(c => {
    if (c.status === 'Closed' || !c.gateOutIso) return false;
    const left = daysRemaining(c);
    return left >= 0 && left <= subConParams.returnWarnDays && challanOutstanding(c.id) > 0.001;
  });
}

/* ── IMR / inward ───────────────────────────────────────────────────────── */
function receivableReceived(scrId, lineNo) {
  return imrStore.filter(i => i.scrId === scrId && i.status === 'Confirmed')
    .reduce((s, i) => s + i.lines.filter(l => l.line === lineNo)
                                 .reduce((x, l) => x + Number(l.qty), 0), 0);
}
function receivableOutstanding(scrId, lineNo) {
  const r = scr(scrId);
  const line = r.receivableItems.find(l => l.line === lineNo);
  if (!line) return 0;
  if (line.shortClosed) return 0;
  return +(line.qty - receivableReceived(scrId, lineNo)).toFixed(subConParams.decimalPrecision);
}
/* PER CHALLAN, NOT PER DEAL.

   This summed the whole request's outstanding and ignored which challan was
   asked about, so two challans on one deal each reported the deal's full
   figure. That number is printed as a per-challan "Outstanding" column on five
   internal screens and — worse — as "Still owed" in the vendor portal, where
   it told a subcontractor they owed the same quantity twice. It also drove the
   overdue monitor, so a challan whose material had entirely come back still
   flipped Overdue because a sibling was outstanding.

   The receivable is held at deal level, so a challan's share is apportioned by
   how much of the issued material went out on its shipment. Receipts are
   already stamped with challanId and are counted directly. */
/* WHY THIS IS A DEAL-LEVEL FIGURE, DELIBERATELY.

   An attempt to make it per-challan — apportioning the expected quantity by
   each shipment's share of the issued material, minus receipts stamped with
   that challan — was worse than the repetition it replaced, in three ways:

     · Expected was apportioned but received was actual, so the two could never
       reconcile. A vendor holding 20 KG under one challan was told they owed
       0.000 on it and 10.000 on the other, when the deal owed 8.
     · A challan whose apportioned figure fell to zero never flipped Overdue,
       so short-close refused forever and the deal had no exit at all.
     · The share recomputed from the current shipment set on every render, so
       creating a second shipment silently halved what an external party was
       told they owed, with no receipt and no notification.

   The receivable obligation is held against the REQUEST, not the challan, so
   any per-challan number is a guess. Screens say "on this request" rather than
   presenting a deal figure under a per-challan heading. */
function challanReceived(cid) {
  return imrStore.filter(i => i.challanId === cid && i.status === 'Confirmed')
    .reduce((s, i) => s + i.lines.reduce((x, l) => x + Number(l.qty), 0), 0);
}

function dealOutstanding(scrId) {
  const r = scr(scrId);
  return r ? +r.receivableItems.reduce((s, l) => s + receivableOutstanding(scrId, l.line), 0)
              .toFixed(subConParams.decimalPrecision) : 0;
}

function challanOutstanding(cid) {
  const c = challan(cid);
  return c ? dealOutstanding(c.scrId) : 0;
}

function createImr(cid, lines, balances, scraps, reason, remarks) {
  const c = challan(cid);
  const errs = [];
  if (!lines.length && !balances.length && !scraps.length)
    errs.push('Record at least one received, balance or scrap quantity.');
  lines.forEach(l => {
    if (!(l.qty > 0)) { errs.push('Received quantity must be greater than zero.'); return; }
    const out = receivableOutstanding(c.scrId, l.line);
    const tol = out * (1 + subConParams.receiptTolerancePct / 100);
    if (l.qty > tol + 0.001)
      errs.push('Line ' + l.line + ': ' + fmtQty(l.qty) + ' exceeds the outstanding ' +
                fmtQty(out) + ' beyond the ' + subConParams.receiptTolerancePct + '% tolerance.');
  });

  /* BALANCE AND SCRAP ARE BOUNDED TOO.

     Received lines were validated and these were not, so a typo went straight
     into stock: 9000 typed against 141 KG open added 9000 KG of real inventory
     to the Main location, while the ledger capped its own figure at 171 — and
     because the cap silenced the negative balance that used to surface it, the
     screen then read "Every issue line is fully accounted for." */
  const open = {};
  issueBalance(c.scrId).forEach(b => { open[b.productId] = (open[b.productId] || 0) + b.balance; });
  const claimed = {};
  balances.concat(scraps).forEach(x => { claimed[x.productId] = (claimed[x.productId] || 0) + Number(x.qty); });
  Object.keys(claimed).forEach(pid => {
    const avail = +(open[pid] || 0).toFixed(subConParams.decimalPrecision);
    if (claimed[pid] > avail + 0.001)
      errs.push(product(pid).name + ': ' + fmtQty(claimed[pid]) + ' ' + product(pid).uom +
                ' recorded as returned or scrapped, but only ' + fmtQty(avail) + ' is still unaccounted for.');
  });

  if (errs.length) return { ok: false, errors: errs };

  const rec = {
    id: nextId('imr', shipment(c.shipmentId).plantId), challanId: cid, scrId: c.scrId,
    shipmentId: c.shipmentId, lines: lines.slice(), balances: balances.slice(),
    scraps: scraps.slice(), status: 'Created', reason: reason || '', remarks: remarks || '',
    createdBy: currentUserId, createdOn: stampNow().date
  };
  imrStore.push(rec);
  logAction(rec.id, 'Incoming Material Record created', { to: 'Created' });
  return { ok: true, imr: rec };
}

function confirmImr(id) {
  const rec = imr(id);
  if (rec.status !== 'Created') return { ok: false, error: 'This record has already been processed.' };
  const c = challan(rec.challanId);
  const plantId = shipment(rec.shipmentId).plantId;

  rec.lines.forEach(l => {
    goodReceipt(plantId, l.productId, l.qty, '');
    applyConsumption(rec.scrId, l.productId, Number(l.qty));
  });
  /* Post to stock only what the ledger actually accepted. applyAcrossRows caps
     at the remaining balance and returns the amount it took; writing the typed
     figure to stock instead is how phantom inventory appeared. */
  rec.balances.forEach(b => {
    const accepted = recordBalanceReturn(rec.scrId, b.productId, Number(b.qty));
    if (accepted > 0) balanceReturn(plantId, b.productId, accepted, '');
  });
  rec.scraps.forEach(s => recordScrap(rec.scrId, s.productId, Number(s.qty)));

  rec.status = 'Confirmed';
  rec.confirmedBy = currentUserId;
  logAction(rec.id, 'Receipt confirmed', { from: 'Created', to: 'Confirmed' });

  const out = challanOutstanding(c.id);
  notify('material-received', 'Material received against ' + c.id,
         rec.lines.map(l => product(l.productId).name + ' · ' + fmtQty(l.qty)).join(', '), c.id);
  if (out > 0.001) {
    logAction(c.id, 'Balance pending', { remarks: fmtQty(out) + ' still outstanding' });
    notify('balance-pending', fmtQty(out) + ' still outstanding on ' + c.id,
           vendor(c.vendorId).name + ' · return by ' + c.returnByDate, c.id);
  }
  refreshReturnWindows();
  return { ok: true, outstanding: out };
}

/* ── Reconciliation and closure ─────────────────────────────────────────── */
function reconciliationBlockers(scrId) {
  const r = scr(scrId);
  const out = [];
  r.receivableItems.forEach(l => {
    const o = receivableOutstanding(scrId, l.line);
    if (o > 0.001) out.push('Receivable line ' + l.line + ' (' + product(l.productId).name + ') has ' +
                            fmtQty(o) + ' ' + l.uom + ' outstanding.');
  });
  /* Summed per product. issueBalance returns one row per SHIPMENT, so a deal
     shipped in two parts printed the identical sentence twice in one error
     box, which reads as a rendering fault rather than two real problems. */
  const byProduct = {};
  issueBalance(scrId).forEach(b => {
    byProduct[b.productId] = +((byProduct[b.productId] || 0) + b.balance).toFixed(subConParams.decimalPrecision);
  });
  Object.keys(byProduct).forEach(pid => {
    if (Math.abs(byProduct[pid]) > 0.001)
      out.push('Issue material ' + product(pid).name + ' has ' + fmtQty(byProduct[pid]) +
               ' ' + product(pid).uom + ' unaccounted for.');
  });
  imrStore.filter(i => i.scrId === scrId && i.status === 'Created')
          .forEach(i => out.push('Incoming Material Record ' + i.id + ' is still unconfirmed.'));
  return out;
}

function confirmFullReceipt(scrId) {
  const blockers = reconciliationBlockers(scrId);
  if (blockers.length) return { ok: false, errors: blockers };
  const r = scr(scrId);
  r.fullReceipt = true;
  r.fullReceiptBy = currentUserId;
  logAction(scrId, 'Full receipt confirmed', {});
  return { ok: true };
}

function closeChallan(cid) {
  const c = challan(cid);
  const r = scr(c.scrId);
  if (!r.fullReceipt) return { ok: false, errors: ['Full Receipt has not been confirmed.'] };
  const blockers = reconciliationBlockers(c.scrId);
  if (blockers.length) return { ok: false, errors: blockers };

  const was = c.status;                    /* captured BEFORE the mutation, or
                                              the log read "Closed → Closed" on
                                              the one transition that matters */
  c.status = 'Closed';
  c.closedBy = currentUserId;
  logAction(c.id, 'Challan closed', { from: was, to: 'Closed' });

  const s = shipment(c.shipmentId);
  const sWas = s.status;
  s.status = 'Closed';
  logAction(s.id, 'Shipment closed', { from: sWas, to: 'Closed' });

  closeDealIfSettled(c.scrId);
  return { ok: true };
}

/* The Deal closes only when NO shipment against it is still open. */
function closeDealIfSettled(scrId) {
  const r = scr(scrId);
  const open = shipmentsForScr(scrId).filter(x => x.status !== 'Closed' && x.status !== 'Cancelled');
  if (open.length) return false;
  const was = r.status;
  r.status = 'Closed';
  logAction(r.id, 'Request closed', { from: was, to: 'Closed' });
  const p = poForScr(scrId);
  if (p && p.status !== 'Closed') {
    const pWas = p.status;
    p.status = 'Closed';
    logAction(p.id, 'Order closed', { from: pWas, to: 'Closed' });
  }
  notify('challan-closed', r.id + ' closed', r.title + ' · fully reconciled', r.id);
  return true;
}

/* A DEAL CAN REACH CLOSURE WITHOUT EVER HAVING SHIPPED.

   Short-closing a request that never dispatched cleared every blocker and let
   Finance confirm full receipt — and then closure was unreachable, because
   closeChallan was the only writer of a Closed status and there was no
   challan. The screen even said "the challan can be closed" with none in
   existence. The request sat at Approved with a Short-Closed order forever. */
function closeDealDirect(scrId) {
  const r = scr(scrId);
  if (!r.fullReceipt) return { ok: false, errors: ['Full Receipt has not been confirmed.'] };
  const blockers = reconciliationBlockers(scrId);
  if (blockers.length) return { ok: false, errors: blockers };
  const live = challansForScr(scrId).filter(c => c.status !== 'Closed');
  if (live.length)
    return { ok: false, errors: ['Challan ' + live[0].id + ' is still open. Close it rather than the request.'] };
  closeDealIfSettled(scrId);
  return { ok: true };
}

/* ── Short-close ────────────────────────────────────────────────────────── */
/* F10 · SHORT-CLOSE WAS UNREACHABLE IN THE ONLY SITUATION THAT NEEDS IT.

   The old guard refused while ANY challan on the deal was open. But a challan
   stays open until it is closed, closing needs Full Receipt, and Full Receipt
   needs zero outstanding — which is precisely what short-close exists to
   clear. All three exits refused each other, so a vendor who simply never
   returned the balance left the deal with no way out. US14 was dead code: it
   could only be reached before a challan existed, i.e. before anything had
   shipped, which is the one moment nobody wants it.

   What the guard should actually protect against is short-closing material
   that is still legitimately in motion. Two things establish that it is not:
   the return window has expired, or something has already come back against
   this challan. Either means the vendor has had their chance.

   It also checked every shipment on the deal, so an unrelated second shipment
   blocked short-close on the first. It is scoped to the line's own challans. */
function challansForScr(scrId) { return challanStore.filter(c => c.scrId === scrId); }

function shortCloseEligibility(scrId) {
  const open = challansForScr(scrId).filter(c => c.status !== 'Closed');
  if (!open.length) return { ok: true };                    /* nothing in motion */
  /* THE WINDOW MUST HAVE EXPIRED. NOTHING ELSE COUNTS.

     This also accepted "a receipt has arrived against this challan" as proof
     the vendor had had their chance. That is exactly backwards: a partial
     receipt is evidence the vendor IS performing. Verified — on a challan with
     45 days still to run, 8 PCS outstanding and a vendor notice on file
     promising those 8 PCS, short-close was permitted and the deal closed.

     Short-close means "no longer expected". While the clock is running the
     quantity is still expected, and a delivery promise on file says so in the
     vendor's own words. */
  /* A challan whose window has passed counts as expired whatever its status
     says. Keying only on `status === 'Overdue'` let a challan that had never
     been flipped hold short-close shut permanently — and then the refusal read
     "still within its return window — -98 days remaining", which is nonsense
     on its face. */
  const running = open.filter(c => c.status !== 'Overdue' && (daysRemaining(c) == null || daysRemaining(c) >= 0));
  if (!running.length) return { ok: true };

  const soonest = running.map(c => ({ c: c, left: daysRemaining(c) }))
                         .sort((a, b) => (a.left == null ? 1e9 : a.left) - (b.left == null ? 1e9 : b.left))[0];
  const promise = latestAsn(soonest.c.id);
  return { ok: false, error: 'Material on ' + soonest.c.id + ' is still within its return window — ' +
    Math.max(0, soonest.left) + ' day' + (soonest.left === 1 ? '' : 's') + ' remaining, to ' + soonest.c.returnByDate + '.' +
    (promise ? ' The vendor has also given notice that ' + fmtQty(promise.qty) +
               ' is coming back on ' + fmtDate(promise.expectedDate) + '.' : '') +
    ' Short-close becomes available once the window expires.' };
}

function initiateShortClose(scrId, lineNo, reason, remarks) {
  const r = scr(scrId);
  const line = r.receivableItems.find(l => l.line === lineNo);
  if (!line) return { ok: false, error: 'Line not found.' };
  if (receivableOutstanding(scrId, lineNo) <= 0.001)
    return { ok: false, error: 'There is no outstanding quantity to short-close.' };
  const el = shortCloseEligibility(scrId);
  if (!el.ok) return el;
  line.shortClosePending = { reason, remarks: remarks || '', by: currentUserId };
  logAction(r.id, 'Short-close initiated', { reason, remarks,
    remarks2: 'Receivable line ' + lineNo });
  return { ok: true };
}

function confirmShortClose(scrId, lineNo) {
  const r = scr(scrId);
  const line = r.receivableItems.find(l => l.line === lineNo);
  if (!line || !line.shortClosePending) return { ok: false, error: 'No short-close is awaiting confirmation.' };

  /* Capture the shortfall BEFORE marking the line closed — afterwards
     receivableOutstanding() reports zero by definition. */
  const shortfall = receivableOutstanding(scrId, lineNo);
  line.shortClosed = true;
  line.shortCloseReason = line.shortClosePending.reason;
  line.shortCloseQty = shortfall;
  delete line.shortClosePending;

  /* The issue material behind the shortfall is written off against it, or
     closure would still be blocked by the quantity this just resolved. */
  if (shortfall > 0.001) recordWriteOff(scrId, line.productId, shortfall);

  const p = poForScr(scrId);
  if (p) { p.status = 'Short-Closed'; logAction(p.id, 'Short-closed', { to: 'Short-Closed' }); }
  logAction(r.id, 'Short-close confirmed', {
    reason: line.shortCloseReason,
    remarks: 'Receivable line ' + lineNo + ' · ' + fmtQty(shortfall) + ' ' + line.uom +
             ' no longer expected; issue material written off at BOM ratio' });
  return { ok: true };
}

/* ── ASN — vendor advance shipping notice (M-08) ────────────────────────────
   OPTIONAL BY DESIGN.  A vendor may raise one or not, and nothing internal
   waits on it: an ASN only ever pre-fills or annotates. */
function createAsn(cid, data) {
  const c = challan(cid);
  const rec = Object.assign({
    id: nextId('asn'), challanId: cid, scrId: c.scrId, vendorId: c.vendorId,
    status: 'Raised', raisedOn: stampNow().date, raisedBy: currentUserId
  }, data);
  asnStore.push(rec);
  /* Attributed to the vendor, not to whoever is signed in — the log names who
     actually acted, and on an ASN that is the subcontractor. */
  logAction(c.id, 'ASN raised by vendor', {
    by: 'u-vendor',
    remarks: fmtQty(data.qty) + ' expected ' + fmtDate(data.expectedDate) +
             (data.vehicle ? ' · vehicle ' + data.vehicle : '') });
  notify('asn-raised', vendor(c.vendorId).name + ' expects to return on ' + fmtDate(data.expectedDate),
         fmtQty(data.qty) + ' of ' + product(data.productId).name + ' against ' + c.id, c.id);
  return { ok: true, asn: rec };
}

/* The most recent notice, which is what the inward screen pre-fills from. */
function latestAsn(cid) {
  const list = asnsForChallan(cid);
  return list.length ? list[list.length - 1] : null;
}

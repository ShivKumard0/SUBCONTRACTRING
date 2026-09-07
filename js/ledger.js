/* ==========================================================================
   INVENTORY LEDGER  (M-04)

   The heaviest state in the build, written once so every later module reads
   the same numbers.

   THE ONE IDEA THAT MATTERS.  "Reserved" is a VIRTUAL location.  Material
   does not physically move when it is reserved — it stays exactly where it
   is, and only its AVAILABILITY is blocked for one Deal.  So the ledger never
   moves a quantity between rows on reservation; it records a claim against a
   row and subtracts claims when reporting what is available.

   The BRD's own worked example is the acceptance test:
     500 available → reserve 200 → 300 available + 200 reserved
     cancel        → 500 available + 0 reserved, exactly

   Material positions (FRD "Material / Stock Position"):
     Available          in a Main location, unclaimed
     Reserved           claimed for a Deal, still physically in Main
     Staging            picked and released by Stores, still INSIDE the plant
     At Vendor          confirmed out, outside the plant
     Returned to Store  received back into a Receiving location

   WHY STAGING IS A POSITION AND NOT A DETAIL.  The earlier build moved stock
   straight from Reserved to At Vendor at good issue, which is what the older
   BRD implied.  The FRD and the recorded client walkthrough both contradict
   that, and the difference is not cosmetic — it spans five process stages.

   Material sits in Staging through the Delivery Note, its approval, the
   Logistics leg, Challan generation AND the physical gate-out.  It becomes
   At Vendor only when the Planner confirms the shipment (FR12), which the
   client stated explicitly: security clears the gate first, and PMG
   confirmation is what performs the Staging-to-subcontracting movement.

   Collapsing the two would make the system claim material is with the vendor
   while it is still standing in the yard waiting for a challan — which is a
   version of the very inventory drift this module exists to fix. */

/* Physical stock.  One row per product × plant × location × lot. */
const stockRows = [
  { productId: 'P-1001', plantId: 'PL-TRY', locationId: 'SL-TRY-MAIN', lot: 'LOT-7734', qty: 500 },
  { productId: 'P-1001', plantId: 'PL-TRY', locationId: 'SL-TRY-MAIN', lot: 'LOT-7735', qty: 320 },
  { productId: 'P-1001', plantId: 'PL-TRY', locationId: 'SL-TRY-MAIN', lot: 'LOT-7801', qty: 180 },
  { productId: 'P-1002', plantId: 'PL-TRY', locationId: 'SL-TRY-MAIN', lot: '',          qty: 640 },
  { productId: 'P-1003', plantId: 'PL-TRY', locationId: 'SL-TRY-MAIN', lot: '',          qty: 45  },
  { productId: 'P-1006', plantId: 'PL-TRY', locationId: 'SL-TRY-MAIN', lot: 'LOT-6612', qty: 1450 },
  { productId: 'P-1006', plantId: 'PL-TRY', locationId: 'SL-TRY-MAIN', lot: 'LOT-6613', qty: 890 },
  { productId: 'P-1007', plantId: 'PL-TRY', locationId: 'SL-TRY-MAIN', lot: 'LOT-9001', qty: 60 },
  { productId: 'P-1005', plantId: 'PL-HZR', locationId: 'SL-HZR-MAIN', lot: '',          qty: 24 }
];

/* Claims against stock.  A reservation is a CLAIM, not a movement.
   status: 'reserved' → 'released' (good issue) → 'closed' (received back)
           'cancelled' releases the claim without a movement. */
const reservations = [];
let reservationSeq = 0;

/* Material picked and released by Stores but still inside the plant, per
   shipment.  Written at good issue, emptied by confirmShipmentOut(). */
const staging = [];

/* Material sitting outside the plant, per shipment.  Written when the Planner
   confirms the shipment (FR12), drawn down as IMRs confirm. */
const atVendor = [];

/* ── Reading the ledger ─────────────────────────────────────────────────── */

function physicalQty(productId, plantId, locationId, lot) {
  return stockRows
    .filter(r => r.productId === productId && r.plantId === plantId &&
                 (!locationId || r.locationId === locationId) &&
                 (lot == null || r.lot === lot))
    .reduce((s, r) => s + r.qty, 0);
}

/* ONLY 'reserved' BLOCKS.  A released claim must not, and getting this wrong
   double-counts: good issue physically removes the quantity from the Main
   location AND, if the claim kept blocking, subtracted it a second time.  The
   symptom was 1000 KG on the shelf, 258 issued, and the app reporting 484
   available instead of 742.

   The rule is that a claim blocks only while the stock it claims is still
   sitting in Main. Once it leaves, the stock row itself is smaller and the
   claim has done its job. */
function reservedQty(productId, plantId, lot, exceptShipmentId) {
  return reservations
    .filter(r => r.productId === productId && r.plantId === plantId &&
                 (lot == null || r.lot === lot) &&
                 r.status === 'reserved' &&
                 r.shipmentId !== exceptShipmentId)
    .reduce((s, r) => s + r.qty, 0);
}

/* WHAT A NEW DEAL MAY TAKE.  Physical stock in the Main location, minus every
   live claim against it — "material already reserved for another Deal shall
   not be considered available" (BRD business rules). */
function availableQty(productId, plantId, lot) {
  const main = locationByRole(plantId, 'Main').id;
  return physicalQty(productId, plantId, main, lot) - reservedQty(productId, plantId, lot);
}

/* Lots that can still be drawn from, for the allocation screen. */
function availableLots(productId, plantId) {
  const main = locationByRole(plantId, 'Main').id;
  return stockRows
    .filter(r => r.productId === productId && r.plantId === plantId && r.locationId === main)
    .map(r => ({ lot: r.lot, physical: r.qty, available: r.qty - reservedQty(productId, plantId, r.lot) }))
    .filter(r => r.available > 0);
}

function receivedQty(productId, plantId) {
  const rcv = locationByRole(plantId, 'Receiving').id;
  return physicalQty(productId, plantId, rcv, null);
}

/* ── Writing to the ledger ──────────────────────────────────────────────────
   Every mutation returns {ok, error} so a caller can refuse cleanly rather
   than half-applying a change. */

/* Reserve for a shipment. No physical movement — a claim is recorded. */
function reserveMaterial(scrId, shipmentId, productId, plantId, qty, lot) {
  const avail = availableQty(productId, plantId, lot);
  if (qty <= 0) return { ok: false, error: 'Quantity must be greater than zero.' };
  if (qty > avail) {
    return { ok: false, error: 'Only ' + fmtQty(avail) + ' ' + product(productId).uom +
                              ' is available. The rest is reserved for another Deal.' };
  }
  reservations.push({
    id: 'RSV-' + String(++reservationSeq).padStart(4, '0'),
    scrId, shipmentId, productId, plantId, lot: lot || '', qty,
    status: 'reserved', allocatedLots: []
  });
  return { ok: true };
}

function reservationsFor(shipmentId) {
  return reservations.filter(r => r.shipmentId === shipmentId && r.status !== 'cancelled');
}

/* Cancellation before good issue: the claim disappears and availability
   returns to exactly what it was. Nothing physical is touched because nothing
   physical ever happened. */
function releaseReservation(shipmentId) {
  reservationsFor(shipmentId).forEach(r => { if (r.status === 'reserved') r.status = 'cancelled'; });
}

/* Lot allocation (US16). Identifies WHICH physical stock is going. It does not
   reduce availability again — that already happened at reservation. */
function allocateLots(shipmentId, productId, lots) {
  const rs = reservationsFor(shipmentId).filter(r => r.productId === productId && r.status === 'reserved');
  if (!rs.length) return { ok: false, error: 'Nothing is reserved for this product on this shipment.' };
  const need = rs.reduce((s, r) => s + r.qty, 0);
  const got = lots.reduce((s, l) => s + Number(l.qty || 0), 0);
  if (Math.abs(got - need) > 0.001) {
    return { ok: false, error: 'Allocate exactly ' + fmtQty(need) + ' ' + product(productId).uom +
                               '. Currently allocated: ' + fmtQty(got) + '.' };
  }
  for (let i = 0; i < lots.length; i++) {
    const row = stockRows.find(r => r.productId === productId && r.lot === lots[i].lot &&
                                    r.locationId === locationByRole(rs[0].plantId, 'Main').id);
    if (!row) return { ok: false, error: 'Lot ' + lots[i].lot + ' is not held in this store.' };
    const free = row.qty - reservedQty(productId, rs[0].plantId, lots[i].lot, shipmentId);
    if (Number(lots[i].qty) > free + 0.001)
      return { ok: false, error: 'Lot ' + lots[i].lot + ' has only ' + fmtQty(free) + ' eligible.' };
  }
  rs[0].allocatedLots = lots.slice();
  rs.forEach(r => r.allocated = true);
  return { ok: true };
}

/* Good issue (US6). THE physical movement out: stock leaves the Main location
   and the claim becomes 'released'. Only what was reserved for THIS shipment
   may go. */
function goodIssue(shipmentId) {
  const rs = reservationsFor(shipmentId).filter(r => r.status === 'reserved');
  if (!rs.length) return { ok: false, error: 'Nothing is reserved against this shipment.' };
  rs.forEach(r => {
    const main = locationByRole(r.plantId, 'Main').id;
    const lots = (r.allocatedLots && r.allocatedLots.length)
      ? r.allocatedLots
      : [{ lot: r.lot, qty: r.qty }];
    lots.forEach(l => {
      const row = stockRows.find(x => x.productId === r.productId && x.plantId === r.plantId &&
                                      x.locationId === main && x.lot === (l.lot || ''));
      if (row) row.qty -= Number(l.qty);
    });
    r.status = 'released';
    /* Into STAGING, not At Vendor. The material has left the shelf but is
       still inside the plant — five stages of documents stand between here
       and the gate. */
    staging.push({ shipmentId, scrId: r.scrId, productId: r.productId,
                   plantId: r.plantId, qty: r.qty });
  });
  return { ok: true };
}

/* FR12 · Planner / PMG Shipment Confirmation.  THE movement that puts stock
   with the subcontractor, performed after Security has already cleared the
   gate.  Nothing physical happens here — the lorry left at stage 11 — this is
   the system catching up with what already happened, which is precisely the
   gap the client described. */
function confirmShipmentOut(shipmentId) {
  const rows = staging.filter(s => s.shipmentId === shipmentId);
  if (!rows.length) return { ok: false, error: 'Nothing is staged against this shipment.' };
  rows.forEach(s => {
    atVendor.push({ shipmentId: s.shipmentId, scrId: s.scrId, productId: s.productId,
                    plantId: s.plantId, qty: s.qty, consumed: 0, returned: 0, scrap: 0 });
  });
  for (let i = staging.length - 1; i >= 0; i--)
    if (staging[i].shipmentId === shipmentId) staging.splice(i, 1);
  return { ok: true };
}

/* What is standing in the yard for a shipment, for the inventory strip. */
function stagedQty(shipmentId) {
  return staging.filter(s => !shipmentId || s.shipmentId === shipmentId)
                .reduce((t, s) => t + s.qty, 0);
}

/* Cancellation AFTER good issue but before a live challan (US15/AC4): the
   outbound movement is reversed and stock is restored. */
function reverseGoodIssue(shipmentId) {
  const rs = reservationsFor(shipmentId).filter(r => r.status === 'released');
  if (!rs.length) return { ok: false, error: 'This shipment has not been issued.' };
  rs.forEach(r => {
    const main = locationByRole(r.plantId, 'Main').id;
    const lots = (r.allocatedLots && r.allocatedLots.length)
      ? r.allocatedLots
      : [{ lot: r.lot, qty: r.qty }];
    lots.forEach(l => {
      let row = stockRows.find(x => x.productId === r.productId && x.plantId === r.plantId &&
                                    x.locationId === main && x.lot === (l.lot || ''));
      if (row) row.qty += Number(l.qty);
      else stockRows.push({ productId: r.productId, plantId: r.plantId, locationId: main,
                            lot: l.lot || '', qty: Number(l.qty) });
    });
    r.status = 'cancelled';
  });
  /* Both downstream positions are cleared: a cancellation can arrive while
     the material is still staged, or after it has been confirmed out. */
  for (let i = staging.length - 1; i >= 0; i--)
    if (staging[i].shipmentId === shipmentId) staging.splice(i, 1);
  for (let i = atVendor.length - 1; i >= 0; i--)
    if (atVendor[i].shipmentId === shipmentId) atVendor.splice(i, 1);
  return { ok: true };
}

/* Good receipt (US11). Processed material lands in the Receiving location. */
function goodReceipt(plantId, productId, qty, lot) {
  const rcv = locationByRole(plantId, 'Receiving').id;
  let row = stockRows.find(r => r.productId === productId && r.plantId === plantId &&
                                r.locationId === rcv && r.lot === (lot || ''));
  if (row) row.qty += Number(qty);
  else stockRows.push({ productId, plantId, locationId: rcv, lot: lot || '', qty: Number(qty) });
}

/* Unprocessed material coming back goes to MAIN, not Receiving: it was never
   transformed, so it returns to available stock (US11/AC10). */
function balanceReturn(plantId, productId, qty, lot) {
  const main = locationByRole(plantId, 'Main').id;
  let row = stockRows.find(r => r.productId === productId && r.plantId === plantId &&
                                r.locationId === main && r.lot === (lot || ''));
  if (row) row.qty += Number(qty);
  else stockRows.push({ productId, plantId, locationId: main, lot: lot || '', qty: Number(qty) });
}

/* ── Issue-material balance (US12) ──────────────────────────────────────────
   The Issue-Material Balance Sheet the BRD mocks up:

     Balance = Issued − Consumed@BOM − Returned Unprocessed − Scrap

   Closure is blocked while any line's balance is non-zero. */
function issueBalance(scrId) {
  const out = [];
  atVendor.filter(a => a.scrId === scrId).forEach(a => {
    const off = a.writtenOff || 0;
    out.push({
      productId: a.productId,
      shipmentId: a.shipmentId,          /* two rows for one product are one
                                            per shipment — the sheet has to say
                                            which, or they look duplicated */
      issued: a.qty,
      consumed: a.consumed,
      returned: a.returned,
      scrap: a.scrap,
      writtenOff: off,
      balance: +(a.qty - a.consumed - a.returned - a.scrap - off).toFixed(subConParams.decimalPrecision)
    });
  });
  return out;
}

/* A confirmed short-close says the outstanding output is never coming back —
   so the issue material that would have become it is never coming back either.
   Leaving it on the balance sheet would keep closure blocked by the very
   quantity the short-close just resolved, which was the other half of the
   deadlock. It is written off against the short-close, not silently dropped:
   the quantity stays visible in its own column on the balance sheet. */
/* APPORTIONED ACROSS SHIPMENTS, AND NEVER BELOW ZERO.

   The first version added the FULL shortfall × ratio to every atVendor row for
   the deal. There is one row per shipment, so a request shipped in two halves
   — which this module explicitly supports — had the whole write-off applied
   twice. Verified: 129 KG issued per row, 232.2 KG written off against each,
   balance −129.000 on both, and `confirmFullReceipt` refusing forever with
   "has −129.000 KG unaccounted for". That is a worse deadlock than the one the
   write-off was added to clear, because nothing can push a negative back up.

   The total is now computed once per product and shared out across that
   product's rows in proportion to what each still has outstanding, capped at
   each row's remaining balance so none can go negative. */
function recordWriteOff(scrId, receivableProductId, shortfallQty) {
  const products = atVendor.filter(a => a.scrId === scrId)
                           .map(a => a.productId)
                           .filter((v, i, s) => s.indexOf(v) === i);
  products.forEach(pid => {
    const ratio = bomRatio(pid, receivableProductId);
    if (ratio == null) return;
    applyAcrossRows(scrId, pid, shortfallQty * ratio, 'writtenOff');
  });
}

/* ── The one place a quantity is shared across shipments ────────────────────
   THERE IS ONE atVendor ROW PER SHIPMENT. Any quantity that belongs to the
   DEAL — consumption, an unprocessed return, scrap, a short-close write-off —
   has to be shared across those rows, and every one of the four originally got
   it wrong in one of two ways:

     consumed  added the FULL amount to EVERY row  → double-counted, balance
               went negative, and nothing in the UI can push a negative back up
     returned  added the whole amount to the FIRST row only
     scrap     same
     writtenOff was fixed in isolation, which is why the bug survived here

   All four now go through this. It shares `qty` in proportion to what each row
   still has unaccounted for, and caps every row at its own remaining balance
   so none can go negative. */
function applyAcrossRows(scrId, productId, qty, field) {
  const group = atVendor.filter(a => a.scrId === scrId && a.productId === productId);
  if (!group.length) return 0;

  const capacity = group.map(a =>
    Math.max(0, a.qty - a.consumed - a.returned - a.scrap - (a.writtenOff || 0)));
  const total = capacity.reduce((s, c) => s + c, 0);
  if (total <= 0) return 0;

  let amount = Math.min(Number(qty), total);      /* never more than is open */
  const dp = subConParams.decimalPrecision;
  let placed = 0;

  group.forEach((a, i) => {
    if (capacity[i] <= 0) return;
    const share = Math.min(capacity[i], +(amount * (capacity[i] / total)).toFixed(dp));
    a[field] = +((a[field] || 0) + share).toFixed(dp);
    placed = +(placed + share).toFixed(dp);
  });

  /* Rounding can leave a sliver; put it wherever there is still room. */
  let residue = +(amount - placed).toFixed(dp);
  for (let i = 0; i < group.length && residue > 0; i++) {
    const used = group[i].consumed + group[i].returned + group[i].scrap + (group[i].writtenOff || 0);
    const room = +(group[i].qty - used).toFixed(dp);
    if (room <= 0) continue;
    const take = Math.min(room, residue);
    group[i][field] = +((group[i][field] || 0) + take).toFixed(dp);
    residue = +(residue - take).toFixed(dp);
  }
  return amount;
}

/* Consumption is DERIVED from confirmed receipt, never typed:
   Consumed = Received × BOM Ratio, at the configured precision. */
function applyConsumption(scrId, receivableProductId, receivedQty) {
  const products = atVendor.filter(a => a.scrId === scrId)
                           .map(a => a.productId)
                           .filter((v, i, s) => s.indexOf(v) === i);
  products.forEach(pid => {
    const ratio = bomRatio(pid, receivableProductId);
    if (ratio == null) return;
    applyAcrossRows(scrId, pid, receivedQty * ratio, 'consumed');
  });
}

/* Both return the quantity actually absorbed, so a caller that also writes to
   stock posts the accepted figure rather than the typed one. */
function recordBalanceReturn(scrId, productId, qty) { return applyAcrossRows(scrId, productId, qty, 'returned'); }
function recordScrap(scrId, productId, qty)         { return applyAcrossRows(scrId, productId, qty, 'scrap'); }

/* Everything the Stock-level report needs, in one pass. */
function stockPosition() {
  const rows = [];
  plantMaster.forEach(pl => {
    productMaster.forEach(pr => {
      const main = locationByRole(pl.id, 'Main').id;
      const rcv = locationByRole(pl.id, 'Receiving').id;
      const phys = physicalQty(pr.id, pl.id, main, null);
      const rsv = reservedQty(pr.id, pl.id, null);
      const recv = physicalQty(pr.id, pl.id, rcv, null);
      const stg = staging.filter(s => s.productId === pr.id && s.plantId === pl.id)
                         .reduce((s, a) => s + a.qty, 0);
      const out = atVendor.filter(a => a.productId === pr.id && a.plantId === pl.id)
                          .reduce((s, a) => s + (a.qty - a.consumed - a.returned - a.scrap), 0);
      if (!phys && !rsv && !recv && !out && !stg) return;
      /* Reported furthest-along-first, so a product part-way through the
         journey names the position that needs attention rather than the one
         it started in. */
      rows.push({
        productId: pr.id, plantId: pl.id,
        available: phys - rsv, reserved: rsv, staging: stg, atVendor: out, received: recv,
        position: out > 0 ? 'At Vendor / In Transit'
                 : stg > 0 ? 'Staging'
                 : rsv > 0 ? 'Reserved'
                 : recv > 0 ? 'Returned to Store' : 'Available'
      });
    });
  });
  return rows;
}

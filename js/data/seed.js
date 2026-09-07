/* ==========================================================================
   SEED

   The BRD's own worked example, driven through the REAL state machine rather
   than hand-written into the stores.  That matters: if a transition is
   broken, the app fails to seed and the bug surfaces immediately instead of
   hiding behind fixture data that could never have been produced by the code.

     SCR SUB-000318 · PO-SUB-004106 · Shipment CSN-000512
     DN-000871 · Challan CHN-33-000442
     L&T Trichy Works → Sri Balaji Engineering Works, Chennai
     SA516 Gr70 Plate 258.000 KG (LOT-7734) · Weld consumables 40.000 KG (FIM)
     WIP – Drilled flange 20.000 PCS expected back
   ========================================================================== */

function actAs(id, fn) {
  const prev = currentUserId;
  currentUserId = id;
  try { fn(); } finally { currentUserId = prev; }
}

function seedDemo() {

  /* THE SEED SPANS THREE WEEKS, NOT ONE MORNING.
     With every record created in a single hour, dwell times all read "today",
     the dashboard has no aging to show, and Recent Activity looks like a
     single burst — the tell of fixture data. Each scenario block below starts
     its own clock, so queues carry believable ages against the demo "today"
     of 24 Aug 2026. */
  demoClock = new Date(2026, 7, 4, 9, 10);        /* 4 Aug — the worked example */

  /* ── 1 · The worked example, taken all the way to "material at vendor" ── */
  let mainId = null;

  actAs('u-planner', () => {
    const r = createScr({
      title: 'Shell course fabrication – Unit 4',
      plantId: 'PL-TRY', vendorId: 'V-2001', workType: 'Job',
      scrBase: 'Project', projectId: 'S077334', projectElement: '10090', activity: 'ACT01',
      billable: true, interUnit: false, logistics: true, fim: true,
      rateContractId: 'RC-3001',
      remarks: 'Drilling and edge preparation on issued plate. Free-issue welding consumables supplied.',
      headerText: 'Job work — material remains the property of L&T Trichy Works throughout.',
      issueItems: [
        { line: 1, productId: 'P-1001', qty: 258, uom: 'KG', plantId: 'PL-TRY',
          locationId: 'SL-TRY-MAIN', hsn: '7208', taxCode: 'GST 18%',
          reasonRemoval: 'Job Work – Fabrication', fim: false },
        { line: 2, productId: 'P-1002', qty: 40, uom: 'KG', plantId: 'PL-TRY',
          locationId: 'SL-TRY-MAIN', hsn: '8311', taxCode: 'GST 18%',
          reasonRemoval: 'Free Issue Material', fim: true }
      ],
      receivableItems: [
        { line: 1, productId: 'P-1003', qty: 20, uom: 'PCS', expectedDate: '2026-10-02', hsn: '7307' }
      ]
    });
    mainId = r.id;
    submitScr(r.id);
  });

  actAs('u-approver', () => approveScr(mainId));

  actAs('u-buyer', () => {
    const p = poForScr(mainId);
    p.purchaseOffice = 'Trichy Purchase Office';
    p.expectedReceiptDate = '2026-10-02';
    p.rateContractId = 'RC-3001';
    const rc = rateContract('RC-3001');
    p.rate = rc.rate; p.priceBasis = rc.priceBasis; p.currency = rc.currency;
    p.paymentTerms = '30 days from receipt';
    generatePo(p.id);
  });

  actAs('u-approver', () => approvePo(poForScr(mainId).id));

  let shipId = null;
  actAs('u-planner', () => {
    const res = createShipment(mainId, [{ line: 1, qty: 258 }, { line: 2, qty: 40 }], 'Outward');
    if (res.ok) shipId = res.shipment.id;
  });

  actAs('u-matplan', () => {
    if (shipId) allocateLots(shipId, 'P-1001', [{ lot: 'LOT-7734', qty: 258 }]);
  });

  actAs('u-stores', () => { if (shipId) goodIssueShipment(shipId); });

  actAs('u-logistics', () => {
    if (shipId) saveLogistics(shipId, {
      mode: 'Road', transporter: 'Sri Venkateswara Carriers', vehicleNo: 'TN 45 BQ 1123',
      driver: 'S. Murugan', lrNo: 'LR-33912', insurance: 'Policy 4471/2026',
      pkgType: 'Crate', packages: 3
    });
  });

  let dnId = null, chId = null;
  actAs('u-stores', () => {
    const res = generateDnote(shipId);
    if (res.ok) dnId = res.dnote.id;
  });
  actAs('u-dnote', () => { if (dnId) approveDnote(dnId); });
  actAs('u-finance', () => {
    const res = generateChallan(dnId);
    if (res.ok) chId = res.challan.id;
  });
  /* A substitute lorry, so the "Recorded at gate" block on the challan and the
     difference reason in the audit trail are both visible in the demo rather
     than only reachable by driving the gate screen yourself. */
  actAs('u-security', () => { if (chId) recordGateOutward(chId, {
    actualVehicle: 'TN 45 CQ 8890', actualPackages: 3,
    vehicleReason: 'Vehicle Replaced — original lorry failed its check at the gate' }); });

  /* A partial receipt, so reconciliation has something real to show and the
     balance sheet opens mid-journey rather than empty. Eleven days after
     dispatch — a believable turnaround, not same-morning. */
  demoClock = new Date(2026, 7, 15, 10, 5);
  actAs('u-stores', () => {
    if (!chId) return;
    const res = createImr(chId, [{ line: 1, productId: 'P-1003', qty: 12, uom: 'PCS' }], [], [],
      'Partial Quantity Returned', 'First batch of 12 flanges returned.');
    if (res.ok) confirmImr(res.imr.id);
  });

  /* ── 2 · An overdue challan, so the return-window monitor has something to
         act on.  Its gate outward is backdated by winding the demo clock. ── */
  const keep = new Date(demoClock);
  demoClock = new Date(2026, 5, 2, 8, 30);      /* 2 Jun 2026 */
  let overdueId = null;

  actAs('u-planner', () => {
    const r = createScr({
      title: 'Nozzle machining – Unit 2', plantId: 'PL-TRY', vendorId: 'V-2002',
      /* The one Production Order-based request in the demo, and deliberately
         the client's own worked example: cutting stays in house, bending and
         plating go out. Without it the whole FR1.3 branch is dead code that
         nobody sees. */
      scrBase: 'Production Order', productionOrderId: 'PRO-004412',
      operationFrom: 20, operationTo: 30,
      operationDesc: 'Bend to profile and hot-dip galvanise. Return for final inspection.',
      workType: 'Job', billable: true, interUnit: false, logistics: false, fim: false,
      rateContractId: 'RC-3003', remarks: 'Machining of forged nozzle blanks.',
      issueItems: [{ line: 1, productId: 'P-1007', qty: 24, uom: 'PCS', plantId: 'PL-TRY',
        locationId: 'SL-TRY-MAIN', hsn: '7326', taxCode: 'GST 18%',
        reasonRemoval: 'Job Work – Machining', fim: false }],
      receivableItems: [{ line: 1, productId: 'P-1004', qty: 24, uom: 'PCS',
        expectedDate: '2026-07-20', hsn: '7307' }]
    });
    overdueId = r.id;
    submitScr(r.id);
  });
  actAs('u-approver', () => approveScr(overdueId));
  actAs('u-buyer', () => {
    const p = poForScr(overdueId);
    p.purchaseOffice = 'Trichy Purchase Office';
    p.expectedReceiptDate = '2026-07-20';
    p.rateContractId = 'RC-3003';
    const rc = rateContract('RC-3003');
    p.rate = rc.rate; p.priceBasis = rc.priceBasis; p.currency = rc.currency;
    generatePo(p.id);
  });
  actAs('u-approver', () => approvePo(poForScr(overdueId).id));

  let s2 = null;
  actAs('u-planner', () => {
    const res = createShipment(overdueId, [{ line: 1, qty: 24 }], 'Outward');
    if (res.ok) s2 = res.shipment.id;
  });
  actAs('u-matplan', () => { if (s2) allocateLots(s2, 'P-1007', [{ lot: 'LOT-9001', qty: 24 }]); });
  actAs('u-stores', () => { if (s2) goodIssueShipment(s2); });
  actAs('u-stores', () => {                       /* logistics = No, so straight to the note */
    const res = generateDnote(s2);
    if (res.ok) actAs('u-dnote', () => approveDnote(res.dnote.id));
  });
  actAs('u-finance', () => {
    const d = dnoteForShipment(s2);
    if (d && d.status === 'Approved') {
      const res = generateChallan(d.id);
      if (res.ok) actAs('u-security', () => recordGateOutward(res.challan.id, {}));
    }
  });
  demoClock = keep;

  /* ── 3 · An Inter-Unit request awaiting approval — zero value, and its
         return leg will run the same screens as any other. Raised 18 Aug, so
         the approver's queue shows six days of dwell. ── */
  demoClock = new Date(2026, 7, 18, 10, 30);
  actAs('u-planner', () => {
    const r = createScr({
      title: 'Shell forming – transfer to Hazira', plantId: 'PL-TRY', vendorId: 'V-2003',
      scrBase: 'Project', projectId: 'S077410', projectElement: '20110', activity: 'ACT01',
      workType: 'Job', billable: true, interUnit: true, logistics: true, fim: false,
      remarks: 'Inter-unit processing. Order raised for traceability at zero value.',
      issueItems: [{ line: 1, productId: 'P-1006', qty: 930, uom: 'KG', plantId: 'PL-TRY',
        locationId: 'SL-TRY-MAIN', hsn: '7208', taxCode: 'GST 18%',
        reasonRemoval: 'Inter-Unit Processing', fim: false }],
      receivableItems: [{ line: 1, productId: 'P-1005', qty: 20, uom: 'PCS',
        expectedDate: '2026-11-15', hsn: '7308' }]
    });
    submitScr(r.id);
  });

  /* ── 4 · A non-billable request, sitting where the restored US18 bites:
         approved, order drafted, and blocked until Finance confirms. ── */
  demoClock = new Date(2026, 7, 20, 14, 0);
  let nbId = null;
  actAs('u-planner', () => {
    const r = createScr({
      title: 'Rework – shell course weld repair', plantId: 'PL-TRY', vendorId: 'V-2001',
      scrBase: 'Project', projectId: 'S077334', projectElement: '10090', activity: 'ACT02',
      workType: 'Job', billable: false, nonBillableReason: 'Rework at Own Cost',
      interUnit: false, logistics: true, fim: false,
      remarks: 'Rectification at own cost. No commercial value.',
      issueItems: [{ line: 1, productId: 'P-1001', qty: 120, uom: 'KG', plantId: 'PL-TRY',
        locationId: 'SL-TRY-MAIN', hsn: '7208', taxCode: 'GST 18%',
        reasonRemoval: 'Job Work – Fabrication', fim: false }],
      receivableItems: [{ line: 1, productId: 'P-1003', qty: 8, uom: 'PCS',
        expectedDate: '2026-10-28', hsn: '7307' }]
    });
    nbId = r.id;
    submitScr(r.id);
  });
  actAs('u-approver', () => approveScr(nbId));

  /* ── 5 · A draft, so the Planner's dashboard is not empty. ── */
  demoClock = new Date(2026, 7, 23, 16, 40);
  actAs('u-planner', () => {
    createScr({
      title: 'Plate edge preparation – Unit 7', plantId: 'PL-TRY', vendorId: 'V-2001',
      scrBase: 'Project', projectId: 'S077334', projectElement: '10018', activity: 'ACT01',
      workType: 'Job', billable: true, interUnit: false, logistics: true, fim: false,
      remarks: 'Draft — awaiting confirmation of quantities from planning.',
      issueItems: [], receivableItems: []
    });
  });

  /* ── 6 · A vendor notice on the main challan, so the inward screen has one
         to pre-fill from — and the overdue challan deliberately has none, so
         both states are visible side by side. Raised AS THE VENDOR, so the
         audit trail names who actually acted. ── */
  if (chId) {
    actAs('u-vendor', () => {
      createAsn(chId, { productId: 'P-1003', qty: 8, expectedDate: '2026-09-28',
                        vehicle: 'TN 45 BQ 1123' });
    });
  }

  /* ── 7 · Work for the roles whose queues were empty. ──────────────────────
     Four positions — Material Planner, Stores, Security and D'Note Approver —
     landed on a single zero tile because the seed drove every deal past their
     step. Anyone reviewing as those roles concluded the screen was broken.
     Two more deals stop deliberately: one at allocation, one at the gate. */
  demoClock = new Date(2026, 7, 21, 9, 20);   /* three days in allocation queue */
  let awaitAlloc = null;
  actAs('u-planner', () => {
    const r = createScr({
      title: 'Plate profiling – Unit 9', plantId: 'PL-TRY', vendorId: 'V-2001',
      scrBase: 'Project', projectId: 'S077410', projectElement: '20110', activity: 'ACT02',
      workType: 'Job', billable: true, interUnit: false, logistics: true, fim: false,
      rateContractId: 'RC-3002', remarks: 'Profile cutting on controlled plate. Lots to be nominated.',
      issueItems: [{ line: 1, productId: 'P-1006', qty: 620, uom: 'KG', plantId: 'PL-TRY',
        locationId: 'SL-TRY-MAIN', hsn: '7208', taxCode: 'GST 18%',
        reasonRemoval: 'Job Work – Fabrication', fim: false }],
      receivableItems: [{ line: 1, productId: 'P-1005', qty: 13, uom: 'PCS',
        expectedDate: '2026-11-04', hsn: '7308' }]
    });
    awaitAlloc = r.id;
    submitScr(r.id);
  });
  actAs('u-approver', () => approveScr(awaitAlloc));
  actAs('u-buyer', () => {
    const p = poForScr(awaitAlloc);
    p.purchaseOffice = 'Trichy Purchase Office';
    p.expectedReceiptDate = '2026-11-04';
    p.rateContractId = 'RC-3002';
    const rc = rateContract('RC-3002');
    p.rate = rc.rate; p.priceBasis = rc.priceBasis; p.currency = rc.currency;
    generatePo(p.id);
  });
  actAs('u-approver', () => approvePo(poForScr(awaitAlloc).id));
  /* Stops here: created and reserved, lots not yet nominated. This is the
     Material Planner's queue, and then the Stores outbound queue behind it. */
  actAs('u-planner', () => createShipment(awaitAlloc, [{ line: 1, qty: 620 }], 'Outward'));

  /* A challan sitting at the gate, so Security has something to verify and
     the D'Note approver's queue is not the only evidence they exist. */
  demoClock = new Date(2026, 7, 22, 11, 15);
  let awaitGate = null;
  actAs('u-planner', () => {
    const r = createScr({
      title: 'Flange machining – Unit 3', plantId: 'PL-TRY', vendorId: 'V-2002',
      scrBase: 'Project', projectId: 'S077334', projectElement: '10018', activity: 'ACT04',
      workType: 'Job', billable: true, interUnit: false, logistics: false, fim: false,
      rateContractId: 'RC-3003', remarks: 'Second batch of nozzle blanks.',
      issueItems: [{ line: 1, productId: 'P-1007', qty: 18, uom: 'PCS', plantId: 'PL-TRY',
        locationId: 'SL-TRY-MAIN', hsn: '7326', taxCode: 'GST 18%',
        reasonRemoval: 'Job Work – Machining', fim: false }],
      receivableItems: [{ line: 1, productId: 'P-1004', qty: 18, uom: 'PCS',
        expectedDate: '2026-11-20', hsn: '7307' }]
    });
    awaitGate = r.id;
    submitScr(r.id);
  });
  actAs('u-approver', () => approveScr(awaitGate));
  actAs('u-buyer', () => {
    const p = poForScr(awaitGate);
    p.purchaseOffice = 'Trichy Purchase Office';
    p.expectedReceiptDate = '2026-11-20';
    p.rateContractId = 'RC-3003';
    const rc = rateContract('RC-3003');
    p.rate = rc.rate; p.priceBasis = rc.priceBasis; p.currency = rc.currency;
    generatePo(p.id);
  });
  actAs('u-approver', () => approvePo(poForScr(awaitGate).id));
  let s3 = null;
  actAs('u-planner', () => {
    const res = createShipment(awaitGate, [{ line: 1, qty: 18 }], 'Outward');
    if (res.ok) s3 = res.shipment.id;
  });
  actAs('u-matplan', () => { if (s3) allocateLots(s3, 'P-1007', [{ lot: 'LOT-9001', qty: 18 }]); });
  actAs('u-stores', () => { if (s3) goodIssueShipment(s3); });
  actAs('u-stores', () => {
    const res = generateDnote(s3);
    if (res.ok) actAs('u-dnote', () => approveDnote(res.dnote.id));
  });
  actAs('u-finance', () => {
    const d = dnoteForShipment(s3);
    if (d && d.status === 'Approved') generateChallan(d.id);   /* stops before the gate */
  });

  /* Two more stops so Logistics and the D'Note Approver also land on real
     work: one shipment issued and awaiting transport, one note generated and
     awaiting approval. Every one of the eleven positions now has something. */
  function quickDeal(title, vendorId, logistics, prod, qty, rprod, rqty, rcId, date) {
    let id = null;
    actAs('u-planner', () => {
      const r = createScr({
        title, plantId: 'PL-TRY', vendorId, workType: 'Job', billable: true,
        scrBase: 'Project', projectId: 'S077334', projectElement: '10090', activity: 'ACT01',
        interUnit: false, logistics, fim: false, rateContractId: rcId, remarks: '',
        issueItems: [{ line: 1, productId: prod, qty, uom: product(prod).uom, plantId: 'PL-TRY',
          locationId: 'SL-TRY-MAIN', hsn: product(prod).hsn, taxCode: 'GST 18%',
          reasonRemoval: 'Job Work – Fabrication', fim: false }],
        receivableItems: [{ line: 1, productId: rprod, qty: rqty, uom: product(rprod).uom,
          expectedDate: date, hsn: product(rprod).hsn }]
      });
      id = r.id; submitScr(r.id);
    });
    actAs('u-approver', () => approveScr(id));
    actAs('u-buyer', () => {
      const p = poForScr(id);
      p.purchaseOffice = 'Trichy Purchase Office';
      p.expectedReceiptDate = date;
      p.rateContractId = rcId;
      const rc = rateContract(rcId);
      p.rate = rc.rate; p.priceBasis = rc.priceBasis; p.currency = rc.currency;
      generatePo(p.id);
    });
    actAs('u-approver', () => approvePo(poForScr(id).id));
    let sid = null;
    actAs('u-planner', () => {
      const res = createShipment(id, [{ line: 1, qty }], 'Outward');
      if (res.ok) sid = res.shipment.id;
    });
    if (sid && product(prod).lotControlled)
      actAs('u-matplan', () => allocateLots(sid, prod, [{ lot: availableLots(prod, 'PL-TRY')[0].lot, qty }]));
    actAs('u-stores', () => { if (sid) goodIssueShipment(sid); });
    return sid;
  }

  /* Stops at Logistics: issued, logistics required, transport not yet arranged. */
  demoClock = new Date(2026, 7, 22, 15, 0);
  quickDeal('Shell edge preparation – Unit 5', 'V-2001', true, 'P-1002', 60, 'P-1003', 6, 'RC-3001', '2026-11-12');

  /* Stops at Delivery Note approval: issued, logistics not required, note raised. */
  demoClock = new Date(2026, 7, 23, 9, 45);
  const sDn = quickDeal('Bracket machining – Unit 6', 'V-2002', false, 'P-1007', 6, 'P-1004', 6, 'RC-3003', '2026-11-18');
  actAs('u-stores', () => { if (sDn) generateDnote(sDn); });

  /* "Today" is fixed rather than derived from the action clock. Otherwise
     simply using the app moved the date forward and could flip a challan
     overdue while somebody was reading a screen. */
  demoToday = new Date(2026, 7, 24, 12, 0);
  refreshReturnWindows();

  /* Older seeded events start read, but the most recent stay unread so every
     role opens with a live badge. Marking the whole history read made the
     notification work invisible until you performed an action yourself. */
  notifications.forEach((n, i) => { n.read = i >= 6; });
}

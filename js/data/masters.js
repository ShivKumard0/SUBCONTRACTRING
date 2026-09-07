/* ==========================================================================
   MASTER DATA  (M-01)

   Seeded from the Manufacturing rows of Master Data.xlsx only — the rest of
   that workbook is retail and wholesale taxonomy (Grocery, Fashion,
   Restaurant, Diagnostic) with no bearing on L&T.  The concrete entities come
   from the worked example embedded in the BRD's own document mockups, so a
   demo walkthrough matches the paperwork the client already signed off:

     L&T Trichy Works  →  Sri Balaji Engineering Works, Chennai
     SA516 Gr70 Plate 20 mm · 258.000 KG · LOT-7734
     Weld consumables 40.000 KG (free issue)
     WIP – Drilled flange 20.000 PCS

   Every master carries Active/Inactive.  An inactive record is unselectable
   on a NEW transaction but still resolves on historical ones (US20/AC9), so
   nothing is ever hard-deleted here either.
   ========================================================================== */

/* ── Products ───────────────────────────────────────────────────────────────
   Product Type drives the journey: Raw goes out as Issue Material,
   Semi-Finished comes back as a Receivable, Finished is the end state. */
const productMaster = [
  { id: 'P-1001', name: 'SA516 Gr70 Plate 20 mm', type: 'Raw',           main: 'Steel',       child: 'Plate',     hsn: '7208', uom: 'KG',  cost: 85,   taxType: 'GST', taxPct: 18, lotControlled: true,  status: 'Active' },
  { id: 'P-1002', name: 'Weld consumables',       type: 'Raw',           main: 'Fabrication', child: 'Consumable',hsn: '8311', uom: 'KG',  cost: 95,   taxType: 'GST', taxPct: 18, lotControlled: false, status: 'Active' },
  { id: 'P-1003', name: 'WIP – Drilled flange',   type: 'Semi - Finished',main:'Fabrication', child: 'Shell',     hsn: '7307', uom: 'PCS', cost: 450,  taxType: 'GST', taxPct: 18, lotControlled: false, status: 'Active' },
  { id: 'P-1004', name: 'Machined flange assembly',type:'Finished',      main: 'Job Work',    child: 'Machining', hsn: '7307', uom: 'PCS', cost: 1250, taxType: 'GST', taxPct: 18, lotControlled: false, status: 'Active' },
  { id: 'P-1005', name: 'Fabricated shell course',type: 'Semi - Finished',main:'Fabrication', child: 'Shell',     hsn: '7308', uom: 'PCS', cost: 3200, taxType: 'GST', taxPct: 18, lotControlled: false, status: 'Active' },
  { id: 'P-1006', name: 'IS2062 E250 Plate 12 mm',type: 'Raw',           main: 'Steel',       child: 'Plate',     hsn: '7208', uom: 'KG',  cost: 62,   taxType: 'GST', taxPct: 18, lotControlled: true,  status: 'Active' },
  { id: 'P-1007', name: 'Nozzle forging blank',   type: 'Raw',           main: 'Steel',       child: 'Forging',   hsn: '7326', uom: 'PCS', cost: 2100, taxType: 'GST', taxPct: 18, lotControlled: true,  status: 'Active' },
  { id: 'P-1008', name: 'Legacy plate 8 mm',      type: 'Raw',           main: 'Steel',       child: 'Plate',     hsn: '7208', uom: 'KG',  cost: 48,   taxType: 'GST', taxPct: 18, lotControlled: true,  status: 'Inactive' }
];

const PRODUCT_TYPES = ['Raw', 'Semi - Finished', 'Finished'];
const UOMS = ['KG', 'PCS', 'MT', 'M', 'SQM'];

/* ── Plants and storage locations ───────────────────────────────────────────
   Store Category = Manufacturing.  Three location ROLES matter and the
   process is meaningless without all three:

     Main       what is genuinely available
     Reserved   VIRTUAL. Material never physically moves here; its
                availability is simply blocked for one Deal.
     Staging    picked and ready to dispatch, still INSIDE the plant. Material
                sits here through the delivery note, the challan and the
                physical gate-out, and leaves only when the Planner confirms
                the shipment (FR12).
     Receiving  where processed material lands on the way back */
const plantMaster = [
  { id: 'PL-TRY', name: 'L&T Trichy Works', category: 'Manufacturing', gstin: '33LTPLC0421A1Z8',
    city: 'Tiruchirappalli', state: 'Tamil Nadu', pincode: '620014', country: 'India',
    street: 'Kailasapuram, Heavy Engineering Complex', status: 'Active',
    locations: [
      { id: 'SL-TRY-MAIN', name: 'Main Store',            role: 'Main',      zone: 'Z-A', status: 'Active' },
      { id: 'SL-TRY-RSV',  name: 'Reserved (Sub-Con)',    role: 'Reserved',  zone: '—',   status: 'Active', virtual: true },
      { id: 'SL-TRY-STG',  name: 'Dispatch Staging',      role: 'Staging',   zone: 'Z-B', status: 'Active' },
      { id: 'SL-TRY-RCV',  name: 'Receiving / Semi-Fin.', role: 'Receiving', zone: 'Z-C', status: 'Active' }
    ]
  },
  { id: 'PL-HZR', name: 'L&T Hazira Works', category: 'Manufacturing', gstin: '24LTPLC0421A1Z2',
    city: 'Surat', state: 'Gujarat', pincode: '394270', country: 'India',
    street: 'Hazira Manufacturing Complex', status: 'Active',
    locations: [
      { id: 'SL-HZR-MAIN', name: 'Main Store',         role: 'Main',      zone: 'H-A', status: 'Active' },
      { id: 'SL-HZR-RSV',  name: 'Reserved (Sub-Con)', role: 'Reserved',  zone: '—',   status: 'Active', virtual: true },
      { id: 'SL-HZR-STG',  name: 'Dispatch Staging',   role: 'Staging',   zone: 'H-B', status: 'Active' },
      { id: 'SL-HZR-RCV',  name: 'Receiving',          role: 'Receiving', zone: 'H-C', status: 'Active' }
    ]
  }
];

/* ── Vendors ────────────────────────────────────────────────────────────────
   Vendor Category is the SINGLE source of internal vs external — there is no
   separate Internal Unit master.  Category = Internal means the "vendor" is
   another L&T unit, which is what makes an Inter-Unit deal zero-value. */
const vendorMaster = [
  { id: 'V-2001', name: 'Sri Balaji Engineering Works', category: 'External',
    gstin: '33ABCDE1234F1Z5', contact: 'R. Balasubramanian', email: 'works@sribalaji.example',
    phone: '+91 98400 11223', city: 'Chennai', state: 'Tamil Nadu', country: 'India',
    address: 'Plot 44, Ambattur Industrial Estate, Chennai 600058',
    capabilities: ['Steel', 'Plate', 'Fabrication', 'Shell'],
    plants: ['PL-TRY'], experience: 12, status: 'Active' },
  { id: 'V-2002', name: 'Precision Machining Co.', category: 'External',
    gstin: '33PQRST5678G1Z9', contact: 'M. Sundaram', email: 'ops@precisionmach.example',
    phone: '+91 98410 44556', city: 'Coimbatore', state: 'Tamil Nadu', country: 'India',
    address: '18/3 SIDCO Industrial Estate, Coimbatore 641021',
    capabilities: ['Job Work', 'Machining'],
    plants: ['PL-TRY'], experience: 8, status: 'Active' },
  { id: 'V-2003', name: 'L&T Hazira Works (Inter-Unit)', category: 'Internal',
    gstin: '24LTPLC0421A1Z2', contact: 'Internal Coordination Desk', email: 'idt.hazira@lnt.example',
    phone: '+91 26128 80000', city: 'Surat', state: 'Gujarat', country: 'India',
    address: 'Hazira Manufacturing Complex, Surat 394270',
    capabilities: ['Fabrication', 'Shell', 'Steel'],
    plants: ['PL-TRY', 'PL-HZR'], linkedPlant: 'PL-HZR', experience: 0, status: 'Active' },
  { id: 'V-2004', name: 'Coastal Fabricators', category: 'External',
    gstin: '33LMNOP9012H1Z4', contact: 'K. Ravi', email: 'admin@coastalfab.example',
    phone: '+91 98420 77889', city: 'Chennai', state: 'Tamil Nadu', country: 'India',
    address: '9 Ennore Industrial Road, Chennai 600057',
    capabilities: ['Fabrication'],
    plants: ['PL-TRY'], experience: 5, status: 'Inactive' }
];

/* ── Rate contracts ─────────────────────────────────────────────────────── */
const rateContractMaster = [
  { id: 'RC-3001', vendorId: 'V-2001', productId: 'P-1003', rate: 340, priceBasis: 'Per PCS',
    currency: 'INR', qty: 500, amount: 170000, from: '01 Apr 2026', to: '31 Mar 2027', status: 'Active' },
  { id: 'RC-3002', vendorId: 'V-2001', productId: 'P-1005', rate: 2150, priceBasis: 'Per PCS',
    currency: 'INR', qty: 120, amount: 258000, from: '01 Apr 2026', to: '31 Mar 2027', status: 'Active' },
  { id: 'RC-3003', vendorId: 'V-2002', productId: 'P-1004', rate: 780, priceBasis: 'Per PCS',
    currency: 'INR', qty: 300, amount: 234000, from: '01 Apr 2026', to: '31 Mar 2027', status: 'Active' },
  { id: 'RC-3004', vendorId: 'V-2001', productId: 'P-1003', rate: 310, priceBasis: 'Per PCS',
    currency: 'INR', qty: 400, amount: 124000, from: '01 Apr 2025', to: '31 Mar 2026', status: 'Expired' }
];

/* ── Purchase offices and number series ─────────────────────────────────────
   Separate series per document type, per the master mapping. */
const purchaseOfficeMaster = [
  { id: 'PO-TRY-01', name: 'Trichy Purchase Office', plantId: 'PL-TRY',
    incharge: 'Karan Mehta', email: 'po.trichy@lnt.example', status: 'Active',
    /* obk / transferOrder / gatepass are FRD additions. The Outbound Key and
       the Transfer Order are generated together at shipment submission and
       are two different documents — the client's own team was asked twice on
       the recorded call what the Outbound Key was, so they get distinct
       series rather than sharing the shipment's. */
    series: { po: 'PO-SUB-######', challan: 'CHN-33-######', dnote: 'DN-######', shipment: 'CSN-######', imr: 'IMR-######', scr: 'SUB-######', asn: 'ASN-######',
              obk: 'OBK-######', transferOrder: 'TO-######', gatepass: 'GP-######' } },
  { id: 'PO-HZR-01', name: 'Hazira Purchase Office', plantId: 'PL-HZR',
    incharge: 'Divya Menon', email: 'po.hazira@lnt.example', status: 'Active',
    series: { po: 'PO-HZR-######', challan: 'CHN-24-######', dnote: 'DNH-######', shipment: 'CSNH-######', imr: 'IMRH-######', scr: 'SUBH-######', asn: 'ASNH-######',
              obk: 'OBKH-######', transferOrder: 'TOH-######', gatepass: 'GPH-######' } }
];

/* ── Reason codes ───────────────────────────────────────────────────────────
   All fifteen groups from the BRD, keyed by the RC- code the document uses so
   a log entry can be traced straight back to the requirement.

   "Other" is present in every list and ALWAYS forces mandatory remarks — the
   BRD says so for each group individually, and it is enforced centrally in
   openReasonModal() rather than fifteen times over. */
const reasonMaster = {
  'RC-NONBILL':   { label: 'Non-Billable Reason', at: 'SCR creation',
    reasons: ['Internal Development Work', 'Rework at Own Cost', 'Warranty / Guarantee Job', 'Inter-Unit Transfer', 'Sample / Trial Job', 'Other'] },
  'RC-SCRRET':    { label: 'SCR Return Reason', at: 'SCR approval',
    reasons: ['Incorrect Vendor', 'Material / Quantity Details Incorrect', 'Receivable Item Incorrect', 'Store / Storage Location Incorrect', 'Supporting Information Missing', 'Other'] },
  'RC-SCRREJ':    { label: 'SCR Reject Reason', at: 'SCR approval',
    reasons: ['Requirement No Longer Valid', 'Not Approved for Sub-Contracting', 'Budget Not Available', 'Duplicate Request', 'Other'] },
  'RC-PORET':     { label: 'PO / Order Return', at: 'PO approval',
    reasons: ['Incorrect Vendor', 'Incorrect Rate / Price', 'Rate Contract Incorrect / Expired', 'Incorrect Tax Code', 'Incorrect Purchase Office / PO Series', 'Incorrect Expected Receipt Date', 'Commercial Terms Incomplete', 'Material / Quantity Details Incorrect', 'Other'] },
  'RC-NBREJ':     { label: 'Non-Billable Rejection', at: 'F&A confirmation',
    reasons: ['Reason Not Supported', 'Should Be Billable', 'Insufficient Justification', 'Incorrect Cost Centre', 'Other'] },
  'RC-ALLOC':     { label: 'Material Allocation Return', at: 'Lot allocation',
    reasons: ['Insufficient Reserved Material', 'Incorrect Product', 'Incorrect Quantity', 'Incorrect Lot / Stock', 'Lot / Stock Not Available', 'Store / Storage Location Mismatch', 'Material Details Mismatch', 'Other'] },
  'RC-STORERET':  { label: 'Stores Outbound Return', at: 'Good issue',
    reasons: ['Material Not Available', 'Incorrect Product', 'Quantity Mismatch', 'Incorrect Lot / Stock', 'Material Damaged', 'Storage Location Mismatch', 'Shipment / Material Details Incorrect', 'Other'] },
  'RC-LOGIRET':   { label: 'Logistics Return', at: 'Logistics',
    reasons: ['Package Details Incomplete', 'Incorrect Package Details', 'Transport Mode Incorrect', 'Vehicle Details Missing / Incorrect', 'Driver Details Missing / Incorrect', 'Transporter Details Incorrect', 'Insurance Details Missing / Incorrect', 'Dispatch Information Incomplete', 'Other'] },
  'RC-DNRET':     { label: 'Delivery Note Return', at: 'Delivery note approval',
    reasons: ['Material Details Incorrect', 'Quantity Mismatch', 'Vendor / Destination Incorrect', 'Shipment Details Incorrect', 'Package / Dispatch Details Incorrect', 'Mandatory Information Missing', 'Other'] },
  'RC-CHRET':     { label: 'Challan Return', at: 'Challan generation',
    reasons: ['Delivery Note Details Incorrect', 'Material / Quantity Mismatch', 'Vendor / Destination Incorrect', 'HSN / GSTIN / Tax Details Incorrect', 'Shipment / Dispatch Details Incorrect', 'Mandatory Information Missing', 'Other'] },
  'RC-SECRET':    { label: 'Security Return', at: 'Gate outward',
    reasons: ['Material / Document Mismatch', 'Challan Details Incorrect', 'Material / Quantity Mismatch', 'Dispatch Not Authorized', 'Mandatory Information Missing', 'Other'] },
  'RC-GATEVEH':   { label: 'Vehicle Change', at: 'Gate outward',
    reasons: ['Vehicle Breakdown', 'Vehicle Replaced', 'Vehicle Number Incorrect', 'Transporter Change', 'Other'] },
  'RC-GATEPKG':   { label: 'Package Difference', at: 'Gate outward',
    reasons: ['Package Count Short', 'Package Count Excess', 'Incorrect Package Details', 'Damaged Package', 'Other'] },
  'RC-SHORTRCPT': { label: 'Short Receipt', at: 'Inward / IMR',
    reasons: ['Partial Quantity Returned', 'Material Short Received', 'Material Damaged / Rejected', 'Quantity Variance', 'Remaining Quantity Pending', 'Other'] },
  'RC-BALRET':    { label: 'Balance Material Return', at: 'Inward / reconciliation',
    reasons: ['Unused Material', 'Excess Material Issued', 'Partial Processing Completed', 'Material No Longer Required', 'Other'] },
  'RC-SCRAP':     { label: 'Scrap', at: 'Inward / reconciliation',
    reasons: ['Process Scrap', 'Material Damaged', 'Quality Rejection', 'Process Loss', 'Other'] },
  'RC-SHORT':     { label: 'Short-Close', at: 'Short-close',
    reasons: ['Remaining Quantity No Longer Required', 'Vendor Unable to Complete Remaining Quantity', 'Work / Requirement Cancelled', 'Balance Quantity Waived / Accepted', 'Material / Requirement Changed', 'Commercial / Operational Closure Agreed', 'Other'] },
  'RC-SHIPCAN':   { label: 'Shipment Cancellation', at: 'Shipment',
    reasons: ['Incorrect Shipment Created', 'Incorrect Material', 'Incorrect Quantity', 'Vendor / Destination Changed', 'Dispatch No Longer Required', 'Duplicate Shipment', 'Logistics / Dispatch Issue', 'Requirement Changed', 'Other'] },
  'RC-REMOVAL':   { label: 'Reason for Removal', at: 'Issue item line',
    reasons: ['Job Work – Machining', 'Job Work – Fabrication', 'Job Work – Shell Forming', 'Free Issue Material', 'Inter-Unit Processing'] }
};

/* ── Sub-contracting parameters ─────────────────────────────────────────────
   The configurable numbers the BRD refers to but never fixes.  Every one of
   them is read at the point of use, never hard-coded into a screen. */
const subConParams = {
  returnWindowDays: 45,       /* runs from the recorded Gate Outward timestamp */
  returnWarnDays: 7,          /* "close to expiry" notification threshold */
  decimalPrecision: 3,        /* quantity precision, matches the BRD documents */
  receiptTolerancePct: 2,     /* over-receipt allowed against outstanding qty */
  bomRatioDefault: 12.9,      /* KG of plate consumed per PCS received */
  fimBufferPct: 3.2,          /* free-issue buffer added to issue quantity */
  allowNegativeStock: false,
  lotMandatoryForControlled: true
};

/* BOM ratios: how much of an Issue Item is consumed per unit of a Receivable
   Item.  Consumed Quantity = Confirmed Received Quantity × BOM Ratio. */
const bomRatios = [
  { issueProductId: 'P-1001', receivableProductId: 'P-1003', ratio: 12.9 },
  { issueProductId: 'P-1002', receivableProductId: 'P-1003', ratio: 2.0 },
  { issueProductId: 'P-1006', receivableProductId: 'P-1005', ratio: 46.5 },
  { issueProductId: 'P-1007', receivableProductId: 'P-1004', ratio: 1.0 }
];

/* ══════════════════════════════════════════════════════════════════════════
   SCR BASE  —  Projects and Production Orders (FRD masters 4–7)

   FR1.3 branches the entire request form on SCR Base. The two halves are not
   cosmetic variants of each other: a Project-based request books cost to a
   project element and activity, while a Production Order-based one subcontracts
   a RANGE OF OPERATIONS out of a routing and comes back as WIP.

   The identifiers below are the ones the client put on screen during the
   recorded walkthrough — project S077334 with elements 10090/10018, activity
   ACT01, receiving HAL-PS3-OES-003 "PS-3 Separation Ring". Using their real
   references rather than invented ones means the demo data matches the
   screenshots they already have in front of them.
   ========================================================================== */

/* ── Projects (master 4) and their elements / activities (master 5) ──────────
   Elements are nested rather than held in a parallel array: an element has no
   meaning outside its project, and FR1.3 requires the dropdown to show only
   the elements of the project just chosen. */
const projectMaster = [
  { id: 'S077334', name: 'PS-3 Separation Ring assembly', customer: 'BHEL Trichy',
    plantId: 'PL-TRY', status: 'Active',
    elements: [
      { id: '10090', name: 'Shell fabrication',   activities: ['ACT01', 'ACT02'] },
      { id: '10018', name: 'Ring machining',      activities: ['ACT01', 'ACT04'] },
      { id: '10042', name: 'Nozzle sub-assembly', activities: ['ACT03'] }
    ] },
  { id: 'S077410', name: 'Reactor shell course 4', customer: 'IOCL Paradip',
    plantId: 'PL-TRY', status: 'Active',
    elements: [
      { id: '20110', name: 'Shell rolling',   activities: ['ACT01', 'ACT02'] },
      { id: '20115', name: 'Nozzle drilling', activities: ['ACT03', 'ACT04'] }
    ] },
  { id: 'H044120', name: 'Hazira modular skid', customer: 'ONGC',
    plantId: 'PL-HZR', status: 'Active',
    elements: [ { id: '30050', name: 'Skid fabrication', activities: ['ACT01'] } ] },
  /* Closed projects stay resolvable for historical records but must never be
     offered on a new request. */
  { id: 'S076990', name: 'Legacy header assembly', customer: 'NTPC',
    plantId: 'PL-TRY', status: 'Closed',
    elements: [ { id: '10001', name: 'Header fabrication', activities: ['ACT01'] } ] }
];

const ACTIVITY_MASTER = {
  ACT01: 'Fabrication',
  ACT02: 'Welding',
  ACT03: 'Drilling',
  ACT04: 'Machining'
};

/* ── Production orders (master 6) and routings (master 7) ───────────────────
   The routing is the client's own worked example: cutting is kept in house,
   bending and plating go out. FR1.3 needs the operation SEQUENCE, because
   Operation From may not exceed Operation To and the picker offers only the
   same or later operations. */
const productionOrderMaster = [
  { id: 'PRO-004412', productId: 'P-1003', description: 'Drilled flange — 40 off',
    qty: 40, uom: 'PCS', startDate: '2026-09-01', endDate: '2026-10-15',
    plantId: 'PL-TRY', status: 'Released',
    routing: [
      { op: 10, name: 'Cutting',  seq: 1 },
      { op: 20, name: 'Bending',  seq: 2 },
      { op: 30, name: 'Plating',  seq: 3 },
      { op: 40, name: 'Final inspection', seq: 4 }
    ] },
  { id: 'PRO-004480', productId: 'P-1005', description: 'Fabricated shell course — 6 off',
    qty: 6, uom: 'PCS', startDate: '2026-09-10', endDate: '2026-11-20',
    plantId: 'PL-TRY', status: 'Released',
    routing: [
      { op: 10, name: 'Rolling',       seq: 1 },
      { op: 20, name: 'Longitudinal weld', seq: 2 },
      { op: 30, name: 'Stress relief', seq: 3 }
    ] },
  { id: 'PRO-004401', productId: 'P-1003', description: 'Closed order — not selectable',
    qty: 12, uom: 'PCS', startDate: '2026-04-01', endDate: '2026-06-30',
    plantId: 'PL-TRY', status: 'Closed',
    routing: [ { op: 10, name: 'Cutting', seq: 1 } ] }
];

/* ── Lookups.  Every screen reads masters through these, never by index. ─── */
function project(id)          { return projectMaster.find(p => p.id === id) || {}; }
function productionOrder(id)  { return productionOrderMaster.find(p => p.id === id) || {}; }

/* Only what a NEW request may choose: active, and belonging to this plant. */
function activeProjects(plantId) {
  return projectMaster.filter(p => p.status === 'Active' && (!plantId || p.plantId === plantId));
}
function activeProductionOrders(plantId) {
  return productionOrderMaster.filter(p => p.status !== 'Closed' && (!plantId || p.plantId === plantId));
}

function projectElements(projectId) { return project(projectId).elements || []; }
function projectElement(projectId, elementId) {
  return projectElements(projectId).find(e => e.id === elementId) || {};
}
/* Activities belong to the ELEMENT, not the project — picking a different
   element has to narrow the activity list, or the cost object can be booked
   against work the element does not contain. */
function elementActivities(projectId, elementId) {
  return (projectElement(projectId, elementId).activities || [])
    .map(a => ({ id: a, name: ACTIVITY_MASTER[a] || a }));
}

function routingFor(poId) { return productionOrder(poId).routing || []; }

/* FR1.3 operation validation, in one place so the form and the validator
   cannot disagree: Operation To offers the same operation or a later one. */
function operationsFrom(poId, fromOp) {
  const r = routingFor(poId);
  if (fromOp == null || fromOp === '') return r;
  const start = r.find(o => String(o.op) === String(fromOp));
  return start ? r.filter(o => o.seq >= start.seq) : r;
}

function product(id)      { return productMaster.find(p => p.id === id) || {}; }
function vendor(id)       { return vendorMaster.find(v => v.id === id) || {}; }
function plant(id)        { return plantMaster.find(p => p.id === id) || {}; }
function rateContract(id) { return rateContractMaster.find(r => r.id === id) || {}; }
function purchaseOffice(id){ return purchaseOfficeMaster.find(o => o.id === id) || {}; }

function storageLocation(plantId, locId) {
  return (plant(plantId).locations || []).find(l => l.id === locId) || {};
}
function locationByRole(plantId, role) {
  return (plant(plantId).locations || []).find(l => l.role === role) || {};
}

/* Active records only — what a NEW transaction is allowed to choose.
   Historical references still resolve through the plain lookups above. */
function activeProducts() { return productMaster.filter(p => p.status === 'Active'); }
function activeVendors()  { return vendorMaster.filter(v => v.status === 'Active'); }
function activePlants()   { return plantMaster.filter(p => p.status === 'Active'); }

/* Vendor eligibility (US20/AC3): active, mapped to the plant, and capable of
   the product's category.  A vendor failing any of the three is not offered. */
function eligibleVendors(plantId, mainCategory) {
  return vendorMaster.filter(v =>
    v.status === 'Active' &&
    (!plantId || (v.plants || []).indexOf(plantId) !== -1) &&
    (!mainCategory || (v.capabilities || []).indexOf(mainCategory) !== -1));
}

/* Valid contracts only: right vendor, right product, and not expired. */
function contractsFor(vendorId, productId) {
  return rateContractMaster.filter(r =>
    r.status === 'Active' && r.vendorId === vendorId &&
    (!productId || r.productId === productId));
}

function bomRatio(issueProductId, receivableProductId) {
  const m = bomRatios.find(b => b.issueProductId === issueProductId && b.receivableProductId === receivableProductId);
  return m ? m.ratio : null;
}

/* ==========================================================================
   RBAC  —  who can reach what.

   THE DECISION THIS FILE IMPLEMENTS.  Access is granted PER TEAM, exactly as
   ADT does today: a Team holds a Task Profile, and every member of that Team
   inherits it whatever their Position.  That was chosen deliberately over the
   per-Position model the RBAC document describes.

   TWO RULES CANNOT COME FROM TEAM ACCESS, AND SO ARE NOT PERMISSIONS HERE.
   The RBAC doc makes both mandatory, and a Buyer and a Stores user sitting in
   one Team would otherwise satisfy neither:

     COMMERCIAL MASKING   Rate, Rate Contract, Price Basis, Currency and PO
                          Value must never be visible to Planner, Material
                          Planner, Stores, Logistics, D'Note Approver or
                          Security.  Keyed on POSITION, applied at field level
                          by maskCommercial() — a Team that can open the PO
                          screen still shows no money to those six.

     MAKER ≠ CHECKER      The submitter of an SCR cannot approve it, and the
                          Buyer who completes a PO cannot approve it.  That is
                          a property of a TRANSACTION and the user who touched
                          it, not of a role, so it lives in sameUserBlocked()
                          and is checked against the record, never the profile.

   Neither is a Team tick, and neither should ever become one.
   ========================================================================== */

/* ── Positions ──────────────────────────────────────────────────────────────
   The thirteen L&T designations from the Field Mapping sheet, plus the
   external Vendor which the RBAC doc explicitly leaves outside the internal
   model until the portal is confirmed (M-08 confirms it). */
const POSITIONS = {
  'it-admin':          { label: 'System Administrator',            short: 'IT Admin',          dept: 'IT / System Administration' },
  'pmg-admin':         { label: 'Sub-Contracting Administrator',   short: 'PMG Admin',         dept: 'PMG / Project Management Group' },
  'planner':           { label: 'Planning Executive',              short: 'Planner',           dept: 'PMG / Project Management Group' },
  'pmg-approver':      { label: 'Sub-Contracting Approval Manager',short: 'PMG Approver',      dept: 'PMG / Project Management Group' },
  'buyer':             { label: 'Procurement Executive',           short: 'Buyer',             dept: 'Procurement / Purchase' },
  'material-planner':  { label: 'Material Planning Executive',     short: 'Material Planner',  dept: 'Material Planning' },
  'stores':            { label: 'Stores Executive',                short: 'Stores',            dept: 'Stores / Warehouse' },
  'logistics':         { label: 'Logistics Executive',             short: 'Logistics',         dept: 'Logistics' },
  'dnote-approver':    { label: 'Delivery Note Approval Manager',  short: "D'Note Approver",   dept: 'Stores / Warehouse' },
  'finance':           { label: 'Finance Executive',               short: 'F&A',               dept: 'Finance & Accounts' },
  'idt':               { label: 'Inter-Unit Coordinator',          short: 'IDT',               dept: 'IDT / Inter-Department Transfer' },
  'security':          { label: 'Security Executive',              short: 'Security',          dept: 'Security' },
  'vendor':            { label: 'Sub-Contractor',                  short: 'Vendor',            dept: 'External', external: true }
};

/* Commercial confidentiality — RBAC mandatory rule 7.  These six positions
   never see a price, whatever their Team can open. */
const COMMERCIAL_BLIND = ['planner', 'material-planner', 'stores', 'logistics', 'dnote-approver', 'security'];

/* Fields the rule covers.  Named once so a new commercial field cannot be
   added to a form and quietly escape the mask. */
const COMMERCIAL_FIELDS = ['rate', 'rateContract', 'priceBasis', 'currency', 'orderValue', 'amount', 'taxAmount', 'paymentTerms'];

/* ── Teams ──────────────────────────────────────────────────────────────────
   One Team per Store × Process Type, per the 26 Aug meeting.  `tasks` IS the
   Task Profile from the Add Team screen: page id → permitted actions.

   'a' add · 'e' edit · 'v' view · 'd' delete
   Delete appears on master pages only.  Transactions are cancelled, returned,
   rejected or short-closed — never deleted (RBAC footnote). */
const TEAMS = {
  'TRY-SCR': {
    name: 'Trichy Works – Sub-Contracting',
    store: 'Trichy Works',
    process: 'Procure-to-Pay (Sub-Contracting)',
    email: 'subcon.trichy@lnt.example',
    tasks: {
      dashboard: 'v', scr: 'aev', orders: 'ev', shipments: 'aev',
      allocation: 'v', reconciliation: 'v', 'delivery-notes': 'v', challans: 'v',
      reports: 'v', activity: 'v'
    }
  },
  'TRY-STR': {
    name: 'Trichy Works – Stores',
    store: 'Trichy Works',
    process: 'Procure-to-Pay (Sub-Contracting)',
    email: 'stores.trichy@lnt.example',
    tasks: {
      dashboard: 'v', scr: 'v', shipments: 'v', outbound: 'ev', inward: 'aev',
      'delivery-notes': 'aev', challans: 'v', reconciliation: 'v', activity: 'v'
    }
  },
  'TRY-LOG': {
    name: 'Trichy Works – Logistics',
    store: 'Trichy Works',
    process: 'Procure-to-Pay (Sub-Contracting)',
    email: 'logistics.trichy@lnt.example',
    tasks: { dashboard: 'v', shipments: 'v', logistics: 'ev', 'delivery-notes': 'v', activity: 'v' }
  },
  'TRY-FIN': {
    name: 'Trichy Works – Finance & IDT',
    store: 'Trichy Works',
    process: 'Procure-to-Pay (Sub-Contracting)',
    email: 'fa.trichy@lnt.example',
    tasks: {
      /* Finance raises the challan against an approved Delivery Note, so it
         has to be able to open the note to check it first. */
      dashboard: 'v', scr: 'v', orders: 'v', 'delivery-notes': 'v',
      challans: 'aev', inward: 'v',
      reconciliation: 'aev', reports: 'v', activity: 'v'
    }
  },
  'TRY-SEC': {
    name: 'Trichy Works – Security',
    store: 'Trichy Works',
    process: 'Procure-to-Pay (Sub-Contracting)',
    email: 'security.trichy@lnt.example',
    tasks: { dashboard: 'v', gate: 'ev', challans: 'v', activity: 'v' }
  },
  'PMG-ADM': {
    name: 'IT / PMG Administration',
    store: 'Trichy Works',
    process: 'Administration',
    email: 'pmg.admin@lnt.example',
    tasks: {
      dashboard: 'v', scr: 'v', orders: 'v', shipments: 'v', allocation: 'v',
      outbound: 'v', logistics: 'v', gate: 'v', 'delivery-notes': 'v',
      challans: 'v', inward: 'v', reconciliation: 'v',
      products: 'aevd', plants: 'aevd', vendors: 'aevd', 'rate-contracts': 'aevd',
      'purchase-offices': 'aevd', 'reason-codes': 'aevd', parameters: 'aevd',
      teams: 'aevd', 'staff-roles': 'aevd', notifications: 'aevd',
      reports: 'v', activity: 'v'
    }
  }
};

/* ── Users ──────────────────────────────────────────────────────────────────
   One per Position so every queue in the prototype has somebody standing in
   it.  Two share TRY-SCR on purpose: the Planner who raises an SCR and the
   Approver who signs it sit in the SAME Team and therefore hold identical
   module access — which is exactly the per-Team decision, and exactly why
   maker-checker has to be a transaction rule instead. */
const USERS = {
  'u-planner':   { name: 'Ravi Kulkarni',   team: 'TRY-SCR', position: 'planner' },
  'u-approver':  { name: 'Anita Deshmukh',  team: 'TRY-SCR', position: 'pmg-approver' },
  'u-buyer':     { name: 'Karan Mehta',     team: 'TRY-SCR', position: 'buyer' },
  'u-matplan':   { name: 'Suresh Iyer',     team: 'TRY-SCR', position: 'material-planner' },
  'u-stores':    { name: 'Vijay Rao',       team: 'TRY-STR', position: 'stores' },
  'u-dnote':     { name: 'Meena Krishnan',  team: 'TRY-STR', position: 'dnote-approver' },
  'u-logistics': { name: 'Arun Pillai',     team: 'TRY-LOG', position: 'logistics' },
  'u-finance':   { name: 'Priya Nair',      team: 'TRY-FIN', position: 'finance' },
  'u-idt':       { name: 'Sanjay Gupta',    team: 'TRY-FIN', position: 'idt' },
  'u-security':  { name: 'Ganesh Murthy',   team: 'TRY-SEC', position: 'security' },
  'u-admin':     { name: 'Tarak Swain',     team: 'PMG-ADM', position: 'pmg-admin' },
  /* External. Has no Team, so can() grants nothing — the portal is reached
     through its own shell and no internal screen is routable for this user.
     It exists so the audit trail can name the vendor as the actor on an ASN
     instead of whichever internal user happened to be signed in. */
  'u-vendor':    { name: 'R. Balasubramanian', team: null, position: 'vendor', vendorId: 'V-2001' }
};

/* Who is signed in.  The role switcher in the topbar writes this. */
let currentUserId = 'u-planner';

function currentUser()      { return USERS[currentUserId]; }
function currentTeam()      { return TEAMS[currentUser().team]; }
function currentPosition()  { return currentUser().position; }
function positionLabel(p)   { return (POSITIONS[p] || {}).short || p; }

function initials(name) {
  return String(name).split(/\s+/).filter(Boolean).slice(0, 2)
    .map(w => w[0].toUpperCase()).join('');
}

function setCurrentUser(id) {
  if (!USERS[id]) return;
  currentUserId = id;
  /* A role change can invalidate the page you are standing on — a Security
     user has no business on the Vendors master.  Land them somewhere they are
     allowed to be rather than on a screen that would render empty. */
  if (!can(page, 'v')) {
    page = firstAllowedPage();
    activeSidebarItem = page;
  }
  lastSidebarSig = null;      /* force a sidebar rebuild: the nav itself changed */
  renderPage();
}

/* ── The permission check ───────────────────────────────────────────────────
   Per Team, as decided.  Position is deliberately not consulted here. */
function can(pageId, action) {
  const t = currentTeam();
  if (!t) return false;                  /* external users hold no Team access */
  const grant = t.tasks[pageId];
  if (!grant) return false;
  return grant.indexOf(action || 'v') !== -1;
}

/* Convenience readers so call sites say what they mean. */
function canView(p)   { return can(p, 'v'); }
function canAdd(p)    { return can(p, 'a'); }
function canEdit(p)   { return can(p, 'e'); }
function canDelete(p) { return can(p, 'd'); }

/* ── Special actions ────────────────────────────────────────────────────────
   Approve, Return, Reject, Good Issue, Gate Outward and the rest are NOT
   permissions — the RBAC doc is explicit that Approve is a special action and
   must never be modelled as a generic tick.  They belong to a Position: a
   Buyer generates a PO, Security records a gate outward, and no amount of
   Team access makes a Logistics user an approver. */
const SPECIAL_ACTIONS = {
  planner:          ['submit', 'resubmit', 'cancel-scr', 'create-shipment', 'cancel-shipment', 'initiate-short-close'],
  'pmg-approver':   ['approve-scr', 'return-scr', 'reject-scr', 'approve-po', 'return-po'],
  buyer:            ['complete-po', 'generate-po', 'select-vendor', 'select-rate-contract', 'confirm-short-close'],
  'material-planner': ['allocate-lot', 'return-allocation'],
  stores:           ['good-issue', 'outbound-release', 'return-outbound', 'good-receipt', 'create-imr', 'confirm-imr', 'generate-dnote'],
  logistics:        ['maintain-logistics', 'complete-logistics', 'return-logistics', 'generate-dnote'],
  'dnote-approver': ['approve-dnote', 'return-dnote'],
  finance:          ['confirm-non-billable', 'reject-non-billable', 'generate-challan', 'return-challan', 'confirm-full-receipt', 'close-challan'],
  idt:              ['confirm-non-billable', 'reject-non-billable', 'generate-challan', 'return-challan'],
  security:         ['verify-gate', 'record-gate-outward', 'return-security', 'record-inward'],
  'pmg-admin':      ['configure-master', 'activate-master', 'deactivate-master', 'configure-position'],
  'it-admin':       ['configure-master', 'activate-master', 'deactivate-master', 'configure-position'],
  vendor:           ['raise-asn']
};

function canDo(action) {
  return (SPECIAL_ACTIONS[currentPosition()] || []).indexOf(action) !== -1;
}

/* ── The two layered transaction rules ──────────────────────────────────── */

/* Commercial masking.  Ask before rendering any money on any screen. */
function seesCommercial() {
  return COMMERCIAL_BLIND.indexOf(currentPosition()) === -1;
}

/* Render a commercial value, or the withheld marker.  Every price in the app
   goes through this — never print a rate directly. */
/* WITHHELD AND ABSENT MUST NOT LOOK THE SAME.

   The mask used to render two em dashes and an empty value one — a difference
   of a single dash, sitting one row apart in the same column, with the reason
   available only in a tooltip. That is the pattern the blocked-button work
   rejected for exactly the same reason: a mouse-only explanation is no
   explanation. It says what it is. */
function maskCommercial(value) {
  return seesCommercial() ? value
    : '<span class="chip masked" title="Commercial information is not visible to your position">Restricted</span>';
}

/* Maker ≠ checker.  Pass the record and the action; true means "block this".
   Checked against who actually touched the record, not against a role. */
function sameUserBlocked(record, action) {
  if (!record) return false;
  if (action === 'approve-scr' || action === 'return-scr' || action === 'reject-scr')
    return record.submittedBy === currentUserId;
  if (action === 'approve-po' || action === 'return-po')
    return record.completedBy === currentUserId;
  return false;
}

/* ── Nav filtering ──────────────────────────────────────────────────────────
   A section or dropdown earns its place only if something inside it survives
   the permission check — otherwise an empty heading is left behind. */
function firstAllowedPage() {
  const flat = [];
  getSidebarItems().forEach(i => {
    if (i.section) return;
    if (i.dropdown) { (i.children || []).forEach(c => flat.push(c.id)); return; }
    flat.push(i.id);
  });
  for (let i = 0; i < flat.length; i++) if (can(flat[i], 'v')) return flat[i];
  return 'dashboard';
}

/* ==========================================================================
   M-10  ADMINISTRATION AND RBAC CONFIGURATION

   Built to the supplied Add Team reference: Basic Details, Assign Members,
   Assign Team, Task Profile, Data Profile — the same four sections in the
   same order, rebuilt in the ADT design system.

   FOUR PERMISSION COLUMNS, NOT THREE.  The reference ships a single combined
   Add / Edit checkbox; the mapping sheet records the manager asking for the
   SAP-standard four.  Dropping to one Manufacturing domain group frees exactly
   the width the reference spent on two (Education | Staffing), so the split
   costs nothing.  THIS IS STILL AN OPEN DECISION — say the word and the two
   columns merge back into one.
   ========================================================================== */

/* ── The task tree the Task Profile configures ──────────────────────────────
   The staffing rows are KEPT, as instructed: they stay configurable in the
   grid exactly as the reference shows them, even though no screens sit behind
   them for Manufacturing. The sub-contracting rows are added beneath. */
const TASK_ROWS = [
  { group: 'Carried forward from ADT', rows: [
    { id: 'email-templates', label: 'Email Templates' },
    { id: 'payroll',   label: 'Payroll',   inactive: true },
    { id: 'financebp', label: 'FinanceBP', inactive: true },
    { id: 'assets',    label: 'Assets',    inactive: true },
    { id: 'teams',     label: 'Teams' },
    { id: 'expense',   label: 'Expense',   inactive: true },   /* was "Expence" */
    { id: 'offers',    label: 'Offers',    inactive: true },
    { id: 'marketing', label: 'Social Media Marketing', inactive: true },
    { id: 'events',    label: 'Event Triggers' },
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'orders',    label: 'Orders' },
    { id: 'reports',   label: 'Reports' },
    { id: 'masters',   label: 'Master Data' },
    { id: 'skills',    label: 'Vendor Capability Mapping' },
    { id: 'category',  label: 'Category' },
    { id: 'vendors',   label: 'Vendors' },
    { id: 'users',     label: 'Users' },
    { id: 'admin',     label: 'Staff & Roles' }
  ]},
  { group: 'Sub-contracting', rows: [
    { id: 'scr',            label: 'Requests / SCR',            txn: true },
    { id: 'scr-approval',   label: 'SCR Approval',              txn: true, special: 'Approve · Return · Reject' },
    { id: 'nonbillable',    label: 'Non-Billable Confirmation', txn: true, special: 'Confirm · Reject' },
    { id: 'po',             label: 'Order / PO',                txn: true },
    { id: 'po-approval',    label: 'PO Approval',               txn: true, special: 'Approve · Return' },
    { id: 'shipments',      label: 'Shipment',                  txn: true, special: 'Create · Cancel · Short-Close' },
    { id: 'allocation',     label: 'Material Allocation',       txn: true, special: 'Allocate · Return' },
    { id: 'outbound',       label: 'Stores Outbound',           txn: true, special: 'Good Issue · Return' },
    { id: 'logistics',      label: 'Logistics',                 txn: true, special: 'Complete · Return' },
    { id: 'delivery-notes', label: 'Delivery Note',             txn: true, special: 'Generate · Approve · Return' },
    { id: 'challans',       label: 'Challan',                   txn: true, special: 'Generate · Return' },
    { id: 'gate',           label: 'Security Gate',             txn: true, special: 'Verify · Record · Return' },
    { id: 'inward',         label: 'IMR / Material Inward',     txn: true, special: 'Good Receipt · Confirm' },
    { id: 'reconciliation', label: 'Reconciliation & Closure',  txn: true, special: 'Full Receipt · Close' },
    { id: 'short-close',    label: 'Short-Close',               txn: true, special: 'Initiate · Confirm' },
    { id: 'interunit',      label: 'Inter-Unit Return',         txn: true },
    { id: 'rate-contracts', label: 'Rate Contract' },
    { id: 'vendor-portal',  label: 'Vendor Portal / ASN',       txn: true, special: 'Raise ASN' },
    { id: 'activity',       label: 'Activity Log',              txn: true, readOnly: true }
  ]}
];

/* F23 · Special actions used to print their internal identifiers with hyphens
   swapped for spaces — "reject non billable", "record gate outward". This is
   the screen an L&T administrator reads most closely; it should not expose
   machine strings as if they were labels. */
const ACTION_LABELS = {
  'submit': 'Submit', 'resubmit': 'Resubmit', 'cancel-scr': 'Cancel Request',
  'create-shipment': 'Create Shipment', 'cancel-shipment': 'Cancel Shipment',
  'initiate-short-close': 'Initiate Short-Close', 'confirm-short-close': 'Confirm Short-Close',
  'approve-scr': 'Approve Request', 'return-scr': 'Return Request', 'reject-scr': 'Reject Request',
  'approve-po': 'Approve Order', 'return-po': 'Return Order',
  'complete-po': 'Complete Order', 'generate-po': 'Generate Order',
  'select-vendor': 'Select Vendor', 'select-rate-contract': 'Select Rate Contract',
  'allocate-lot': 'Allocate Lot', 'return-allocation': 'Return Allocation',
  'good-issue': 'Good Issue', 'outbound-release': 'Outbound Release',
  'return-outbound': 'Return to Planner', 'good-receipt': 'Good Receipt',
  'create-imr': 'Create IMR', 'confirm-imr': 'Confirm IMR', 'generate-dnote': 'Generate Delivery Note',
  'maintain-logistics': 'Maintain Logistics', 'complete-logistics': 'Complete Logistics',
  'return-logistics': 'Return to Stores',
  'approve-dnote': 'Approve Delivery Note', 'return-dnote': 'Return Delivery Note',
  'confirm-non-billable': 'Confirm Non-Billable', 'reject-non-billable': 'Reject Non-Billable',
  'generate-challan': 'Generate Challan', 'return-challan': 'Return Challan',
  'confirm-full-receipt': 'Confirm Full Receipt', 'close-challan': 'Close Challan',
  'verify-gate': 'Verify at Gate', 'record-gate-outward': 'Record Gate Outward',
  'return-security': 'Return at Gate', 'record-inward': 'Record Inward',
  'configure-master': 'Configure Master', 'activate-master': 'Activate Master',
  'deactivate-master': 'Deactivate Master', 'configure-position': 'Configure Position',
  'raise-asn': 'Raise ASN'
};
function actionLabel(a) {
  return ACTION_LABELS[a] || a.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/* Data Profile — for L&T this is the Community / Works / Location / Store
   scope the RBAC doc requires, not ADT's sales processes. */
const DATA_SCOPES = [
  'Trichy Works — all stores', 'Trichy Works — Main Store', 'Trichy Works — Reserved (Sub-Con)',
  'Trichy Works — Receiving', 'Hazira Works — all stores', 'Procure-to-Pay (Sub-Contracting)',
  'Order-to-Cash', 'Plate Cutting', 'Inter-Unit Transfers', 'All communities'
];

let teamEditing = null;

/* ── Teams listing ──────────────────────────────────────────────────────── */
function buildTeamsPage() {
  if (teamEditing !== null) return buildTeamForm(teamEditing);
  const ids = Object.keys(TEAMS);
  return buildPageHead('Teams',
      'One team per Store × Process Type. A member added to a team inherits that team’s task profile automatically — which is why a Buyer and a Stores user in one team hold identical module access.',
      actionBtn('Add Team', 'openTeamForm(\'\')', canAdd('teams'), 'Only an administrator can add a team.', 'btn-primary')) +
    buildListing({
      stats: [
        { label: 'Teams', count: ids.length },
        { label: 'Members', count: Object.keys(USERS).length },
        { label: 'Positions in use', count: Object.keys(USERS).map(k => USERS[k].position).filter((v, i, s) => s.indexOf(v) === i).length }
      ],
      columns: [
        { label: 'Code', cell: id => '<b class="mono">' + esc(id) + '</b>' },
        { label: 'Team', cell: id => esc(TEAMS[id].name) },
        { label: 'Plant', cell: id => esc(TEAMS[id].store) },
        { label: 'Process type', cell: id => esc(TEAMS[id].process) },
        { label: 'Email', cell: id => '<span class="dim">' + esc(TEAMS[id].email) + '</span>' },
        { label: 'Members', cell: id => Object.keys(USERS).filter(u => USERS[u].team === id)
            .map(u => '<span class="sb-st sb-st-idle" style="margin:1px 3px 1px 0">' +
              esc(USERS[u].name.split(' ')[0]) + ' · ' + esc(positionLabel(USERS[u].position)) + '</span>').join('') },
        { label: 'Tasks', cell: id => Object.keys(TEAMS[id].tasks).length, align: 'center' },
        { label: '', align: 'right', cell: id => canEdit('teams')
            ? '<button class="btn-outline btn-sm" onclick="event.stopPropagation();openTeamForm(\'' + id + '\')">Edit</button>' : '' }
      ],
      rows: ids,
      empty: 'No teams configured.'
    });
}

function openTeamForm(id) { teamEditing = id; renderPage(); }
function backToTeams()    { teamEditing = null; renderPage(); }

/* ── Add / Edit Team — the reference screen ─────────────────────────────── */
function buildTeamForm(id) {
  const t = id ? TEAMS[id] : { name: '', store: '', process: '', email: '', tasks: {} };
  const members = id ? Object.keys(USERS).filter(u => USERS[u].team === id) : [];

  return buildPageHead(id ? 'Edit Team · ' + id : 'Add Team',
      'Task Profile grants module access. Data Profile limits which stores and processes that access reaches.',
      '<button class="btn-outline" onclick="backToTeams()">Cancel</button>' +
      '<button class="btn-primary" onclick="saveTeam(\'' + id + '\')">Save team</button>') +

    buildCard('Basic Details', '<div class="form-grid">' +
      fField('Team Name', fText('t-name', t.name, 'Trichy Works – Sub-Contracting'), true) +
      fField('Team Code', fText('t-code', id, 'TRY-SCR'), true) +
      fField('Team Email', fText('t-email', t.email), true) +
      fField('Function / Department', customSelect('t-dept', '',
        ['PMG / Project Management Group', 'Procurement / Purchase', 'Stores / Warehouse',
         'Logistics', 'Finance & Accounts', 'IDT / Inter-Department Transfer', 'Security',
         'IT / System Administration', 'Material Planning'], 'Select department'), true) +
      fField('Plant / Warehouse', customSelect('t-plant', t.store,
        activePlants().map(p => p.name), 'Select plant'), true) +
      fField('Process Type', customSelect('t-process', t.process,
        ['HR', 'Order-to-Cash', 'Procure-to-Pay (Sub-Contracting)', 'Plate Cutting', 'Administration'], 'Select process'), true) +
      fField('Team Category', customSelect('t-cat', '', ['Operational', 'Approval', 'Support'], 'Select category'), true,
        'Values still to be confirmed by L&T.') +
      fField('Team Owner', fText('t-owner', '', 'Business head')) +
    '</div>') +

    buildCard('Assign Members',
      /* The reference offers a repeat control but shows nowhere the added rows
         land. A visible list is the difference between configuring a team and
         hoping you configured it. */
      '<div class="form-grid" style="--f-cols:3">' +
        fField('Member', customSelect('t-member', '', Object.keys(USERS).map(u => USERS[u].name), 'Select member'), true) +
        fField('Position', customSelect('t-position', '',
          Object.keys(POSITIONS).filter(p => !POSITIONS[p].external).map(p => POSITIONS[p].short), 'Select position'), true) +
        fField('Member Category', customSelect('t-mcat', '', ['Regular', 'Consultant', 'Full-time', 'Part-time', 'Intern'], 'Select category'), true,
          'ADT offers two different lists here; which one L&T means is still to be confirmed.') +
      '</div>' +
      '<div style="margin-top:12px"><button class="btn-outline btn-sm" onclick="toast(\'Member rows are configuration only in the prototype.\')">Add member</button></div>' +
      (members.length ? '<div class="lines-wrap" style="margin-top:14px"><table class="lines"><thead><tr>' +
        '<th>Member</th><th>Position</th><th>Department</th><th>Inherits</th><th></th></tr></thead><tbody>' +
        members.map(u => '<tr><td><b>' + esc(USERS[u].name) + '</b></td>' +
          '<td>' + esc(positionLabel(USERS[u].position)) + '</td>' +
          '<td class="dim">' + esc(POSITIONS[USERS[u].position].dept) + '</td>' +
          '<td class="dim">' + Object.keys(TEAMS[id].tasks).length + ' tasks from this team</td>' +
          '<td class="ta-right"><button class="line-x" aria-label="Remove" onclick="toast(\'Removing members is configuration only in the prototype.\')">&times;</button></td></tr>').join('') +
        '</tbody></table></div>' : '<div class="lst-empty" style="padding:20px">No members assigned yet.</div>')) +

    buildCard('Assign Team', '<div class="form-grid" style="--f-cols:3">' +
      fField('Linked Team', customSelect('t-link', '', Object.keys(TEAMS).map(k => TEAMS[k].name), 'Select team')) +
      fField('Link Category', customSelect('t-linkcat', '', ['Upstream', 'Downstream', 'Support'], 'Select category'), false,
        'Values still to be confirmed by L&T.') +
      '<div class="ff"><label class="ff-label">&nbsp;</label>' +
      '<button class="btn-outline" onclick="toast(\'Team links are configuration only in the prototype.\')">Add link</button></div>' +
    '</div>') +

    buildCard('Task Profile', buildTaskProfile(t),
      '<label class="tp-all"><input type="checkbox" onchange="toggleAllTasks(this.checked)"> Select all</label>') +

    buildCard('Data Profile',
      '<div class="dp-grid">' + DATA_SCOPES.map((s, i) =>
        '<label class="dp-item"><input type="checkbox" id="dp-' + i + '"' +
        (i === 0 || i === 5 ? ' checked' : '') + '> ' + esc(s) + '</label>').join('') + '</div>');
}

function buildTaskProfile(t) {
  return '<div class="lines-wrap"><table class="lines tp"><thead>' +
    '<tr><th rowspan="2">Task</th><th colspan="4" class="ta-center tp-group">Manufacturing</th><th rowspan="2">Special actions</th></tr>' +
    '<tr><th class="ta-center">Add</th><th class="ta-center">Edit</th><th class="ta-center">View</th><th class="ta-center">Delete</th></tr>' +
    '</thead><tbody>' +
    TASK_ROWS.map(g =>
      '<tr class="tp-sec"><td colspan="6">' + esc(g.group) + '</td></tr>' +
      g.rows.map(r => {
        const grant = t.tasks[r.id] || '';
        const cell = (k, disabled, why) =>
          '<td class="ta-center"><input type="checkbox" id="tp-' + r.id + '-' + k + '"' +
          (grant.indexOf(k) !== -1 ? ' checked' : '') +
          (disabled ? ' disabled title="' + attrSafe(why) + '"' : '') + '></td>';
        return '<tr' + (r.inactive ? ' class="tp-off"' : '') + '>' +
          '<td>' + esc(r.label) +
            (r.inactive ? ' <span class="dim">· hidden for Manufacturing</span>' : '') + '</td>' +
          cell('a', r.readOnly, 'The activity log is never written to by hand.') +
          cell('e', r.readOnly, 'The activity log is never edited.') +
          cell('v', false) +
          /* Delete is DISABLED, not absent, on transaction rows — showing the
             constraint teaches the rule; hiding the column hides it. */
          cell('d', r.txn || r.readOnly,
            'Transactions are never deleted. Use Cancel, Return, Reject or Short-Close instead.') +
          '<td class="dim">' + esc(r.special || '—') + '</td></tr>';
      }).join('')).join('') +
    '</tbody></table></div>';
}

function toggleAllTasks(on) {
  document.querySelectorAll('.tp input[type=checkbox]:not(:disabled)').forEach(c => c.checked = on);
}

function saveTeam(id) {
  if (!id) { toast('Creating new teams is configuration only in the prototype.'); return; }
  const t = TEAMS[id];
  const next = {};
  TASK_ROWS.forEach(g => g.rows.forEach(r => {
    let grant = '';
    ['a', 'e', 'v', 'd'].forEach(k => {
      const el = document.getElementById('tp-' + r.id + '-' + k);
      if (el && el.checked && !el.disabled) grant += k;
    });
    if (grant) next[r.id] = grant;
  }));
  /* Keep task keys the app actually routes on; the extra reference rows are
     configuration only and would otherwise add nav items that do not exist. */
  Object.keys(next).forEach(k => { if (PAGE_MODULE[k] || TEAMS[id].tasks[k]) t.tasks[k] = next[k]; });
  Object.keys(t.tasks).forEach(k => { if (!next[k]) delete t.tasks[k]; });
  t.name = inputValue('t-name') || t.name;
  t.email = inputValue('t-email') || t.email;
  logAction('Team ' + id, 'Task profile updated', {});
  toast('Team saved. Switch role to see the effect on the navigation.');
  teamEditing = null;
  lastSidebarSig = null;
  renderPage();
}

/* ── Staff & Roles ──────────────────────────────────────────────────────── */
function buildStaffRolesPage() {
  const ids = Object.keys(POSITIONS);
  return buildPageHead('Staff & Roles',
      'A Position holds the special actions a role performs — Approve, Good Issue, Gate Outward. Module access comes from the Team, not from here: that is the per-Team decision, and it is why the two are separate screens.') +
    buildNotice('<b>Approve is a special action, never a permission.</b> The RBAC document is explicit about this: ' +
      'Good Issue, Gate Outward and Confirm Full Receipt are process actions and must not be modelled as generic Approve ticks.', 'info') +
    buildListing({
      stats: [
        { label: 'Positions', count: ids.length },
        { label: 'Internal', count: ids.filter(p => !POSITIONS[p].external).length },
        { label: 'External', count: ids.filter(p => POSITIONS[p].external).length }
      ],
      columns: [
        { label: 'Designation', cell: p => '<b>' + esc(POSITIONS[p].label) + '</b>' },
        { label: 'Known as', cell: p => esc(POSITIONS[p].short) },
        { label: 'Department', cell: p => esc(POSITIONS[p].dept) },
        { label: 'Special actions', cell: p => (SPECIAL_ACTIONS[p] || []).length
            ? (SPECIAL_ACTIONS[p] || []).map(a => '<span class="chip" style="margin:1px 3px 1px 0">' +
                esc(actionLabel(a)) + '</span>').join('')
            : '<span class="dim">—</span>' },
        /* A permission boolean is not a lifecycle status. It used to borrow the
           ok/idle triples, which drains the meaning those five hues carry. */
        { label: 'Sees commercial values', cell: p => COMMERCIAL_BLIND.indexOf(p) === -1
            ? '<span class="chip chip-on">Yes</span>' : '<span class="chip">Masked</span>' },
        { label: 'Members', cell: p => Object.keys(USERS).filter(u => USERS[u].position === p).length, align: 'center' }
      ],
      rows: ids,
      empty: 'No positions configured.'
    });
}

/* ── Notification events ────────────────────────────────────────────────── */
const NOTIFICATION_EVENTS = [
  { rule: 'When a request is created',                 email: true,  app: true,  to: 'Planner, Approver' },
  { rule: 'When a request is approved',                email: true,  app: true,  to: 'Approver, Buyer, Stores' },
  { rule: 'When an Order is created in Draft',         email: false, app: true,  to: 'Buyer' },
  { rule: 'When commercial terms are saved',           email: false, app: true,  to: 'Approver' },
  { rule: 'When an Order is approved',                 email: true,  app: true,  to: 'Planner, Material Planner' },
  { rule: 'When a Lot / Stock is allocated',           email: false, app: true,  to: 'Stores' },
  { rule: 'When material is released from Store',      email: true,  app: true,  to: "Logistics, D'Note Approver" },
  { rule: 'When a Delivery Note is returned',          email: true,  app: true,  to: 'Planner, Stores' },
  { rule: 'When a Challan is generated',               email: true,  app: true,  to: 'Security, Finance' },
  { rule: 'When Gate Outward is recorded',             email: true,  app: true,  to: 'Planner, Finance' },
  { rule: 'When the return window is close to expiry', email: true,  app: true,  to: 'Planner, Buyer' },
  { rule: 'When material is received back',            email: true,  app: true,  to: 'Finance, Planner' },
  { rule: 'When an IMR is incomplete and balance is pending', email: true, app: true, to: 'Planner, Finance' },
  { rule: 'When a Shipment is cancelled',              email: true,  app: true,  to: 'Planner, Stores, Buyer' },
  { rule: 'When a Challan is closed',                  email: true,  app: true,  to: 'Planner, Buyer, Finance' },
  { rule: 'When a vendor raises an ASN',               email: false, app: true,  to: 'Stores, Planner', added: true },
  { rule: 'When an ASN passes its declared date',      email: true,  app: true,  to: 'Planner, Buyer', added: true }
];

function buildNotificationsPage() {
  return buildPageHead('Notification Events',
      'The fifteen events the BRD specifies, plus two the vendor portal adds. Each carries its own email, in-app and recipient configuration.') +
    buildListing({
      stats: [
        { label: 'Events', count: NOTIFICATION_EVENTS.length },
        { label: 'Email', count: NOTIFICATION_EVENTS.filter(e => e.email).length },
        { label: 'In-app', count: NOTIFICATION_EVENTS.filter(e => e.app).length },
        { label: 'Added by portal', count: NOTIFICATION_EVENTS.filter(e => e.added).length }
      ],
      columns: [
        { label: 'Rule', cell: e => esc(e.rule) + (e.added ? ' <span class="sb-st sb-st-info">new</span>' : '') },
        { label: 'Email', cell: e => e.email ? '<span class="chip chip-on">Yes</span>' : '<span class="chip">No</span>', align: 'center' },
        { label: 'In app', cell: e => e.app ? '<span class="chip chip-on">Yes</span>' : '<span class="chip">No</span>', align: 'center' },
        { label: 'Recipients', cell: e => esc(e.to) }
      ],
      rows: NOTIFICATION_EVENTS,
      empty: 'No events configured.'
    });
}

registerPage('teams', buildTeamsPage);
registerPage('staff-roles', buildStaffRolesPage);
registerPage('notifications', buildNotificationsPage);

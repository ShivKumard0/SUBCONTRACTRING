/* ==========================================================================
   SHARED UI

   Built once, used by every module.  Anything that appears on more than one
   screen belongs here — the alternative is nine slightly different listing
   tables that drift apart, which is exactly what the ADT design notes warn
   about.

   Shape discipline throughout (main.css): a PILL is a read-only state and is
   never clickable; a SQUARE-cornered control is actionable and always is.
   ========================================================================== */

/* ── Listing page ───────────────────────────────────────────────────────────
   One layout for every list in the app: filters on the left, a clickable stat
   strip on the right, then the table. */
function buildListing(cfg) {
  const rows = cfg.rows || [];
  return '<div class="listing-page">' +
    '<div class="listing-top">' +
      '<div class="listing-filters">' +
        (cfg.filters ? buildFilterBar(cfg.filters, cfg.onFilter) : '') +
      '</div>' +
      (cfg.stats ? buildStatStrip(cfg.stats) : '') +
    '</div>' +
    (cfg.toolbar || '') +
    '<div class="listing-card">' +
      (rows.length ? buildTable(cfg) : buildEmpty(cfg.empty || 'Nothing here yet.')) +
    '</div>' +
  '</div>';
}

function buildTable(cfg) {
  const cols = cfg.columns;
  const head = cols.map(c => '<th' + (c.align ? ' class="ta-' + c.align + '"' : '') + '>' + esc(c.label) + '</th>').join('');
  const body = cfg.rows.map((r, i) => {
    /* data-label carries the column heading onto the cell, so that below the
       breakpoint each row can restack as a labelled card instead of forcing
       the table to scroll sideways. */
    const cells = cols.map(c => {
      const v = c.cell(r, i);
      const cls = [c.align ? 'ta-' + c.align : '', c.cls || ''].filter(Boolean).join(' ');
      return '<td' + (cls ? ' class="' + cls + '"' : '') +
             ' data-label="' + attrSafe(c.label) + '">' + (v == null ? '' : v) + '</td>';
    }).join('');
    /* F34 · A <tr> is not a button. It was carrying tabindex and onclick, so
       keyboard focus landed on it and Enter did nothing — advertising support
       that did not exist, which is worse than offering no focus stop. */
    const act = cfg.onRow ? cfg.onRow(r) : '';
    const attrs = cfg.onRow
      ? ' tabindex="0" role="button" onclick="' + act +
        '" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();' + act + '}"'
      : '';
    const sel = cfg.isSelected && cfg.isSelected(r) ? ' class="row-sel"' : '';
    return '<tr' + sel + attrs + '>' + cells + '</tr>';
  }).join('');
  return '<table class="listing-table' + (cfg.tableClass ? ' ' + cfg.tableClass : '') +
         '"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>';
}

/* An empty list caused by a filter must say so — otherwise the app tells the
   user their data does not exist. A genuinely empty one gets a designed state
   rather than an apologetic sentence. */
function buildEmpty(msg) {
  if (anyFilterActive())
    return '<div class="lst-empty"><div class="lst-empty-ico">' + ico.layers + '</div>' +
           '<b>Nothing matches these filters</b><span>' + esc(msg) + '</span>' +
           '<div style="margin-top:12px"><button class="btn-outline btn-sm" onclick="clearFilters()">Clear filters</button></div></div>';
  return '<div class="lst-empty"><div class="lst-empty-ico">' + ico.inbox + '</div>' +
         '<b>All clear</b><span>' + esc(msg) + '</span></div>';
}

/* ── Time exists ────────────────────────────────────────────────────────────
   Every transition is stamped in the activity log, yet nothing on screen said
   how long anything had SAT — "with Stores", but never since when. Dwell time
   is what converts a status into a priority. */
function lastTouchIso(id) {
  for (let i = 0; i < activityLog.length; i++)     /* newest first */
    if (activityLog[i].object === id) return activityLog[i].iso;
  return null;
}
function ageDays(id) {
  const iso = lastTouchIso(id);
  if (!iso) return null;
  return Math.max(0, Math.floor((today() - new Date(iso)) / 86400000));
}
function fmtAge(d) {
  if (d == null) return '';
  if (d === 0) return 'today';
  return d + (d === 1 ? ' day' : ' days');
}
/* The return window as a bar, not a number — "45 of 60 days" at a glance,
   switching tone as it approaches and passes the deadline. Shared by the
   dashboard and the vendor portal. */
function agingBar(c) {
  const left = daysRemaining(c);
  if (left == null) return '';
  const total = subConParams.returnWindowDays;
  const used = Math.min(total, Math.max(0, total - left));
  const pct = Math.round(used / total * 100);
  const tone = left < 0 ? 'bad' : left <= subConParams.returnWarnDays ? 'warn' : 'ok';
  const cap = left < 0 ? Math.abs(left) + ' days overdue' : used + ' of ' + total + ' days';
  return '<div class="agebar agebar-' + tone + '" title="' + attrSafe(cap) + '">' +
    '<i style="width:' + pct + '%"></i></div><span class="agebar-cap">' + esc(cap) + '</span>';
}

/* An Age cell for queue listings — amber once it has sat past the threshold. */
function ageCell(id, warnAt) {
  const d = ageDays(id);
  if (d == null) return '<span class="dim">—</span>';
  return '<span class="age' + (d >= (warnAt || 5) ? ' age-warn' : '') + '">' + fmtAge(d) + '</span>';
}

/* F32 · A printed identifier that navigates. Every cross-reference in the app
   goes through this — the linked-document model is the module's whole claim,
   and following a link used to mean going back to a listing and searching. */
function refLink(id, label) {
  if (!id) return '<span class="dim">—</span>';
  /* Only render a control if there is somewhere to go. The activity log routes
     every object id through here, including ones with no screen behind them —
     those used to render as real buttons that swallowed the click. */
  if (!isRoutable(id)) return '<span class="mono">' + esc(label || id) + '</span>';
  return '<button class="reflink" onclick="event.stopPropagation();openRecord(\'' + attrSafe(id) + '\')">' +
         esc(label || id) + '</button>';
}

/* Filters apply the moment a value is picked — a select you change and then
   press a separate Search button to enact is a dated pattern, and it kept a
   second dark button competing with the page's real action. Clear remains for
   getting back to everything. */
function onFilterSelect(value, id) {
  pageFilters()[id] = value;
  renderPage();
}
function buildFilterBar(filters) {
  const controls = filters.map(f => {
    const key = 'flt-' + statusClass(f.label);
    const applied = pageFilters()[key];
    return '<div class="filter-cell"><label class="filter-cap">' + esc(f.label) + '</label>' +
      customSelect(key, applied || 'All', ['All'].concat(f.options), 'All', 'cs-sm', 'onFilterSelect') + '</div>';
  }).join('');
  return '<div class="filter-row">' + controls +
    '<button class="filter-reset" onclick="clearFilters()">Clear</button></div>';
}

/* F16 · Stat strip. Every one of these was inert: buildStatStrip only attached
   a handler when a caller passed `onClick`, and no caller ever did — so the
   comment below described an intention rather than the build. A stat that
   names a filter now applies it, and shows as active while it holds. */
function buildStatStrip(stats) {
  return '<div class="listing-stats">' + stats.map(s => {
    const wired = s.filter
      ? 'setFilter(\'' + attrSafe(s.filter[0]) + '\',\'' + attrSafe(s.filter[1]) + '\')'
      : (s.onClick || '');
    const active = s.filter ? filterValue(s.filter[0]) === s.filter[1] : !!s.active;
    const attrs = wired
      ? ' tabindex="0" role="button" onclick="' + wired +
        '" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();' + wired + '}"'
      : '';
    return '<div class="listing-stat' + (active ? ' active' : '') + '"' + attrs + '>' +
      '<span class="listing-stat-count">' + esc(String(s.count)) + '</span>' +
      '<span class="listing-stat-label">' + esc(s.label) + '</span></div>';
  }).join('') + '</div>';
}

/* ── Page header ────────────────────────────────────────────────────────── */
function buildPageHead(title, sub, actions) {
  return '<div class="pg-head"><div><h1 class="pg-title">' + esc(title) + '</h1>' +
    (sub ? '<p class="pg-sub">' + sub + '</p>' : '') + '</div>' +
    (actions ? '<div class="pg-actions">' + actions + '</div>' : '') + '</div>';
}

/* ── Detail sections ────────────────────────────────────────────────────── */
function buildCard(title, inner, actions) {
  return '<div class="card"><div class="card-head"><span class="card-title">' + esc(title) + '</span>' +
    (actions ? '<div class="card-actions">' + actions + '</div>' : '') + '</div>' +
    '<div class="card-body">' + inner + '</div></div>';
}

/* A read-only field grid. Values already rendered as HTML pass through, so a
   status badge or a masked value can be dropped straight in. */
function buildFieldGrid(pairs, cols) {
  return '<div class="fgrid" style="--fg-cols:' + (cols || 3) + '">' + pairs.map(p =>
    '<div class="fgrid-cell"><span class="fgrid-label">' + esc(p[0]) + '</span>' +
    '<span class="fgrid-value">' + (p[1] == null || p[1] === '' ? '<span class="fg-none">Not set</span>' : p[1]) + '</span></div>'
  ).join('') + '</div>';
}

/* ── Form inputs ────────────────────────────────────────────────────────────
   Shape says what a control does: a typeable field is fully rounded
   (--r-input), a thing you pick or press is square-cornered (--r-control).
   A textarea stays square — a pill radius would eat into the text. */
function fField(label, control, required, hint) {
  return '<div class="ff">' +
    '<label class="ff-label">' + esc(label) + (required ? '<i class="ff-req">*</i>' : '') + '</label>' +
    control + (hint ? '<span class="ff-hint">' + esc(hint) + '</span>' : '') + '</div>';
}
function fText(id, value, ph) {
  return '<input class="inp" id="' + id + '" value="' + attrSafe(value || '') + '" placeholder="' + attrSafe(ph || '') + '">';
}
function fNum(id, value, ph, step) {
  return '<input class="inp inp-num" type="number" id="' + id + '" value="' + attrSafe(value == null ? '' : value) +
         '" step="' + (step || '0.001') + '" min="0" placeholder="' + attrSafe(ph || '') + '">';
}
function fDate(id, value) {
  return '<input class="inp" type="date" id="' + id + '" value="' + attrSafe(value || '') + '">';
}
function fArea(id, value, ph) {
  return '<textarea class="inp inp-area" id="' + id + '" rows="3" placeholder="' + attrSafe(ph || '') + '">' + esc(value || '') + '</textarea>';
}
/* `onChange` names a global to call after the toggle flips — which is how a
   dependent field appears or disappears the moment the answer changes, rather
   than sitting on screen asking a question that no longer applies. */
function fToggle(id, on, labelOn, labelOff, onChange) {
  return '<button type="button" class="tgl' + (on ? ' on' : '') + '" id="' + id + '" ' +
    'onclick="this.classList.toggle(\'on\');this.setAttribute(\'aria-pressed\',this.classList.contains(\'on\'));' +
    (onChange ? onChange + '(this.classList.contains(\'on\'));' : '') + '" ' +
    'aria-pressed="' + (on ? 'true' : 'false') + '"><span class="tgl-knob"></span>' +
    '<span class="tgl-txt">' + esc(on ? (labelOn || 'Yes') : (labelOff || 'No')) + '</span></button>';
}
function toggleValue(id) {
  const el = document.getElementById(id);
  return !!(el && el.classList.contains('on'));
}
function inputValue(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}
function numValue(id) {
  const v = inputValue(id);
  return v === '' ? 0 : Number(v);
}

/* ── Validation summary ─────────────────────────────────────────────────────
   Every failure at once, not one per attempt. An error says what went wrong
   and what to do — never an apology, never a bare "invalid". */
function buildErrors(errs) {
  if (!errs || !errs.length) return '';
  return '<div class="errbox"><div class="errbox-head">' +
    (errs.length === 1 ? 'This cannot be submitted yet' : errs.length + ' things need attention') +
    '</div><ul class="errbox-list">' + errs.map(e => '<li>' + esc(e) + '</li>').join('') + '</ul></div>';
}
function buildNotice(msg, tone) {
  return '<div class="notice notice-' + (tone || 'info') + '">' + msg + '</div>';
}

/* ── Stage bar ──────────────────────────────────────────────────────────────
   The journey, with the current position marked. Uses the eight-step pipeline
   ladder from main.css, where the SHADE IS THE DATA — it says how far along
   the deal is, which is why those greens are deliberately not folded into one. */
const JOURNEY = ['Request', 'Order', 'Shipment', 'Outbound', 'Documents', 'Gate', 'Inward', 'Closed'];

function buildStageBar(currentIndex) {
  return '<div class="stagebar">' + JOURNEY.map((s, i) => {
    const state = i < currentIndex ? 'done' : i === currentIndex ? 'now' : 'todo';
    return '<div class="stage stage-' + state + '" style="--p:' + (i + 1) + '">' +
      '<span class="stage-dot">' + (i < currentIndex ? '&#10003;' : (i + 1)) + '</span>' +
      '<span class="stage-label">' + esc(s) + '</span></div>';
  }).join('') + '</div>';
}

/* Where a deal actually is, derived from state rather than stored — a stored
   stage would be one more thing that can disagree with the six status tracks. */
/* F11 · This read the shipment status alone, and a shipment sits at Gate
   Cleared from dispatch until closure — so index 6 ("Inward") was unreachable
   for any real state, and a deal with confirmed receipts still showed Gate as
   its current step. The entire return half of the journey was invisible on the
   one screen whose job is to show the journey.

   Receipts now move it forward: any confirmed IMR reaches Inward, full receipt
   reaches Closed-1, closure reaches the end. */
/* NOW DERIVED FROM THE EIGHTEEN-STAGE SPINE, NOT SEPARATELY.

   This function used to work the position out for itself by reading the SCR,
   PO and shipment statuses — which was correct, and was ALSO a second answer
   to a question journey.js already answers in finer detail. Two derivations
   of "where is this deal" is precisely the drift the derived-not-stored rule
   exists to prevent: the moment a stage is added, one of them is updated and
   the other quietly disagrees. The eight-step bar and the journey bar would
   then contradict each other on the same screen.

   The bar is now a lower-resolution VIEW of dealStage(), through the band map
   in journey.js. Adding a stage there updates both. */
function journeyIndex(scrId) {
  return dealBand(scrId);
}

/* ══════════════════════════════════════════════════════════════════════════
   WHAT HAPPENS NEXT

   A hand-off workflow is only usable if, at every point, the screen answers
   three questions: what state is this in, who has it now, and what do they do.
   Without that a user approves something and is left staring at a page with no
   idea whether they are finished or stuck.

   nextStepFor() walks the whole journey for one request and returns the single
   pending action — who holds it, what they will do, and where it is done.
   Every detail screen renders it, so the answer is the same wherever you are
   standing.
   ══════════════════════════════════════════════════════════════════════════ */

/* The first person holding a given position. Real deployments would route to a
   queue; a named person reads far better than "a Buyer". */
function holderOf(position) {
  const id = Object.keys(USERS).find(k => USERS[k].position === position);
  return id ? { id: id, name: USERS[id].name, position: position } : null;
}

function nextStepFor(scrId) {
  const r = scr(scrId);
  if (!r) return null;
  const step = (position, verb, detail, pg, rec) =>
    ({ who: holderOf(position), verb: verb, detail: detail, page: pg, record: rec });

  if (r.status === 'Closed')
    return { done: true, verb: 'This request is complete',
             detail: 'Every obligation has been met and the request, its order and its documents are closed.' };
  if (r.status === 'Rejected')
    return { done: true, verb: 'This request was rejected',
             detail: r.reason + (r.remarks ? ' — ' + r.remarks : '') + ' It will not go any further.' };

  if (r.status === 'Created')
    return step('planner', 'Submit this request for approval',
      'Add the issue and receivable items, then send it to be approved.', 'scr', r.id);
  if (r.status === 'Returned')
    return step('planner', 'Correct and resubmit',
      r.reason + (r.remarks ? ' — ' + r.remarks : ''), 'scr', r.id);
  if (r.status === 'Sent for Approval' || r.status === 'Modified')
    return step('pmg-approver', 'Review this request',
      'Approve it to create the order, or return it with a reason.', 'scr', r.id);

  const p = poForScr(scrId);
  if (p && p.nonBillableConfirmed === false)
    return step('finance', 'Confirm the non-billable request',
      'This is a zero-value order, so Finance decides before the buyer can raise it.', 'orders', p.id);
  if (p && p.status === 'Draft')
    return step('buyer', 'Complete the commercial terms',
      'Purchase office, expected receipt date and rate, then generate the order.', 'orders', p.id);
  if (p && p.status === 'Created')
    return step('pmg-approver', 'Approve the order',
      'Once approved, material can be reserved and shipped.', 'orders', p.id);

  const ships = shipmentsForScr(scrId).filter(s => s.status !== 'Cancelled');
  const open = r.issueItems.some(l => openIssueQty(scrId, l.line) > 0.001);
  const live = ships.filter(s => s.status !== 'Closed');

  if (!live.length && open) {
    /* Straight to the quantity step, context intact — the generic route sent
       the planner to the Shipments list where they re-selected the request
       they were already standing on. */
    const st = step('planner', 'Create a shipment',
      'The order is approved, so material can be reserved and sent out.', 'shipments', null);
    st.go = "startShipmentFor('" + scrId + "')";
    return st;
  }

  const s = live[live.length - 1];
  if (s) {
    if (isReturned(s))
      return step(s.returnedTo, 'Resolve the returned shipment',
        s.returnReason + (s.returnRemarks ? ' — ' + s.returnRemarks : ''), 'shipments', s.id);
    if (s.status === 'Created' && needsLotAllocation(s.id) && !isAllocated(s.id))
      return step('material-planner', 'Allocate the lots',
        'This shipment carries lot-controlled material, which Stores cannot issue until exact lots are named.',
        'allocation', s.id);
    if (s.status === 'Created')
      return step('stores', 'Issue the material',
        'Verify the reserved quantity and release it from the store.', 'outbound', s.id);
    if (s.status === 'Freezed Outbound Release') {
      if (r.logistics && !s.logistics)
        return step('logistics', 'Arrange transport',
          'Vehicle, driver and package details, then the delivery note can be raised.', 'logistics', s.id);
      const d = dnoteForShipment(s.id);
      if (!d)
        return step('stores', 'Raise the delivery note',
          'The material is released and ready to be documented.', 'delivery-notes', s.id);
      if (d.status === 'Returned')
        return step('stores', 'Correct the delivery note',
          d.reason + (d.remarks ? ' — ' + d.remarks : ''), 'delivery-notes', d.id);
      if (d.status === 'Generated')
        return step('dnote-approver', 'Approve the delivery note',
          'Check the material and dispatch details against the shipment.', 'delivery-notes', d.id);
      return step('finance', 'Generate the challan',
        'The delivery note is approved, so the outward movement can be authorised.', 'challans', d.id);
    }
    if (s.status === 'Challan Generated') {
      const c = challanForShipment(s.id);
      if (c && isReturned(c))
        return step(c.returnedTo, 'Resolve the returned challan',
          c.returnReason + (c.returnRemarks ? ' — ' + c.returnRemarks : ''), 'challans', c.id);
      return step('security', 'Record gate outward',
        'Verify the documents, material and vehicle, then record what actually left.', 'gate', c ? c.id : null);
    }
    if (s.status === 'Gate Cleared') {
      const c = challanForShipment(s.id);
      const outstanding = c ? challanOutstanding(c.id) : 0;
      if (outstanding > 0.001)
        return step('stores', 'Receive the material back',
          fmtQty(outstanding) + ' still to come back from ' + vendor(r.vendorId).name +
          (c && c.returnByDate ? ', due by ' + c.returnByDate : '') + '.', 'inward', c ? c.id : null);
      if (!r.fullReceipt)
        return step('finance', 'Confirm full receipt',
          'Everything expected is back. Reconcile the issue material and confirm.', 'reconciliation', r.id);
      return step('finance', 'Close the challan',
        'Full receipt is confirmed, so the transaction can be settled.', 'reconciliation', r.id);
    }
  }
  if (r.fullReceipt)
    return step('finance', 'Close the request', 'Everything is accounted for.', 'reconciliation', r.id);
  return step('finance', 'Reconcile the material', 'Account for what went out against what came back.',
    'reconciliation', r.id);
}

function buildNextStep(scrId) {
  const n = nextStepFor(scrId);
  if (!n) return '';
  if (n.done)
    return '<div class="nxt nxt-done"><div class="nxt-body">' +
      '<span class="nxt-cap">Complete</span>' +
      '<span class="nxt-verb">' + esc(n.verb) + '</span>' +
      '<span class="nxt-detail">' + esc(n.detail) + '</span></div></div>';

  const mine = n.who && n.who.position === currentPosition();
  const goto = n.go ? n.go
    : n.record ? 'openRecord(\'' + attrSafe(n.record) + '\')'
    : 'navigatePage(\'' + attrSafe(n.page) + '\')';

  /* How long it has sat — a status becomes a priority only with a clock on it. */
  const d = ageDays(n.record || scrId);
  const wait = d != null && d > 0 ? ' <span class="nxt-age">&middot; waiting ' + fmtAge(d) + '</span>' : '';

  return '<div class="nxt' + (mine ? ' nxt-mine' : '') + '"><div class="nxt-body">' +
      '<span class="nxt-cap">' + (mine ? 'Your turn' : 'Waiting on someone else') + wait + '</span>' +
      '<span class="nxt-verb">' + esc(n.verb) + '</span>' +
      '<span class="nxt-detail">' + esc(n.detail) + '</span>' +
      (mine ? '' : '<span class="nxt-who">With <b>' + esc(n.who ? n.who.name : 'another team') + '</b>' +
        (n.who ? ' &middot; ' + esc(positionLabel(n.who.position)) : '') + '</span>') +
    '</div><div class="nxt-act">' +
      (mine
        ? '<button class="btn-primary" onclick="' + goto + '">Go to it</button>'
        /* A demo affordance, dressed as one — not the screen's primary action. */
        : (n.who ? '<span class="nxt-demo"><button class="btn-outline btn-sm" onclick="continueAs(\'' + n.who.id + '\',\'' +
            attrSafe(n.record || '') + '\',\'' + attrSafe(n.page) + '\')">Continue as ' +
            esc(n.who.name.split(' ')[0]) + '</button><span class="nxt-demo-cap">demo hand-off</span></span>' : '')) +
    '</div></div>';
}

/* A confirmation should say where the work went, not only that something
   happened. "Approved." leaves you staring at a screen; "Approved — now with
   Karan Mehta to price it" tells you the thing is moving and you are done. */
function handoffMsg(scrId, prefix) {
  const n = nextStepFor(scrId);
  if (!n) return prefix;
  if (n.done) return prefix + ' ' + n.verb + '.';
  if (n.who && n.who.position === currentPosition())
    return prefix + ' Next: ' + n.verb.charAt(0).toLowerCase() + n.verb.slice(1) + '.';
  return prefix + ' Now with ' + (n.who ? n.who.name : 'the next team') + ' to ' +
         n.verb.charAt(0).toLowerCase() + n.verb.slice(1) + '.';
}

/* Signs in as the person who holds the next step and lands on it. In a real
   deployment they would simply be notified; here it keeps a walkthrough moving
   without hunting through the role switcher for the right name. */
function continueAs(userId, recordId, pageId) {
  setCurrentUser(userId);
  if (recordId) openRecord(recordId);
  else if (pageId) navigatePage(pageId);
}

/* ── Modals ─────────────────────────────────────────────────────────────────
   One host, one open modal at a time. Escape and the backdrop both close it,
   because a modal that can only be dismissed by finding the right button is a
   trap. */
let modalOnConfirm = null;
let modalOnCancel = null;

function modalHost() {
  let h = document.getElementById('modal-host');
  if (!h) {
    h = document.createElement('div');
    h.id = 'modal-host';
    document.body.appendChild(h);
  }
  return h;
}

function closeModal() {
  modalHost().innerHTML = '';
  modalOnConfirm = null;
  /* A dismissal is an event some flows must hear — the IMR receipt reopens
     itself pre-filled when its stacked reason modal is cancelled. */
  const cancel = modalOnCancel;
  modalOnCancel = null;
  if (modalReturnFocus && document.contains(modalReturnFocus)) modalReturnFocus.focus();
  modalReturnFocus = null;
  if (cancel) cancel();
}

/* No "danger" button variant exists, deliberately. The button system carries
   NO semantic colour — a red Cancel would be indistinguishable in kind from a
   status badge, and the design notes reserve colour for status alone. The
   label says what will happen; that is the whole warning. */
function openModal(title, bodyHtml, confirmLabel, onConfirm, opts) {
  opts = opts || {};
  modalOnConfirm = onConfirm;
  modalOnCancel = opts.onCancel || null;
  modalReturnFocus = document.activeElement;
  modalHost().innerHTML =
    '<div class="modal-back" onclick="if(event.target===this)closeModal()">' +
      '<div class="modal" role="dialog" aria-modal="true" aria-label="' + attrSafe(title) + '">' +
        '<div class="modal-head"><span class="modal-title">' + esc(title) + '</span>' +
          '<button class="modal-x" onclick="closeModal()" aria-label="Close">&times;</button></div>' +
        '<div class="modal-body">' + bodyHtml + '</div>' +
        '<div class="modal-foot">' +
          /* Destructive left and outlined, affirmative right and filled — the
             eye lands on the filled button last, which is the one most rows
             end on. */
          '<button class="btn-outline" onclick="closeModal()">Cancel</button>' +
          '<button class="btn-primary" onclick="confirmModal()">' + esc(confirmLabel) + '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  const first = modalHost().querySelector('.modal-body input, .modal-body .custom-select-trigger');
  if (first) first.focus();
}

function confirmModal() {
  if (modalOnConfirm) {
    const keep = modalOnConfirm();
    if (keep === false) return;      /* validation failed — leave the modal up */
  }
  modalOnCancel = null;              /* a confirm is not a dismissal */
  closeModal();
}

/* A3 · Focus was neither trapped nor restored: Tab escaped into the page
   behind the dialog, and closing it dropped focus to the document. Reason
   modals sit on the critical path of nearly every exception in the app. */
let modalReturnFocus = null;
document.addEventListener('keydown', e => {
  const back = document.querySelector('.modal-back');
  if (!back) return;
  if (e.key === 'Escape') { closeModal(); return; }
  if (e.key !== 'Tab') return;
  const f = back.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  const list = Array.prototype.filter.call(f, el => !el.disabled && el.offsetParent !== null);
  if (!list.length) return;
  const first = list[0], last = list[list.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

/* ── Reason-code modal ──────────────────────────────────────────────────────
   Used fifteen times across the build. "Other" ALWAYS forces remarks — the
   BRD states it for each group separately, and enforcing it here means it can
   never be forgotten on the sixteenth. */
function openReasonModal(groupKey, actionLabel, onConfirm, onCancel) {
  const g = reasonMaster[groupKey];
  if (!g) return;
  /* The RC- group code stays reachable for auditors in the tooltip; printed
     on screen it read as debug text. Picking "Other" marks Remarks required
     the moment it is chosen, not only in the rejection. */
  const body =
    '<p class="modal-note" title="' + attrSafe('BRD reason group ' + groupKey) + '">' + esc(g.label) + '</p>' +
    fField('Reason', customSelect('rsn-select', '', g.reasons, 'Select a reason', '', 'onReasonPick'), true) +
    '<div id="rsn-remarks-wrap">' +
      fField('Remarks', fArea('rsn-remarks', '', 'What should the person correcting this know?')) +
    '</div>' +
    '<div id="rsn-err"></div>';
  openModal(actionLabel, body, actionLabel, () => {
    const reason = getSelectValue('rsn-select');
    const remarks = inputValue('rsn-remarks');
    const errs = [];
    if (!reason) errs.push('Select a reason before continuing.');
    if (reason === 'Other' && !remarks) errs.push('Remarks are mandatory when the reason is “Other”.');
    if (errs.length) {
      document.getElementById('rsn-err').innerHTML = buildErrors(errs);
      return false;
    }
    onConfirm(reason, remarks);
    return true;
  }, { onCancel: onCancel });
}

function onReasonPick(value) {
  const wrap = document.getElementById('rsn-remarks-wrap');
  if (!wrap) return;
  const label = wrap.querySelector('.ff-label');
  if (label) label.innerHTML = 'Remarks' + (value === 'Other' ? '<i class="ff-req">*</i>' : '');
}

/* ── Confirm dialog ─────────────────────────────────────────────────────── */
function openConfirm(title, message, confirmLabel, onConfirm, danger) {
  openModal(title, '<p class="modal-msg">' + message + '</p>', confirmLabel, () => { onConfirm(); return true; }, { danger: danger });
}

/* ── Row action guard ───────────────────────────────────────────────────────
   A button the current position may not press is DISABLED with the reason in
   its tooltip, not hidden. Hiding it makes the workflow look broken; showing
   it disabled teaches who the action belongs to. */
/* A1 · The reason a button is unavailable used to live only in `title` — a
   disabled button is not focusable, so a keyboard or touch user could never
   reach the explanation. `aria-disabled` keeps the control reachable and
   announced, and the reason is exposed as a real label rather than a tooltip. */
function actionBtn(label, handler, allowed, whyNot, variant) {
  const cls = variant || 'btn-outline';
  if (allowed) return '<button class="' + cls + '" onclick="' + handler + '">' + esc(label) + '</button>';
  const why = whyNot || 'Not available to your position';
  return '<span class="act-blocked">' +
    '<button class="' + cls + '" aria-disabled="true" data-blocked="1" ' +
    'onclick="toast(\'' + attrSafe(why).replace(/'/g, "\\'") + '\',\'bad\')">' + esc(label) + '</button>' +
    '<span class="act-why">' + esc(why) + '</span></span>';
}

/* ── Filter state ───────────────────────────────────────────────────────────
   F09 · NAMESPACED PER PAGE, AND RESET ON NAVIGATION.

   This was one flat global keyed on the filter's LABEL, so "Status" was a
   single shared slot across the whole app. Filtering Requests to Approved and
   then opening Shipments silently hid both shipments — and because the chips
   always rendered "All", nothing on screen said why. The empty state then
   claimed "No shipments yet" about data that existed.

   Keyed by page now, cleared by navigatePage, and the chips render what is
   actually applied. */
let filterState = {};
function pageFilters() { return (filterState[page] = filterState[page] || {}); }
function resetFilters() { filterState[page] = {}; }

function applyFilters() {
  const f = pageFilters();
  document.querySelectorAll('.filter-row .custom-select').forEach(cs => {
    f[cs.id] = cs.dataset.unset === '1' ? '' : cs.dataset.value;
  });
  renderPage();
}
function clearFilters() { resetFilters(); renderPage(); }
function filterValue(label) {
  const v = pageFilters()['flt-' + statusClass(label)];
  return (!v || v === 'All') ? null : v;
}
function passesFilter(label, value) {
  const f = filterValue(label);
  return !f || f === value;
}
function anyFilterActive() {
  const f = pageFilters();
  return Object.keys(f).some(k => f[k] && f[k] !== 'All');
}

/* Set one filter directly — what a stat tile does when clicked. */
function setFilter(label, value) {
  const f = pageFilters();
  const key = 'flt-' + statusClass(label);
  f[key] = (f[key] === value) ? '' : value;      /* clicking the active one clears it */
  renderPage();
}

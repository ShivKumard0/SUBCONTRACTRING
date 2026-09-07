/* ==========================================================================
   NOTIFICATIONS

   The BRD tabulates fifteen events with an Email / In-App / recipient
   configuration each. They were listed on a configuration screen and none of
   them fired — so the one part of the module a user actually feels day to day
   did not exist.

   Events are raised from the state machine, addressed by POSITION (the BRD's
   Member column names roles, not people), and delivered to anyone holding that
   position. Email is simulated: the flag is recorded so the demo can show which
   events would have sent one, since a prototype has nothing to send with.
   ========================================================================== */

const notifications = [];
let notifSeq = 0;

/* Which positions each rule addresses, keyed to the BRD's own wording. */
const NOTIFY_RULES = {
  'request-created':    { rule: 'When a request is created',                 email: true,  to: ['planner', 'pmg-approver'] },
  'request-approved':   { rule: 'When a request is approved',                email: true,  to: ['pmg-approver', 'buyer', 'stores'] },
  'order-draft':        { rule: 'When an Order is created in Draft',         email: false, to: ['buyer'] },
  'terms-saved':        { rule: 'When commercial terms are saved',           email: false, to: ['pmg-approver'] },
  'order-approved':     { rule: 'When an Order is approved',                 email: true,  to: ['planner', 'material-planner'] },
  'lot-allocated':      { rule: 'When a Lot / Stock is allocated',           email: false, to: ['stores'] },
  'material-released':  { rule: 'When material is released from Store',      email: true,  to: ['logistics', 'dnote-approver'] },
  'dnote-returned':     { rule: 'When a Delivery Note is returned',          email: true,  to: ['planner', 'stores'] },
  /* IDT is addressed alongside Finance on everything they share, and the
     administrator receives the exceptions. Both used to hold positions no rule
     named at all, so their bell could never show anything. */
  'challan-generated':  { rule: 'When a Challan is generated',               email: true,  to: ['security', 'finance', 'idt'] },
  'gate-recorded':      { rule: 'When Gate Outward is recorded',             email: true,  to: ['planner', 'finance', 'idt'] },
  'window-closing':     { rule: 'When the return window is close to expiry', email: true,  to: ['planner', 'buyer', 'pmg-admin'] },
  'material-received':  { rule: 'When material is received back',            email: true,  to: ['finance', 'planner', 'idt'] },
  'balance-pending':    { rule: 'When an IMR is incomplete and balance is pending', email: true, to: ['planner', 'finance', 'pmg-admin'] },
  'shipment-cancelled': { rule: 'When a Shipment is cancelled',              email: true,  to: ['planner', 'stores', 'buyer', 'pmg-admin'] },
  'challan-closed':     { rule: 'When a Challan is closed',                  email: true,  to: ['planner', 'buyer', 'finance', 'idt'] },
  /* Added by the vendor portal, which the BRD predates. */
  'asn-raised':         { rule: 'When a vendor raises an ASN',               email: false, to: ['stores', 'planner'] },
  'asn-overdue':        { rule: 'When an ASN passes its declared date',      email: true,  to: ['planner', 'buyer'] },
  /* Addressed to the people who actually decide. This used to reuse the
     'order-draft' rule, which is addressed to the Buyer — so the message
     saying "back with Finance" went to everyone except Finance. */
  'nonbillable-reopen': { rule: 'When a non-billable decision is reopened',  email: true,  to: ['finance', 'idt'] },
  'stage-returned':     { rule: 'When a record is returned for correction',  email: true,  to: [] }
};

function notify(key, subject, body, link) {
  const r = NOTIFY_RULES[key];
  if (!r) return;
  const t = stampNow();
  notifications.unshift({
    id: 'NTF-' + String(++notifSeq).padStart(4, '0'),
    key: key, rule: r.rule, email: r.email, to: r.to.slice(),
    subject: subject, body: body || '', link: link || '',
    date: t.date, time: t.time, read: false
  });
}

/* Addressed to a position, so switching role changes the inbox — which is what
   makes the per-role model visible in the demo. */
function notificationsFor(position) {
  return notifications.filter(n => n.to.indexOf(position) !== -1);
}
function unreadCount(position) {
  return notificationsFor(position).filter(n => !n.read).length;
}
function markAllRead(position) {
  notificationsFor(position).forEach(n => n.read = true);
}
function markRead(nid) {
  const n = notifications.find(x => x.id === nid);
  if (n) n.read = true;
}

/* ── The panel ──────────────────────────────────────────────────────────── */
function buildNotifPanel() {
  const rows = notificationsFor(currentPosition());
  if (!rows.length) {
    return '<div class="np-head"><span class="np-title">Notifications</span></div>' +
           '<div class="lst-empty" style="padding:28px 16px">Nothing for ' +
           esc(positionLabel(currentPosition())) + ' yet.</div>';
  }
  return '<div class="np-head"><span class="np-title">Notifications</span>' +
      '<button class="np-mark" onclick="markAllRead(currentPosition());renderPage()">Mark all read</button></div>' +
    '<div class="np-list">' + rows.slice(0, 12).map(n =>
      /* Opening a notification reads it — the badge used to clear only via
         "Mark all read", so it never went down from actually doing the work. */
      '<div class="np-item' + (n.read ? '' : ' np-unread') + '"' +
        (n.link ? ' role="button" tabindex="0" onclick="closeHeaderMenus();markRead(\'' + n.id + '\');openRecord(\'' + attrSafe(n.link) + '\')"' +
                  ' onkeydown="if(event.key===\'Enter\'){closeHeaderMenus();markRead(\'' + n.id + '\');openRecord(\'' + attrSafe(n.link) + '\')}"' : '') + '>' +
        '<div class="np-body">' +
          '<div class="np-row1"><span class="np-text">' + esc(n.subject) + '</span>' +
            '<span class="np-time">' + esc(n.time) + '</span></div>' +
          (n.body ? '<div class="np-row2">' + esc(n.body) + '</div>' : '') +
          '<div class="np-row2 dim">' + esc(n.rule) +
            (n.email ? ' <span class="chip">email</span>' : '') + '</div>' +
        '</div></div>').join('') + '</div>';
}

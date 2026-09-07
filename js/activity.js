/* ==========================================================================
   ACTIVITY LOG  —  append-only, and that is the entire point.

   RBAC rules 10 and 11: every Add, Edit, Submit, Approve, Return, Reject,
   Cancel, Generate, Allocation, Good Issue, Good Receipt, Gate Outward and
   Closure is captured, and the resulting records are view-only and never
   editable or deletable.

   So there is ONE way in — logAction() — and no way out.  There is
   deliberately no edit, no delete and no clear.  A correction is a new entry
   describing the correction, which is what an audit trail means.
   ========================================================================== */

const activityLog = [];
let activitySeq = 0;

/* Fixed clock so a demo reads the same on any machine and screenshots stay
   stable.  Real time would make every walkthrough differ. */
let demoClock = new Date(2026, 7, 24, 9, 12, 0);   /* 24 Aug 2026, 09:12 */

function clockNow() {
  demoClock = new Date(demoClock.getTime() + 4 * 60000);   /* +4 min per action */
  return new Date(demoClock);
}

function stampNow() {
  const d = clockNow();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const hh = d.getHours(), mm = String(d.getMinutes()).padStart(2, '0');
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 || 12;
  return {
    iso: d.toISOString(),
    date: d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear(),
    time: h12 + ':' + mm + ' ' + ampm
  };
}

/* Not every event has a human behind it. A return window expiring is caused by
   the clock, and attributing it to whoever happened to be looking at a screen
   forges an entry in a log this app describes as append-only and immutable.
   Verified before this fix: merely rendering the dashboard as Security wrote
   "Return window expired — Ganesh Murthy, Security". */
const SYSTEM_ACTOR = { name: 'System', position: 'Automatic', id: 'system' };

/* The single writer.
     object   what it happened to, e.g. 'SCR SUB-000318'
     action   the verb, e.g. 'Approved'
     detail   { from, to, reason, remarks, by } — all optional
              by: 'system' for clock-driven events, or a user id to attribute
              an action to somebody other than the signed-in user. */
function logAction(object, action, detail) {
  const who = detail && detail.by;
  const u = who === 'system' ? SYSTEM_ACTOR
          : (who && USERS[who]) ? USERS[who]
          : currentUser();
  const uid = who === 'system' ? 'system' : (who && USERS[who] ? who : currentUserId);
  const t = stampNow();
  activityLog.unshift({
    id: 'LOG-' + String(++activitySeq).padStart(5, '0'),
    object: object,
    action: action,
    from: (detail && detail.from) || '',
    to: (detail && detail.to) || '',
    reason: (detail && detail.reason) || '',
    remarks: (detail && detail.remarks) || '',
    user: u.name,
    userId: uid,
    position: uid === 'system' ? 'Automatic' : positionLabel(u.position),
    team: u.team || '—',
    date: t.date,
    time: t.time,
    iso: t.iso
  });
  return activityLog[0];
}

/* Read-only accessors.  Nothing here returns a mutable handle to the store. */
function getActivity(filter) {
  let rows = activityLog.slice();
  if (!filter) return rows;
  if (filter.object) rows = rows.filter(r => r.object === filter.object);
  if (filter.user)   rows = rows.filter(r => r.userId === filter.user);
  if (filter.action) rows = rows.filter(r => r.action === filter.action);
  if (filter.prefix) rows = rows.filter(r => r.object.indexOf(filter.prefix) === 0);
  return rows;
}

/* ── The panel ──────────────────────────────────────────────────────────────
   Used on every transaction detail screen from M-02 onward.  A status change
   gets the accent dot; everything else is a plain event dot, so a scan down
   the rail shows where the record actually moved. */
function buildActivityPanelHTML(objectId, opts) {
  opts = opts || {};
  const rows = getActivity(objectId ? { object: objectId } : null);
  if (!rows.length) {
    return '<div class="act-panel"><div class="act-head">' + (opts.title || 'Activity Log') + '</div>' +
           '<div class="act-empty">Nothing has happened to this record yet.</div></div>';
  }
  const items = rows.map(r => {
    const moved = r.from && r.to;
    const bits = [];
    if (moved) bits.push('<span class="act-move">' + esc(r.from) + ' <span class="act-arrow">&rarr;</span> ' + esc(r.to) + '</span>');
    if (r.reason)  bits.push('<span class="act-reason">' + esc(r.reason) + '</span>');
    if (r.remarks) bits.push('<span class="act-remarks">' + esc(r.remarks) + '</span>');
    return '<li class="act-item' + (moved ? ' act-item-change' : '') + '">' +
             '<span class="act-dot"></span>' +
             '<div class="act-body">' +
               '<div class="act-row1"><span class="act-action">' + esc(r.action) + '</span>' +
                 '<span class="act-time">' + esc(r.date) + ' &middot; ' + esc(r.time) + '</span></div>' +
               (bits.length ? '<div class="act-row2">' + bits.join('') + '</div>' : '') +
               '<div class="act-row3">' + esc(r.user) + ' <span class="act-pos">' + esc(r.position) + '</span></div>' +
             '</div>' +
           '</li>';
  }).join('');
  return '<div class="act-panel">' +
           '<div class="act-head">' + (opts.title || 'Activity Log') +
             '<span class="act-count">' + rows.length + '</span></div>' +
           '<ul class="act-list">' + items + '</ul>' +
         '</div>';
}

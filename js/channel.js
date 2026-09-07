/* ==========================================================================
   CHANNEL  —  the same transaction, rendered two ways.

   WHY THIS EXISTS AT ALL.  The client runs approvals on a separate mobile-
   capable portal for two reasons they stated plainly on the recorded call:
   senior staff will not log into the ERP, and concurrent licences on the
   approval portal cut roughly 90% of seat cost against named ERP users.  So
   in the real landscape a decision physically happens in a different system
   from the work it decides on — and status has to be written back, which is
   where their 5% failure rate lives.

   FR19.5 says the replacement must behave as ONE transaction with one
   workflow and one activity log across both surfaces.  This file is what
   makes that structurally true rather than a promise: there is no mobile
   record, no mobile queue table, no mobile status.  `channel` is a rendering
   choice and nothing else.  Flip it and the same builders read the same
   stores and write through the same transaction functions.

   THE RULE THIS FILE ENFORCES.  Neither channel is ever locked out.  A stage
   has a DEFAULT channel — the device the person doing that job actually holds
   — but every stage can be viewed either way, because the fastest way to
   prove two surfaces are one system is to switch between them mid-record and
   watch nothing change.
   ========================================================================== */

/* 'web' | 'mobile'.  Never persisted per record — it is how YOU are looking,
   not a property of the deal. */
let channel = 'web';

/* Remembered per page, but ONLY when the user asked for it. A programmatic
   change — landing on a screen, following a hand-off — must not overwrite a
   preference the person expressed by clicking, and must not invent one they
   never expressed. */
const channelByPage = {};

function setChannel(ch, silent) {
  const next = (ch === 'mobile') ? 'mobile' : 'web';
  if (channel === next) return;
  channel = next;
  if (!silent) { channelByPage[page] = next; renderPage(); }
}

function toggleChannel() {
  setChannel(channel === 'web' ? 'mobile' : 'web');
}

/* ── WHICH VIEW A SCREEN OPENS IN ───────────────────────────────────────────
   THE DEFAULT IS WEB. Mobile opens by itself in exactly one situation: you
   are the checker, and there is a decision sitting in front of you right now.

   The first version of this keyed off the PAGE — any screen that hosted a
   decision stage anywhere in the journey opened on a phone. That was wrong in
   the ordinary case rather than the edge case: the Requests screen hosts the
   SCR approval, so a Planner arriving to WRITE a request was handed a phone,
   which is the one device nobody does that job on.

   The question is not "does a decision ever happen here" but "is a decision
   waiting for ME here, now". Everything else — creating, completing, entering
   logistics, reconciling — is desk work and opens on the web, where it is
   actually done. The toggle stays available on every screen either way. */
function isCheckerMoment(pg) {
  const id = activeDeal();
  if (!id) return false;
  const st = dealStage(id);
  const s = st && st.stage;
  if (!s || st.done) return false;
  return !!s.decision && s.page === pg &&
         s.actor === currentPosition() && s.channel === 'mobile';
}

function channelForPage(pg) {
  if (channelByPage[pg]) return channelByPage[pg];   /* you already chose */
  return isCheckerMoment(pg) ? 'mobile' : 'web';
}

/* ── The switch ─────────────────────────────────────────────────────────────
   A segmented control, present on every screen without exception.  It is
   deliberately NOT styled as a primary action: switching view is a way of
   looking, not a step in the process, and it must never compete with the
   hand-off button beside it in the journey bar. */
function buildChannelSwitch() {
  const opt = (id, label, icon) =>
    '<button type="button" class="chsw-opt' + (channel === id ? ' on' : '') + '"' +
    ' onclick="setChannel(\'' + id + '\')" aria-pressed="' + (channel === id) + '"' +
    ' title="View this screen as ' + label + '">' + icon +
    '<span>' + label + '</span></button>';

  const webIco = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">' +
    '<rect x="2" y="4" width="20" height="13" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/>' +
    '<line x1="12" y1="17" x2="12" y2="21"/></svg>';
  const mobIco = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">' +
    '<rect x="7" y="2" width="10" height="20" rx="2.5"/><line x1="11" y1="18.5" x2="13" y2="18.5"/></svg>';

  return '<div class="chsw" role="group" aria-label="View as web or mobile">' +
    opt('web', 'Web', webIco) + opt('mobile', 'Mobile', mobIco) + '</div>';
}

/* ── What is waiting for a person ───────────────────────────────────────────
   FR19.2.  Derived from dealStage() rather than from a queue table, for the
   same reason the stage itself is derived: a stored queue is a second source
   of truth and drifts the moment an action is taken elsewhere.

   Returns one row per deal currently standing on a stage this position owns. */
function pendingForPosition(pos) {
  const out = [];
  scrStore.forEach(r => {
    const st = dealStage(r.id);
    if (!st || !st.stage || st.done) return;
    if (st.stage.actor !== pos) return;
    out.push({ scrId: r.id, stage: st.stage, rec: st.rec || r, returned: !!st.returned });
  });
  return out;
}

function pendingCount(pos) { return pendingForPosition(pos).length; }

/* The reference the queue row shows.  Each stage acts on a different document,
   and showing the SCR number everywhere would hide which one — the whole point
   of a pending list is to name the thing you are about to open. */
function stageReference(row) {
  const r = row.rec;
  if (!r) return row.scrId;
  return r.id || row.scrId;
}

/* ── The mobile shell ───────────────────────────────────────────────────────
   A real device frame, not a narrow column.  This matters more than it looks:
   the client is being asked to believe that approvals move off their ERP onto
   a phone, and a responsive squeeze of a desktop form does not read as a
   phone — it reads as an unfinished web page. */
function buildMobileShell(inner, title) {
  const u = currentUser();
  return '<div class="mob-stage">' +
    '<div class="mob-device">' +
      '<div class="mob-notch"></div>' +
      '<div class="mob-statusbar">' +
        '<span>' + esc(mobileClock()) + '</span>' +
        '<span class="mob-sb-right">' +
          '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><rect x="1" y="14" width="3.4" height="7" rx="1"/><rect x="6.9" y="10" width="3.4" height="11" rx="1"/><rect x="12.8" y="6" width="3.4" height="15" rx="1"/><rect x="18.7" y="2" width="3.4" height="19" rx="1"/></svg>' +
          '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="17" height="10" rx="2.5"/><line x1="21.5" y1="10.5" x2="21.5" y2="13.5"/></svg>' +
        '</span>' +
      '</div>' +
      '<div class="mob-app">' +
        '<div class="mob-head">' +
          '<div class="mob-head-l">' +
            '<span class="mob-title">' + esc(title || 'Sub-Contracting') + '</span>' +
            '<span class="mob-sub">' + esc(u.name) + ' &middot; ' + esc(positionLabel(u.position)) + '</span>' +
          '</div>' +
          '<span class="mob-avatar">' + esc(initials(u.name)) + '</span>' +
        '</div>' +
        '<div class="mob-body">' + inner + '</div>' +
      '</div>' +
    '</div>' +
    '<p class="mob-caption">Same record, same status, same activity log. ' +
      'Switching view changes nothing but the surface.</p>' +
  '</div>';
}

/* The demo clock, so the frame does not show a stale hard-coded time. */
function mobileClock() {
  const d = today();
  let h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12; if (!h) h = 12;
  return h + ':' + m + ' ' + ap;
}

/* ── Pending Actions ────────────────────────────────────────────────────────
   The mobile home screen, and the one screen every actor shares. */
function buildMobilePending() {
  const rows = pendingForPosition(currentPosition());

  if (!rows.length) {
    return '<div class="mob-empty">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 6L9 17l-5-5"/></svg>' +
      '<b>Nothing waiting</b>' +
      '<span>No sub-contracting transaction is pending with ' +
        esc(positionLabel(currentPosition())) + ' right now.</span>' +
      '</div>';
  }

  const items = rows.map(row => {
    const s = row.stage;
    const ref = stageReference(row);
    const r = row.rec || {};
    const since = r.updatedOn || r.createdOn || scr(row.scrId).createdOn;
    return '<button class="mob-task" onclick="openMobileTask(\'' + attrSafe(row.scrId) + '\')">' +
      '<span class="mob-task-top">' +
        '<span class="mob-task-ref">' + esc(ref) + '</span>' +
        (row.returned ? '<span class="mob-task-flag">Returned</span>' : '') +
      '</span>' +
      '<span class="mob-task-step">' + esc(s.title) + '</span>' +
      '<span class="mob-task-meta">' +
        '<span>' + esc(s.fr) + '</span>' +
        '<span class="mob-dot">&middot;</span>' +
        '<span>' + esc(vendorNameFor(row.scrId)) + '</span>' +
      '</span>' +
      '<span class="mob-task-foot">' +
        sbStatus(currentStatusOf(row)) +
        '<span class="mob-task-since">Pending since ' + esc(fmtDate(since)) + '</span>' +
      '</span>' +
    '</button>';
  }).join('');

  return '<div class="mob-sec-head"><span>Pending actions</span>' +
         '<span class="mob-count">' + rows.length + '</span></div>' +
         '<div class="mob-tasks">' + items + '</div>';
}

/* The status shown on a queue row is the status of the document that stage
   acts on, not the deal's — a Security user waiting on a challan needs to see
   the challan's status, not "Approved" from the SCR three stages back. */
function currentStatusOf(row) {
  const r = row.rec;
  return (r && r.status) ? r.status : scr(row.scrId).status;
}

function vendorNameFor(scrId) {
  const r = scr(scrId);
  if (!r) return '';
  const v = typeof vendor === 'function' ? vendor(r.vendorId) : null;
  return v ? v.name : (r.vendorId || '');
}

/* Opening a task from the queue tracks that deal and lands on the stage's own
   screen, still in mobile.  It does NOT switch user — you are already the
   right person, or the row would not be in your queue. */
function openMobileTask(scrId) {
  trackDeal(scrId);
  const st = dealStage(scrId);
  if (!st || !st.stage) return;
  lastOpenedRecord = st.rec && st.rec.id ? st.rec.id : scrId;
  if (can(st.stage.page, 'v')) {
    page = st.stage.page; activeSidebarItem = page; expandOwningDropdown(page);
  }
  renderPage();
  syncUrl();
}

/* ── Reasons ────────────────────────────────────────────────────────────────
   THERE IS DELIBERATELY NO MOBILE REASON PICKER.

   Every Return, Reject and exception in the journey needs a reason from the
   Reason Code Master, and openReasonModal() in ui.js already owns that: it
   reads reasonMaster, and it enforces "Other always forces remarks" in one
   place so the rule cannot be forgotten on the sixteenth call site.

   Writing a second picker for mobile would put that rule in two files, which
   is exactly the failure this whole build is arguing against — and it would
   be a particularly bad joke to demonstrate "one workflow across two
   channels" using a validation rule implemented twice.

   So mobile calls the same function.  The bottom-sheet presentation is a CSS
   concern: `.mob-on .modal-back` restyles the very same markup as a sheet
   that rises from the bottom of the device frame.  One rule, one dialog, two
   appearances. */
function askReason(groupKey, actionLabel, onConfirm, onCancel) {
  openReasonModal(groupKey, actionLabel, onConfirm, onCancel);
}

/* ── Sticky action bar ──────────────────────────────────────────────────────
   Actions live at the thumb, not at the end of a scroll.  Built from a plain
   list so every stage declares its own verbs without a bespoke component:
     [{ label, tone, fn, blocked }] */
function buildMobileActions(actions) {
  if (!actions || !actions.length) return '';
  const btns = actions.map(a => {
    const cls = a.tone === 'primary' ? 'btn-primary'
              : a.tone === 'danger'  ? 'btn-outline mob-act-danger' : 'btn-outline';
    if (a.blocked) {
      return '<button class="' + cls + '" disabled title="' + attrSafe(a.blocked) + '">' +
             esc(a.label) + '</button>';
    }
    return '<button class="' + cls + '" onclick="' + attrSafe(a.fn) + '">' + esc(a.label) + '</button>';
  }).join('');
  return '<div class="mob-actbar">' + btns + '</div>';
}

/* A blocked action explains itself in place.  Carried over from the ADT rule
   that a mouse-only tooltip is no explanation — on a phone there is no hover
   at all, so the reason is rendered as text above the bar. */
function buildMobileBlockNote(text) {
  if (!text) return '';
  return '<div class="mob-block"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.9"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="13"/>' +
    '<circle cx="12" cy="16.4" r=".6" fill="currentColor"/></svg><span>' + esc(text) + '</span></div>';
}

/* ── Read-only review ───────────────────────────────────────────────────────
   FR19.3: before acting, the user reviews the transaction read-only.  Sections
   collapse because an approver on a phone wants the headline first and the
   forty-field detail only if something looks wrong.

   rows: [{ label, value }] — value may already be markup (a status pill). */
function mobSection(title, rows, open) {
  const body = rows.filter(r => r && r.value !== '' && r.value != null).map(r =>
    '<div class="mob-fld"><span>' + esc(r.label) + '</span><b>' + r.value + '</b></div>').join('');
  if (!body) return '';
  return '<details class="mob-sec"' + (open ? ' open' : '') + '>' +
    '<summary>' + esc(title) + '</summary>' +
    '<div class="mob-flds">' + body + '</div></details>';
}

/* The banner an approver sees when the record in front of them was already
   sent back once.  FR19.3 lists previous Return/Reject reason and remarks as
   required review information, and it is the first thing that matters. */
function mobReturnBanner(rec) {
  if (!rec || !rec.returnReason) return '';
  return '<div class="mob-returned">' +
    '<b>Previously returned</b>' +
    '<span class="mob-ret-reason">' + esc(rec.returnReason) + '</span>' +
    (rec.returnRemarks ? '<span class="mob-ret-rem">' + esc(rec.returnRemarks) + '</span>' : '') +
  '</div>';
}

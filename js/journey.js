/* ==========================================================================
   STAGES  —  the eighteen-stage spine.

   WHAT THIS FILE IS FOR.  Every other module in this build is organised by
   SCREEN: a page shows requests, another shows challans, and the user finds
   their own way between them.  That is the right shape for people who work
   here every day and already know the process.

   It is the wrong shape for a demonstration.  The thing the client needs to
   see is not eighteen screens — it is ONE RECORD travelling through fourteen
   pairs of hands across four systems that are today unconnected.  So this file
   adds a second, parallel way to read the same state: not "which page am I
   on", but "where has this deal got to, who is holding it, and on which
   device are they holding it".

   NOTHING HERE OWNS STATE.  The stage of a deal is DERIVED, every time, from
   the transaction records themselves — scrStore, poStore, shipmentStore and
   the rest.  There is deliberately no `deal.stage = 7` anywhere, because a
   stored stage is a second source of truth that drifts the moment any action
   is taken through a screen that forgot to update it.  dealStage() reads the
   records and works it out, so the journey view can never disagree with the
   data underneath it.

   THE ORDER MATTERS AND IS NOT THE FR ORDER.  The FRD is numbered FR1..FR20
   by document convenience; the material moves in a different sequence, and
   two stages (logistics, and the conditional skip around it) are not in the
   numbering at all.  This array is the material's order.
   ========================================================================== */

/* ── The chain ──────────────────────────────────────────────────────────────
   One entry per stage.  Fields:

     n         display number.  '08b' is a string on purpose — logistics is a
               conditional detour off stage 08, not a nineteenth stage, and
               numbering it 09 would push every later stage out of step with
               the plan document the client is reading alongside this.
     actor     POSITION key from rbac.js.  'system' where no human acts.
     channel   the DEFAULT channel.  Never a restriction — every stage can be
               viewed either way; this only decides what opens first.
     page      which existing screen renders it on web.
     from/to   the status transition, for the hand-off card.
     inv       inventory movement, or null when nothing moves.  Most stages
               move nothing, and saying so is the point: the client's
               complaint is that they cannot tell when stock actually moves. */
const STAGES = [
  { n: '01', id: 'scr-create', fr: 'FR1', act: 'Open the request', actor: 'planner', channel: 'web', page: 'scr',
    title: 'Create Sub-Contracting Request',
    lede: 'The deal. Everything downstream hangs off this record.',
    from: '—', to: 'Sent for Approval', produces: 'SCR No.', inv: null },

  { n: '02', id: 'scr-approve', fr: 'FR2', act: 'Review and decide', actor: 'pmg-approver', channel: 'mobile', page: 'scr',
    title: 'Approve, Return or Reject the SCR',
    lede: 'First hand-off, first mobile decision. The creator cannot approve their own request.',
    from: 'Sent for Approval', to: 'Approved', produces: null, inv: null, decision: true },

  { n: '03', id: 'bom', fr: 'FR3', act: 'Open the request', actor: 'system', channel: 'web', page: 'scr',
    title: 'Product / WIP and BOM processing',
    lede: 'No human acts, but the BOM ratio created here drives the reconciliation fifteen stages later.',
    from: 'Approved', to: 'Approved', produces: 'Product Code · BOM Reference', inv: null },

  /* A conditional detour off 04, like logistics is off 08 — it exists only
     for a zero-value order. The build enforces it from the RBAC matrix and
     US18; FR4/FR5 do not describe it, which is flagged as an open question
     against the FRD. Numbered 04a so the FR-numbered stages stay aligned. */
  { n: '04a', id: 'po-nonbillable', fr: 'RBAC', act: 'Confirm non-billable', actor: 'finance', channel: 'mobile', page: 'orders',
    title: 'Finance confirms the non-billable request',
    lede: 'A zero-value order cannot be raised until Finance accepts the reason for not charging.',
    from: 'Draft', to: 'Draft', produces: null, inv: null, decision: true,
    conditional: 'nonBillable' },

  { n: '04', id: 'po-complete', fr: 'FR4', act: 'Complete the order', actor: 'buyer', channel: 'web', page: 'orders',
    title: 'Complete the Sub-Contracting PO',
    lede: 'The order. Commercial detail only — the Buyer cannot touch the approved SCR.',
    from: 'Draft', to: 'Created', produces: 'PO No.', inv: null },

  { n: '05', id: 'po-approve', fr: 'FR5', act: 'Review and decide', actor: 'pmg-approver', channel: 'mobile', page: 'orders',
    title: 'Approve or Return the Commercial PO',
    lede: 'Billable POs only. A zero-value PO was system-approved at stage 04 and never arrives here.',
    from: 'Created', to: 'Approved', produces: null, inv: null, decision: true },

  { n: '06', id: 'shipment', fr: 'FR6', act: 'Create the shipment', actor: 'planner', channel: 'web', page: 'shipments',
    title: 'Create Shipment and reserve material',
    lede: 'First inventory event. Stock is committed logically — nothing physically moves.',
    from: '—', to: 'Created', produces: 'Shipment No.', inv: 'Main → Reserved' },

  { n: '07', id: 'outbound-key', fr: 'FR7', act: 'Submit the shipment', actor: 'planner', channel: 'web', page: 'shipments',
    title: 'Submit Shipment — Outbound Key and Transfer Order',
    lede: 'Two documents at once: one says what to pick, the other records the stock movement.',
    from: 'Created', to: 'Created', produces: 'Outbound Key No. · Transfer Order No.', inv: null },

  { n: '08', id: 'goods-issue', fr: 'FR8', act: 'Pick and release', actor: 'stores', channel: 'mobile', page: 'outbound',
    title: 'Stores Outbound / Goods Issue',
    lede: 'First physical movement. Stores picks against the Outbound Key; material lands in Staging.',
    from: 'Created', to: 'Freezed Outbound Release', produces: null,
    inv: 'Reserved → Staging', decision: true },

  { n: '08b', id: 'logistics', fr: 'FR7.5', act: 'Enter logistics', actor: 'logistics', channel: 'web', page: 'logistics',
    title: 'Logistics completion',
    lede: 'Conditional. Runs only when Logistics Required = Yes, and only after goods issue.',
    from: 'Freezed Outbound Release', to: 'Freezed Outbound Release', produces: null,
    inv: null, conditional: 'logisticsRequired' },

  { n: '09', id: 'dnote', fr: 'FR9', act: 'Review the note', actor: 'dnote-approver', channel: 'mobile', page: 'delivery-notes',
    title: 'Delivery Note — generate and approve',
    lede: "L&T's own gate document: who sent it, where it goes, and whether it is coming back.",
    from: 'Generated', to: 'Approved', produces: 'Delivery Note No.', inv: null, decision: true },

  { n: '10', id: 'challan', fr: 'FR10', act: 'Generate the challan', actor: 'finance', channel: 'mobile', page: 'challans',
    title: 'Challan generation',
    lede: 'The statutory document. Finance verifies tax codes and per-unit values.',
    from: 'Freezed Outbound Release', to: 'Challan Generated', produces: 'Challan No.',
    inv: null, decision: true },

  { n: '11', id: 'gate-out', fr: 'FR11', act: 'Verify and clear', actor: 'security', channel: 'mobile', page: 'gate',
    title: 'Security Gate Outward',
    lede: 'The material physically leaves. Vehicle and package differences are captured with a reason.',
    from: 'Created', to: 'Gate Cleared', produces: 'Gate Pass No.', inv: null, decision: true },

  { n: '12', id: 'confirm-shipment', fr: 'FR12', act: 'Confirm the shipment', actor: 'planner', channel: 'mobile', page: 'shipments',
    title: 'Planner confirms the Shipment',
    lede: 'The system catches up with reality. This click — not the gate — moves stock out of Staging.',
    from: 'Gate Cleared', to: 'Gate Cleared', produces: null,
    inv: 'Staging → At Vendor', decision: true },

  { n: '13', id: 'asn', fr: 'FR13', act: 'Raise the ASN', actor: 'vendor', channel: 'web', page: 'inward',
    title: 'Vendor raises the ASN',
    lede: 'The journey crosses the company boundary. The vendor sees only their own approved POs.',
    from: '—', to: 'Created', produces: 'ASN No.', inv: null },

  { n: '14', id: 'qc', fr: 'FR14', act: 'Clear or return', actor: 'finance', channel: 'mobile', page: 'inward',
    title: 'QC clears or returns the ASN',
    lede: 'The gate cannot open until this passes.',
    from: 'Created', to: 'QC Cleared', produces: null, inv: null, decision: true },

  { n: '15', id: 'gate-in', fr: 'FR15', act: 'Record gate entry', actor: 'security', channel: 'mobile', page: 'gate',
    title: 'Security Gate Inward',
    lede: 'Material comes back through the gate. Security searches by ASN number and confirms.',
    from: 'QC Cleared', to: 'QC Cleared', produces: 'Gate Entry Date-Time', inv: null, decision: true },

  { n: '16', id: 'imr', fr: 'FR16', act: 'Receive the material', actor: 'stores', channel: 'mobile', page: 'inward',
    title: 'Stores receipt — the IMR',
    lede: 'The receivable item enters inventory, and a newly created product becomes Active.',
    from: 'Created', to: 'Confirmed', produces: 'IMR No.',
    inv: 'At Vendor → Returned to Store', decision: true },

  { n: '17', id: 'reconcile', fr: 'FR17', act: 'Reconcile', actor: 'finance', channel: 'web', page: 'reconciliation',
    title: 'Reconciliation and Full Receipt',
    lede: 'The stage that fixes their real problem — issue material consumed automatically at BOM ratio.',
    from: '—', to: 'Full Receipt Confirmed', produces: null,
    inv: 'Issue items consumed', decision: true },

  { n: '18', id: 'close', fr: 'FR18', act: 'Close the transaction', actor: 'finance', channel: 'mobile', page: 'reconciliation',
    title: 'Final closure',
    lede: 'Four records close together. Three deliberately do not.',
    from: 'Approved', to: 'Closed', produces: null, inv: null, decision: true }
];

function stageAt(id)   { return STAGES.find(s => s.id === id); }
function stageIndex(id){ return STAGES.findIndex(s => s.id === id); }

/* ── The coarse bar ─────────────────────────────────────────────────────────
   ui.js draws an eight-step progress ladder on the deal screens. That is the
   same journey at lower resolution, so it MAPS onto these stages rather than
   working the position out for itself — journeyIndex() used to do its own
   derivation, and two answers to "where is this deal" is exactly the drift
   the derived-not-stored rule exists to prevent.

   Adding a stage above means adding one line here, and both bars move. */
const STAGE_BAND = {
  'scr-create': 0, 'scr-approve': 0, 'bom': 0,          /* Request   */
  'po-nonbillable': 1, 'po-complete': 1, 'po-approve': 1, /* Order    */
  'shipment': 2, 'outbound-key': 2,                      /* Shipment  */
  'goods-issue': 3, 'logistics': 3,                      /* Outbound  */
  'dnote': 4, 'challan': 4,                              /* Documents */
  'gate-out': 5, 'confirm-shipment': 5,                  /* Gate      */
  'asn': 6, 'qc': 6, 'gate-in': 6, 'imr': 6, 'reconcile': 6,  /* Inward */
  'close': 7                                             /* Closed    */
};

function dealBand(scrId) {
  const st = dealStage(scrId);
  if (!st || !st.stage) return 0;
  if (st.terminal === 'Closed') return 7;
  const b = STAGE_BAND[st.stage.id];
  return b == null ? 0 : b;
}

/* The twelve stages the plan counts as mobile decisions.  Derived rather than
   listed again, so the two can never drift apart. */
function decisionStages() { return STAGES.filter(s => s.decision); }

/* ── Who stands in a stage ──────────────────────────────────────────────────
   One user per position, which is how the demo data is built.  Returns the id
   so the caller can hand it straight to setCurrentUser(). */
function userForPosition(pos) {
  return Object.keys(USERS).find(id => USERS[id].position === pos) || null;
}

function stageActorName(s) {
  if (!s || s.actor === 'system') return 'System';
  const uid = userForPosition(s.actor);
  return uid ? USERS[uid].name : positionLabel(s.actor);
}

/* ── Where a deal has got to ────────────────────────────────────────────────
   DERIVED, NEVER STORED.  Read top to bottom: the first test that matches is
   the stage the deal is standing in.  Terminal states return their own stage
   with `done` set so the caller can stop offering a next step.

   The order of these tests is the process order, so adding a stage means
   inserting a test in the right place rather than rewriting a switch. */
function dealStage(scrId) {
  const r = scr(scrId);
  if (!r) return null;

  if (r.status === 'Rejected') return { stage: stageAt('scr-approve'), done: true, terminal: 'Rejected' };
  if (r.status === 'Closed')   return { stage: stageAt('close'), done: true, terminal: 'Closed' };

  /* EVERY branch carries `rec` — the document the actor must actually open.
     It is not always the deal: at stage 04 the deal is SUB-000327 but the
     thing to work on is PO-SUB-004113, and a bar that named only the deal
     left the user on a listing with no idea which row was theirs. */
  if (r.status === 'Created' || r.status === 'Returned' || r.status === 'Modified')
    return { stage: stageAt('scr-create'), rec: r, returned: r.status === 'Returned' };
  if (r.status === 'Sent for Approval')
    return { stage: stageAt('scr-approve'), rec: r };

  /* Approved from here down. */
  const p = poForScr(scrId);
  if (!p) return { stage: stageAt('bom'), rec: r };
  /* A NON-BILLABLE ORDER IS WITH FINANCE FIRST, NOT THE BUYER.
     A zero-value order cannot be generated until Finance confirms the
     non-billable reason, so naming the Buyer as the holder puts "Waiting on
     you" in the bar while the panel directly beneath it correctly says the
     record is with F&A — two answers to "who has this" on one screen, which
     is the exact confusion the bar exists to remove. */
  if (p.status === 'Draft' && p.nonBillableConfirmed === false)
    return { stage: stageAt('po-nonbillable'), rec: p };
  if (p.status === 'Draft')   return { stage: stageAt('po-complete'), rec: p };
  if (p.status === 'Created') return { stage: stageAt('po-approve'), rec: p };

  /* PO approved — material can move. */
  const ships = shipmentsForScr(scrId);
  const live = ships.filter(s => s.status !== 'Cancelled');
  if (!live.length) return { stage: stageAt('shipment'), rec: r };

  /* The prototype journey carries one live shipment; if a later phase adds
     the part-type split this picks the earliest unfinished one, which is the
     one the process is actually waiting on. */
  const sh = live.find(s => s.status !== 'Closed') || live[live.length - 1];

  if (!sh.outboundKeyNo) return { stage: stageAt('outbound-key'), rec: sh };
  if (sh.status === 'Created') return { stage: stageAt('goods-issue'), rec: sh };

  if (sh.logisticsRequired && !sh.logisticsComplete)
    return { stage: stageAt('logistics'), rec: sh };

  const dn = dnoteForShipment(sh.id);
  if (!dn || dn.status === 'Generated' || dn.status === 'Returned')
    return { stage: stageAt('dnote'), rec: dn || sh };

  const ch = challanForShipment(sh.id);
  if (!ch) return { stage: stageAt('challan'), rec: sh };
  if (ch.status === 'Created') return { stage: stageAt('gate-out'), rec: ch };

  /* Gate cleared.  The stock is still sitting in Staging until the planner
     says so — which is the whole point of stage 12. */
  if (!sh.confirmedAt) return { stage: stageAt('confirm-shipment'), rec: sh };

  /* The ASN store calls a fresh notice 'Raised' where the FRD calls it
     'Created'. The store's word wins — renaming a status that eight screens
     already read would be a large change to make a comment match. */
  const asns = asnsForChallan(ch.id);
  const asn = asns[asns.length - 1];
  if (!asn || asn.status === 'Returned') return { stage: stageAt('asn'), rec: asn || ch };
  if (asn.status === 'Raised') return { stage: stageAt('qc'), rec: asn };
  if (!asn.gateEntryAt)        return { stage: stageAt('gate-in'), rec: asn };

  const imrs = imrsForChallan(ch.id);
  const done = imrs.filter(i => i.status === 'Confirmed');
  if (!done.length) return { stage: stageAt('imr'), rec: asn };

  if (!r.fullReceipt) return { stage: stageAt('reconcile'), rec: r };
  return { stage: stageAt('close'), rec: r };
}

/* The deal the journey bar is currently tracking.  One at a time: a demo that
   tries to follow several at once stops being a story. */
let trackedDeal = null;

function trackDeal(id) { trackedDeal = id; }

/* WHICH DEAL THE BAR FOLLOWS, when nobody has picked one.

   Not simply "the newest open deal". If the signed-in person has something
   waiting on them, that is the deal they care about, and the bar has to agree
   with the queue sitting underneath it — an approver looking at SUB-000320 in
   their task list while the bar narrates SUB-000326 three stages ahead makes
   the demo read as two unrelated screens, which is the opposite of the point
   this build is making. */
function activeDeal() {
  if (trackedDeal && scr(trackedDeal)) return trackedDeal;

  const mine = scrStore.filter(r => {
    const st = dealStage(r.id);
    return st && st.stage && !st.done && st.stage.actor === currentPosition();
  });
  if (mine.length) return mine[0].id;

  const open = scrStore.filter(r => r.status !== 'Closed' && r.status !== 'Rejected');
  const pick = open.length ? open[open.length - 1] : scrStore[scrStore.length - 1];
  return pick ? pick.id : null;
}

/* ── Listing order ──────────────────────────────────────────────────────────
   NEWEST FIRST, AND THE DEAL YOU ARE FOLLOWING ABOVE THAT.

   The stores are in creation order, so every listing put the oldest record at
   the top and anything just raised at the BOTTOM. That made the most common
   question on these screens — "where is the one I was working on" — the
   hardest one to answer, and it got harder with every record added.

   Two rules, in order:
     1. reverse: the newest record is the one most likely to be wanted
     2. lift the row belonging to the tracked deal, wherever it sits

   The second matters because "most recent" and "what I am working on" stop
   being the same thing the moment you return to an older deal. Opening
   anything tracks it, so it rises and stays found.

   Shared rather than written per screen: an order and a shipment belong to a
   deal through `scrId`, a request IS the deal through `id`, and both should
   surface for the same reason. */
function orderForJourney(list) {
  const out = list.slice().reverse();
  const cur = activeDeal();
  if (!cur) return out;
  const i = out.findIndex(r => r.id === cur || r.scrId === cur);
  if (i > 0) out.unshift(out.splice(i, 1)[0]);
  return out;
}

function isCurrentDealRow(r) {
  const cur = activeDeal();
  return !!cur && !!r && (r.id === cur || r.scrId === cur);
}

/* Sitting first is a position, not a label — after one scroll nothing
   distinguishes the pinned row from the one above it. */
function nowBadge(r) {
  return isCurrentDealRow(r)
    ? '<span class="row-now" title="Part of the request you are working on">Working on</span>' : '';
}

/* ── The hand-off ───────────────────────────────────────────────────────────
   Two things happen when a transaction routes, and they must stay separate.
   The CHANNEL SWITCH changes how you are looking at a record; this changes WHO
   YOU ARE.  Conflating them is the single easiest way to make a demo
   incomprehensible, so the hand-off always announces itself. */

let handoffPending = null;   /* stage id awaiting acknowledgement, or null */

function isMyStage(s) {
  return !!s && s.actor !== 'system' && s.actor === currentPosition();
}

/* Switch to the person the deal is waiting on, land on their screen, and open
   the channel they actually work in.  The interstitial is shown first unless
   the caller skips it — a guided run wants the pause, a power user clicking
   the bar directly does not. */
function switchToStageActor(skipCard) {
  const st = dealStage(activeDeal());
  if (!st || !st.stage) return;
  const s = st.stage;
  if (s.actor === 'system') { toast('This stage runs without a human actor.', 'ok'); return; }

  const uid = userForPosition(s.actor);
  if (!uid) { toast('No demo user stands in for ' + positionLabel(s.actor) + '.', 'bad'); return; }

  if (!skipCard) { handoffPending = s.id; renderPage(); return; }

  handoffPending = null;
  currentUserId = uid;
  lastSidebarSig = null;
  if (can(s.page, 'v')) { page = s.page; activeSidebarItem = s.page; expandOwningDropdown(page); }
  else page = firstAllowedPage();
  /* Asked AFTER the user and page have changed, so it answers "is a decision
     waiting for the person I now am, on the screen I have landed on" — which
     is the only condition that opens a phone. */
  channel = channelForPage(page);
  renderPage();
  syncUrl();
}

function dismissHandoff() { handoffPending = null; renderPage(); }

/* The card shown between two actors.  It names the person, the device and what
   just landed in their queue — the three things somebody watching a fourteen
   hand-off journey for the first time otherwise has to be told out loud. */
function buildHandoffCard() {
  const s = stageAt(handoffPending);
  if (!s) return '';
  const uid = userForPosition(s.actor);
  const u = uid ? USERS[uid] : null;
  const t = u && u.team ? TEAMS[u.team] : null;

  return '<div class="ho-scrim" onclick="dismissHandoff()"></div>' +
    '<div class="ho-card" role="dialog" aria-modal="true" aria-label="Hand-off">' +
      '<div class="ho-eyebrow">Stage ' + esc(s.n) + ' &middot; ' + esc(s.fr) + '</div>' +
      '<div class="ho-who">' +
        '<span class="ho-avatar">' + esc(u ? initials(u.name) : '?') + '</span>' +
        '<span class="ho-name">' + esc(u ? u.name : positionLabel(s.actor)) + '</span>' +
        '<span class="ho-pos">' + esc(positionLabel(s.actor)) +
          (t ? ' &middot; ' + esc(t.name) : '') + '</span>' +
      '</div>' +
      '<h3 class="ho-title">' + esc(s.title) + '</h3>' +
      '<p class="ho-lede">' + esc(s.lede) + '</p>' +
      '<div class="ho-facts">' +
        '<div><span>Arrives on</span><b>' + (s.channel === 'mobile' ? 'Mobile app' : 'Web workspace') + '</b></div>' +
        '<div><span>Status</span><b>' + esc(s.from) + ' &rarr; ' + esc(s.to) + '</b></div>' +
        (s.inv ? '<div><span>Inventory</span><b>' + esc(s.inv) + '</b></div>'
               : '<div><span>Inventory</span><b class="ho-none">No movement</b></div>') +
        (s.produces ? '<div><span>Produces</span><b>' + esc(s.produces) + '</b></div>' : '') +
      '</div>' +
      '<div class="ho-actions">' +
        '<button class="btn-outline" onclick="dismissHandoff()">Stay where I am</button>' +
        '<button class="btn-primary" onclick="switchToStageActor(true)">Continue as ' +
          esc(u ? u.name.split(' ')[0] : positionLabel(s.actor)) + '</button>' +
      '</div>' +
    '</div>';
}

/* ── The persistent bar ─────────────────────────────────────────────────────
   Sits above the page content on every screen.  It answers the three questions
   a person watching a demo asks continuously and cannot otherwise see:
   which deal, how far along, and who is holding it now. */
function buildJourneyBar() {
  const id = activeDeal();
  if (!id) return '';
  const st = dealStage(id);
  if (!st || !st.stage) return '';
  const s = st.stage;
  /* ONE PROGRESS READING, SHARED WITH THE STEPPER.
     This used to be "stage N of STAGES.length" — which, once 04a and 08b were
     added, read "Stage 07 of 20" against labels that stop at 18, beside a
     stepper saying "3 of 8". Three answers to "how far along is this", none
     reconcilable. The bar now measures in the same eight bands the stepper
     draws, so the two can only ever agree. */
  const band = dealBand(id);
  const pct = Math.round(((band + 1) / JOURNEY.length) * 100);
  const mine = isMyStage(s);

  let right;
  if (st.terminal) {
    right = '<span class="jb-terminal jb-' + statusClass(st.terminal) + '">' + esc(st.terminal) + '</span>';
  } else if (s.actor === 'system') {
    right = '<span class="jb-pending">Runs automatically</span>';
  } else if (mine) {
    /* THE BUTTON GOES TO THE RECORD, NOT THE PAGE.
       It used to read "Open Sub-Contracting Orders" — which, when you were
       already standing on that listing, did nothing at all and left you to
       work out which of eight rows was yours. It now names the document and
       the verb, and opens it. */
    const rec = stageRecordId(st);
    const label = (rec && rec !== id) ? s.act + ' ' + rec : s.act;
    right = '<span class="jb-pending jb-mine">Waiting on you</span>' +
            '<button class="btn-primary btn-sm" onclick="goToStageRecord()">' +
            esc(label) + '</button>';
  } else {
    /* ONE HAND-OFF BUTTON PER SCREEN.
       The detail screens carry their own "what happens next" panel, which
       already names the holder and offers to continue as them — in context,
       with the reason. When that panel is on screen for this same record the
       bar drops its button and keeps only the status, rather than stating the
       same fact twice in two weights with two buttons.

       The codebase already made this call once: m02-scr.js removed a third
       notice saying the same thing. Adding the bar reintroduced the problem
       and this is the same fix applied to the newer component. */
    /* When the detail card below is answering for this same record, the bar
       stays out of it ENTIRELY — pill included, not just the button. The two
       are driven by different engines (dealStage here, nextStepFor in ui.js)
       and can word the same situation differently; showing both invites them
       to contradict each other 60px apart. The card is the one with the
       reason and the context, so it wins on its own screen. */
    const dup = lastOpenedRecord && lastOpenedRecord === stageRecordId(st);
    right = dup ? ''
      : '<span class="jb-pending">Pending with <b>' + esc(stageActorName(s)) + '</b>' +
        (s.channel === 'mobile' ? ' <span class="jb-dev">on mobile</span>' : '') + '</span>' +
        '<button class="btn-primary btn-sm" onclick="switchToStageActor()">Switch to this actor</button>';
  }

  return '<div class="jbar' + (mine ? ' jbar-mine' : '') + '">' +
    '<div class="jb-left">' +
      '<button class="jb-deal" onclick="openRecord(\'' + attrSafe(id) + '\')" title="Open this request">' +
        esc(id) + '</button>' +
      '<span class="jb-stage"><b>' + esc(s.n) + '</b> ' + esc(s.title) + '</span>' +
    '</div>' +
    '<div class="jb-track" title="' + attrSafe(JOURNEY[band] + ' — step ' + (band + 1) + ' of ' + JOURNEY.length) + '">' +
      '<span class="jb-fill" style="width:' + pct + '%"></span></div>' +
    '<div class="jb-right">' + right + '</div>' +
  '</div>';
}

/* The id of the document this stage acts on — the PO at stage 04, the challan
   at stage 11, the shipment at stage 08. Falls back to the deal when the stage
   acts on the request itself. */
function stageRecordId(st) {
  if (!st) return null;
  return (st.rec && st.rec.id) ? st.rec.id : activeDeal();
}

/* Open the thing that needs work, not the screen it lives on. openRecord
   already routes an id to its owning module and selects it, so this lands on
   the record's own detail view with its actions in reach. */
function goToStageRecord() {
  const st = dealStage(activeDeal());
  if (!st || !st.stage) return;
  const rec = stageRecordId(st);
  if (rec && isRoutable(rec)) { openRecord(rec); return; }
  /* No routable document yet — the stage is about creating one, so the
     listing with its Create action is the right destination. */
  const s = st.stage;
  if (can(s.page, 'v')) navigatePage(s.page);
  else toast('Your team cannot open ' + getPageTitle(s.page) + '.', 'bad');
}

/* ── Guided run ─────────────────────────────────────────────────────────────
   Free mode is the default and stays available: during a live demo somebody
   always asks a question three stages ahead, and a walkthrough that cannot
   jump is worse than no walkthrough.  Guided mode only adds a Next button that
   performs the hand-off for you. */
let guidedMode = false;

function toggleGuided() {
  guidedMode = !guidedMode;
  toast(guidedMode ? 'Guided run on — follow the deal stage by stage.'
                   : 'Guided run off — switch actors freely.', 'ok');
  renderPage();
}

/* Labelled "Walkthrough", not "Free / Guided". A chip reading **Free** next to
   the product name reads as a pricing tier to anyone seeing this for the first
   time — which, in a client demo, is everyone in the room. */
function buildGuidedControl() {
  return '<button class="jb-guide' + (guidedMode ? ' on' : '') + '" onclick="toggleGuided()" ' +
    'title="Walk the deal stage by stage" aria-pressed="' + (guidedMode ? 'true' : 'false') + '">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">' +
    '<polyline points="9 18 15 12 9 6"/></svg>' +
    '<span>Walkthrough ' + (guidedMode ? 'on' : 'off') + '</span></button>';
}

/* ==========================================================================
   RENDERER  —  page dispatch, and the surgical repaint.

   THE PROBLEM THIS SOLVES (inherited from ADT_Revamp, and worth restating
   because it is the reason the whole app is built out of pure builders).
   Everything repaints by calling renderPage().  Writing that straight into
   #page-content is right when you NAVIGATE — a new page should arrive.  It is
   wrong for everything else.  A filter, a Clear, a page-number click, a status
   toggle: each changes a handful of rows, and each would otherwise throw the
   whole page away.  The costs are all visible — the entrance animation
   replays so a filter feels like a page load, the scroll jumps to the top, an
   open detail panel is rebuilt under the pointer, and a half-typed input loses
   what was in it.

   WHAT HAPPENS INSTEAD.  The page is still BUILT the same way; the builders
   are pure functions of state, which is what makes this safe to do globally
   rather than page by page.  The new markup is rendered into a DETACHED node
   and then PATCHED onto the live DOM: patchDom walks both trees together and
   touches only what differs.  A subtree whose markup is unchanged is never
   visited, so everything that did not change keeps its identity — its scroll
   offset, its focus, its listeners.

   WHY isEqualNode IS THE WHOLE TRICK.  It compares tag, attributes and the
   entire subtree, and it ignores live PROPERTIES.  So an <input> the user has
   typed into still equals its freshly built twin — the typed text is a
   property, not an attribute — and is left alone.
   ========================================================================== */

/* The page whose markup is currently on screen.  Null until first paint. */
let renderedPage = null;

/* Pages whose render does more than write markup cannot be built into a
   detached node, because their init runs against the document.  None yet;
   the list exists so later modules have somewhere honest to declare it. */
const NO_PATCH_PAGES = [];

function canPatchPage(pg) {
  if (renderedPage !== pg) return false;          /* navigation, not a repaint */
  return NO_PATCH_PAGES.indexOf(pg) === -1;
}

/* Attributes only, never properties: what the user has typed, checked, opened
   or scrolled lives in a property and none of it is ours to overwrite. */
function syncAttrs(live, next) {
  const nx = next.attributes;
  for (let i = 0; i < nx.length; i++) {
    const a = nx[i];
    if (live.getAttribute(a.name) !== a.value) live.setAttribute(a.name, a.value);
  }
  const lv = live.attributes;
  for (let i = lv.length - 1; i >= 0; i--) {
    const a = lv[i];
    if (!next.hasAttribute(a.name)) live.removeAttribute(a.name);
  }
}

/* A control that HAS been re-rendered needs its property put back in step with
   its attribute, or a filter would keep showing the old choice while the
   markup says otherwise.  Only ever reached for controls that actually differ. */
function syncFormState(live, next) {
  if (live.tagName === 'INPUT') {
    if (next.hasAttribute('value') && live.value !== next.getAttribute('value'))
      live.value = next.getAttribute('value');
    live.checked = next.hasAttribute('checked');
  } else if (live.tagName === 'OPTION') {
    live.selected = next.hasAttribute('selected');
  } else if (live.tagName === 'TEXTAREA') {
    if (next.textContent !== live.defaultValue) live.defaultValue = next.textContent;
  }
}

/* Children the BUILDERS never emit are invisible to the differ — anything
   planted into the live DOM by a behaviour rather than a builder carries
   data-patch-keep and is skipped, so positional matching stays lined up. */
function patchVisible(nodes) {
  return nodes.filter(n => !(n.nodeType === 1 && n.hasAttribute('data-patch-keep')));
}

/* Children are matched BY POSITION: every list comes out of the same builder
   in the same order every time, so position is a reliable key and a keyed diff
   would buy nothing for the extra surface.  Nodes are MOVED out of the new
   tree rather than cloned — it is detached and discarded straight after, and
   moving keeps any handler the builder attached as a property. */
function patchDom(live, next) {
  if (live.isEqualNode(next)) return;             /* identical subtree — do not descend */
  if (live.nodeType !== next.nodeType || live.nodeName !== next.nodeName) {
    live.replaceWith(next);
    return;
  }
  if (live.nodeType !== 1) {                      /* text, comment */
    if (live.nodeValue !== next.nodeValue) live.nodeValue = next.nodeValue;
    return;
  }
  syncAttrs(live, next);
  syncFormState(live, next);
  const a = patchVisible(Array.prototype.slice.call(live.childNodes));
  const b = Array.prototype.slice.call(next.childNodes);
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) patchDom(a[i], b[i]);
  for (let i = n; i < a.length; i++) live.removeChild(a[i]);
  for (let i = n; i < b.length; i++) live.appendChild(b[i]);
}

/* The children only.  The staging <div> is a carrier, not part of the page:
   syncing ITS attributes onto #page-content would strip the id off the element
   the whole app looks itself up by. */
function patchChildren(live, next) {
  const x = patchVisible(Array.prototype.slice.call(live.childNodes));
  const y = Array.prototype.slice.call(next.childNodes);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) patchDom(x[i], y[i]);
  for (let i = n; i < x.length; i++) live.removeChild(x[i]);
  for (let i = n; i < y.length; i++) live.appendChild(y[i]);
}

/* ── Dispatch ───────────────────────────────────────────────────────────────
   One entry per page.  Modules register their builders here as they land;
   anything not yet built falls through to the placeholder, which states which
   module owns it rather than showing a blank screen. */
const PAGE_BUILDERS = {};

function registerPage(id, builder) { PAGE_BUILDERS[id] = builder; }

/* The SAME pages, rendered for a phone.  A stage without a registered mobile
   builder falls back to the Pending Actions queue rather than to a squeezed
   desktop layout — an approver opening a screen that has no phone design yet
   should land on their task list, which is always correct, not on a form with
   a horizontal scrollbar. */
const MOBILE_BUILDERS = {};

function registerMobile(id, builder) { MOBILE_BUILDERS[id] = builder; }

/* Which module is going to build each page.  Shown on the placeholder so an
   unbuilt screen is self-describing during incremental development. */
const PAGE_MODULE = {
  dashboard: 'M-09', scr: 'M-02', orders: 'M-03', shipments: 'M-04',
  allocation: 'M-04', outbound: 'M-05', logistics: 'M-05',
  'delivery-notes': 'M-06', challans: 'M-06', gate: 'M-06',
  inward: 'M-07', reconciliation: 'M-07',
  products: 'M-01', plants: 'M-01', vendors: 'M-01', 'rate-contracts': 'M-01',
  'purchase-offices': 'M-01', 'reason-codes': 'M-01', parameters: 'M-01',
  teams: 'M-10', 'staff-roles': 'M-10', notifications: 'M-10',
  reports: 'M-09', activity: 'M-09'
};

function buildPlaceholderHTML(pg) {
  const mod = PAGE_MODULE[pg] || '—';
  return '<div class="ph">' +
    '<div class="ph-code">' + esc(mod) + '</div>' +
    '<h2 class="ph-title">' + esc(getPageTitle(pg)) + '</h2>' +
    '<p class="ph-note">This screen is built in module ' + esc(mod) + '. ' +
    'The shell, navigation and access control around it are working — ' +
    'switch role in the top bar to see the navigation change.</p>' +
    '<div class="ph-meta">' +
      '<div><span>Signed in as</span><b>' + esc(currentUser().name) + '</b></div>' +
      '<div><span>Position</span><b>' + esc(positionLabel(currentPosition())) + '</b></div>' +
      '<div><span>Team</span><b>' + esc(currentTeam().name) + '</b></div>' +
      '<div><span>Your access here</span><b>' + esc(describeAccess(pg)) + '</b></div>' +
    '</div>' +
  '</div>';
}

/* Spelled out in words rather than letters, because "aev" means nothing to
   anyone reviewing a demo. */
function describeAccess(pg) {
  const names = { a: 'Add', e: 'Edit', v: 'View', d: 'Delete' };
  const out = ['a', 'e', 'v', 'd'].filter(k => can(pg, k)).map(k => names[k]);
  return out.length ? out.join(' · ') : 'No access';
}

/* The journey bar and the hand-off card wrap EVERY page in both channels.
   They are built into the same string rather than living in the shell, so the
   patching differ treats them like any other markup — a stage change repaints
   the bar and leaves the page under it alone. */
function renderPageContent(target) {
  const el = typeof target === 'string' ? document.getElementById(target) : target;
  if (!el) return;

  let html = buildJourneyBar();

  if (channel === 'mobile') {
    const build = MOBILE_BUILDERS[page];
    html += buildMobileShell(build ? build() : buildMobilePending(), getPageTitle(page));
  } else {
    const build = PAGE_BUILDERS[page];
    html += build ? build() : buildPlaceholderHTML(page);
  }

  if (handoffPending) html += buildHandoffCard();
  el.innerHTML = html;
}

function renderPage() {
  const title = document.getElementById('page-title');
  if (title) title.textContent = getPageTitle(page);
  /* The browser tab names the screen you are on, so several open tabs are
     distinguishable and the back/forward history reads sensibly. */
  document.title = getPageTitle(page) + ' · Sub-Contracting';

  if (lastSidebarSig !== sidebarSig()) buildSidebar();
  renderTopbarUser();

  /* One class carries the channel to the stylesheet, which is what lets a
     single reason dialog render as a centred modal on web and a bottom sheet
     inside the device frame on mobile — same markup, same validation. */
  document.body.classList.toggle('mob-on', channel === 'mobile');

  const sw = document.getElementById('channel-switch');
  if (sw) sw.innerHTML = buildChannelSwitch() + buildGuidedControl();

  const el = document.getElementById('page-content');
  if (!el) return;

  if (canPatchPage(page)) {
    const stage = document.createElement('div');
    renderPageContent(stage);
    patchChildren(el, stage);
  } else {
    renderPageContent(el);
    el.scrollTop = 0;
  }
  renderedPage = page;
  stampTableLabels();
}

/* The three reports are built as raw markup rather than through buildTable, so
   their cells carry no data-label. Rather than thread one through three large
   string builders, the heading is copied onto each cell after render — the
   responsive restack reads it from there. patchDom drops unknown attributes on
   a repaint, which is why this runs on every render rather than once. */
function stampTableLabels() {
  document.querySelectorAll('table.rpt, table.lines').forEach(t => {
    const heads = Array.prototype.map.call(t.querySelectorAll('thead th'), th => th.textContent.trim());
    if (!heads.length) return;
    t.querySelectorAll('tbody tr').forEach(tr => {
      Array.prototype.forEach.call(tr.children, (td, i) => {
        if (heads[i] != null && !td.hasAttribute('data-label')) td.setAttribute('data-label', heads[i]);
      });
    });
  });
}

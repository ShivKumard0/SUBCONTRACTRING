# Sub-Contracting

A clickable prototype of an end-to-end sub-contracting journey: organisation-owned
material is sent to a subcontractor for processing, tracked out through the gate,
received back, reconciled against a bill of materials, and closed.

Static, buildless, no backend. Open `index.html` in a browser and it runs.

## Running it

Open `index.html` directly, or serve the folder:

```bash
python -m http.server 8080
```

Then visit <http://localhost:8080>.

State lives in memory and resets on reload. Demo data is seeded through the real
state machine at start-up rather than written in as fixtures, so a broken
transition fails loudly instead of hiding behind hand-made records.

## Deep links

Any point in the walkthrough is a single URL:

```
index.html?as=u-approver&page=scr&view=mobile
index.html?as=u-planner&page=scr&open=SUB-000318
```

| Parameter | Meaning |
| --- | --- |
| `as` | Sign in as a role — `u-planner`, `u-approver`, `u-buyer`, `u-stores`, `u-logistics`, `u-dnote`, `u-finance`, `u-security`, `u-admin` |
| `page` | Land on a screen — `dashboard`, `scr`, `orders`, `shipments`, `outbound`, `logistics`, `gate`, `delivery-notes`, `challans`, `inward`, `reconciliation`, and the master screens |
| `view` | `web` or `mobile` |
| `open` | Open a record by id, e.g. `SUB-000318` |

## The journey

Eighteen stages, ten actors, ten documents. A request is raised and approved, an
order is completed and approved, material is reserved, picked, staged, documented
and cleared through the gate, then returned, inspected, received and reconciled.

Material occupies five positions in turn — **Main → Reserved → Staging → At Vendor
→ Returned to Store**. Staging matters: material sits there through the delivery
note, the challan *and* the physical gate-out, and only moves to the vendor when
the planner confirms the shipment.

Consumption of issued material is derived, never typed:

```
BOM Ratio     = Issue Quantity ÷ Expected Receivable Quantity
Consumed Qty  = Confirmed Received Quantity × BOM Ratio
Outstanding   = Issued − Consumed − Returned − Scrap
```

## Two channels, one transaction

Every screen renders as web or mobile. There is no mobile record, no mobile queue
and no mobile status — the channel is a rendering choice, so both surfaces read
the same stores and write through the same transaction functions. Decisions
default to the phone; everything else defaults to the desk.

## Layout

```
index.html          the app shell
vendor.html         the external vendor portal
css/                design tokens and components; the rules are documented
                    in long comments inside the CSS itself
js/
  core.js           state, navigation, shared helpers
  rbac.js           teams, positions, permissions, maker-checker
  journey.js        the eighteen-stage spine, derived never stored
  channel.js        web/mobile rendering
  ledger.js         inventory: reservations, movements, consumption
  renderer.js       page dispatch and the DOM-patching repaint
  ui.js             shared components
  data/             masters, transactions, seed
  pages/            one module per screen
```

Pages are pure builders returning markup; the renderer diffs the result against
the live DOM and patches only what changed, so filters and pagination keep scroll,
focus and open panels.

## Status

Work in progress. The request, approval and order stages are built; the outbound
and return legs are partly built. Known gaps are tracked outside this repo.

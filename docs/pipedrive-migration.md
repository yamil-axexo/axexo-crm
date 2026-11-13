# Migration from Pipedrive

Goal: CONTIGO holds everything the US and MX teams have in Pipedrive today, so Pipedrive can be switched off after a parallel run. Administration → Pipedrive runs it and shows what went in and what did not.

## How it runs

Three stages, each resumable and repeatable (`src/domain/pipedrive/`):

1. **Configuration** (`config`): users, pipelines, stages, custom fields for deals, organizations, people, activities and products, activity types, lead labels, predefined lost reasons. Also an inventory of webhooks, filters and roles, without credentials or URL parameters.
2. **Raw copy** (`x:*`): every organization, person, deal (including archived), lead (including archived), activity, note, product and deal product goes to `crm.import_raw`, already without the data the standard prohibits.
3. **Load** (`l:*`): the raw copy is translated into the CONTIGO model in batches, then access, next steps, attribution and rules are computed (`finish`).

The screen calls one short step at a time and repeats until done. If the tab closes, the run pauses and continues when an admin opens the screen again. Rate limits from Pipedrive are respected and retried.

Modes: **import everything**, **bring only what changed** (uses `updated_since` from the last full run) and **apply the mapping again** (re-runs the load from the raw copy, no API calls). Running any of them twice does not duplicate: accounts are matched by their Pipedrive alias and everything else through `crm.external_refs`.

API: v2 for organizations, people, deals, activities, products, pipelines, stages and field definitions; v1 for users, leads, notes, activity types and the inventory lists, which have no v2 equivalent. Authentication is the `x-api-token` header. The token needs an admin user so it sees every record.

## What maps to what

| Pipedrive | CONTIGO | Notes |
|---|---|---|
| User | `users` + `external_refs` | Created inactive if inactive in Pipedrive. Gets the sales role in each live market where they own records. Other roles are granted by an admin |
| Pipeline | `pipelines` | Market from the name prefix (`MX -`, `US -`). Other prefixes are reported and skipped |
| Stage | `stages` | Same order, probability and rot days. Won and Lost become closing stages of the pipeline |
| Organization | `accounts` + alias `pipedrive` | Market: `Market` field, else the market of its deals, else address country, else phone prefix, else the owner's main market. With none of those it is not loaded and is counted |
| Person | `contacts` + `account_contacts` | Role from `Job Title` and `Decision Maker`. Phone normalized to E.164 |
| Deal | `deals` + `deal_stage_events` | Stage, status, amount in minor units, lost reason, owner. A deal with no organization gets a minimal account |
| Lead | `leads` | Archived leads enter as disqualified |
| Activity | `activities` | Original type kept in `type_label`. The earliest open activity of an open deal becomes its next step |
| Note | `activities` (kind `note`) | HTML converted to text |
| Product, deal product | `products`, `deal_items` | |
| Custom field | `field_definitions` + `custom` JSON on the record | Shown on the merchant and deal pages, editable with type validation and audit |

Custom fields that feed a model column instead of `custom` (visible in the screen, column "Destino"): `Market`, `Lifecycle stage`, `Zone / Territory`, `Channel Segment`, `Latitude`, `Longitude`, `Phone Number Associated`, `Email Associated`, `City`, `State` on organizations; `Market`, `Job Title`, `Decision Maker` on people. When a value does not fit the column (a phone that is not a valid number, for example) it is kept as an additional field, so nothing is lost. `Merchant ID EMIDA` becomes a searchable `emida` alias.

## Rules that differ from Pipedrive on purpose

- **Won by first transaction (PIPE-06), per pipeline.** Enrollment and B2B pipelines keep the rule; event and order pipelines are closed by hand. The flag and the stage that waits for the transaction are set per pipeline in Administration → Pipelines and fields. Deals already won in Pipedrive arrive as won, with their date.
- **`Tax ID` keeps only its last 4 characters (DATA-06).** The full value is never written, not even to the raw copy.
- **Archived open deals are not loaded.** They are counted. Archived won and lost deals are loaded as history.

## Not migrated in this PR

| Item | Why | Next step |
|---|---|---|
| Files and attachments | Need object storage, which is a platform decision (ADR-002) | After the platform decision |
| Email threads | The API only exposes the mailbox of the token's user | Decide whether email history is needed |
| Organization relationships (parent and child) | One API call per organization | Load once it is confirmed the team uses them; `Master Agent Account` stays as a field meanwhile |
| Which Pipedrive field is the S5 merchant reference | Not known from the configuration | `[pending: S5 / Data & Reporting]` |

## People's edits win (E6.F2)

Every reload remembers, per record, what Pipedrive brought last time (`crm.import_baselines`). Field by field (`src/domain/pipedrive/edits.ts`):

| CONTIGO | Pipedrive | Result |
|---|---|---|
| Same value as what arrives | any | Nothing changes |
| Empty | any | Filled with what arrives |
| Still the last value Pipedrive brought (nobody touched it) | changed | Updated |
| Edited in CONTIGO | unchanged since last time | CONTIGO stays, no noise |
| Edited in CONTIGO | also changed (or no baseline to tell) | CONTIGO stays and the clash goes to Administration → Pipedrive → "Clashes to decide" |

Guarded fields: merchants (name, owner, phone, email, segment, territory, address, city, state, postal code), contacts (name, phone, email, owner), deals (title, owner, amount, stage; the stage carries status, close dates and loss reason with it). Deciding "Use Pipedrive" writes the Pipedrive value; either decision moves the baseline, so the next reload does not ask again unless Pipedrive changes the field again. Records loaded before this rule have no baseline: a difference there is reported as a clash, never overwritten.

## Coexistence and cutover by market (GOB-05, E6.F3)

Administration → Pipedrive shows, per live market, six measured exit criteria: a finished import, the market's merchants loaded, no clashes left, everything the team built in Pipedrive existing in CONTIGO, a cutover date, and Pipedrive frozen with a last sync after the freeze. The cutover is: set the date, freeze (the team stops editing in Pipedrive), run one load (it is recorded as the last sync), then switch Pipedrive off for the market. Switching off needs the freeze, the last sync and zero open clashes. After that, reloads skip that market's records and count them as `market_cut_over`. Switching off is not undone from the screen.

## What the team built in Pipedrive and where it lives in CONTIGO

Source: `/home/claude/audit/pipedrive-inventario.md` (screens read on 13 Nov 2026). Everything is seeded by migration `0040_integraciones` through `crm.pipedrive_rebuild_apply()`, which is idempotent and runs again at the end of the seed and of every Pipedrive load. What needs a pipeline or a field that does not exist yet in a database is created switched off with its reason, and switches on by itself once the pipeline or field arrives (unless a person already switched it on or off by hand). The live list, with links, is in Administration → Pipedrive → "What is left to rebuild" (`crm.pipedrive_rebuild`).

### Automations (US) → Administration → Automations → "Rebuilt from Pipedrive"

| # | Pipedrive | CONTIGO | State |
|---|---|---|---|
| 1 | Owner - Valentina at Approvals (US) | `pd_owner_at_approvals`: on `deal.stage_changed` into Approvals of the dealer pipeline, the deal goes to the Operations queue (the existing handoff: the pipeline's Operations lead). No fixed name: the target (queue or one Operations person) is chosen on the automation page. The seller is kept as sales rep | On |
| 2 | Sales Rep - new US deal (added) | `pd_sales_rep_new_deal`: `deal.created` in the dealer pipeline and `sales_rep` empty → `sales_rep` = owner | On; off with its reason where the `sales_rep` field does not exist yet (it arrives with the load) |
| 3 | Sales Rep - follows owner (updated) | `pd_sales_rep_follows_owner`: `deal.owner_changed` (new per-deal event) in the dealer pipeline, not in an Operations stage → `sales_rep` = owner. CONTIGO also freezes the sales rep when the deal reaches Operations | Same as #2 |
| 4 | Recruited by - ACE deal (added) | `pd_recruited_by_ace`: `deal.created` in the dealer pipeline and owner in a list → `recruited_by` = ACE. The list is empty: [pending: LuisRo Sanabria] | On once the field exists; matches nobody until the list is filled |
| 5 | Merchant Origin - US organization (updated) | `pd_merchant_origin_updated`: `account.updated`, `merchant_origin` empty → "New acquisition". Never overwrites | Same as #2 (field `merchant_origin`) |
| 6 | Merchant Origin - new US organization (created) | `pd_merchant_origin_created`: `account.created`, same action | Same as #5 |
| 7 | Stamp Portal Migration Date | `pd_portal_migration_date`: `account.custom_updated`, `portal_migration_status` = Completed and date empty → `portal_migration_date` = market today | Same as #2 (fields `portal_migration_status`, `portal_migration_date`) |
| 8 | Welcome Email - Vegas 2026 | `pd_welcome_vegas_2026`: `deal.created` in the Las Vegas pipeline at "Lead captured" → email to the deal contact with template `vegas_2026_welcome` (notices service) | Off, as in Pipedrive; email channel off |
| 9 | Welcome Email - Vegas 2026 (Manual Run) | `pd_followup_vegas_2026`: same conditions, template `vegas_2026_followup` signed by the US GM: [pending: name of the US GM] (the template is blocked until filled) | Off, as in Pipedrive; email channel off |

### Automatic assignment

| Pipedrive | CONTIGO |
|---|---|
| Las Vegas Round Robin (Deal added, "Sales Team US") | Turn `Las Vegas Round Robin` in `crm.routing_rules` (members: the US sales people at migration time; edited in Administration → Forms and turns) plus automation `pd_vegas_round_robin`: `deal.created` in the Las Vegas pipeline → next person in the turn owns the deal. Off with its reason until the Las Vegas pipeline exists |

### Insights reports → shared saved reports in Reports (market US)

| Pipedrive | CONTIGO report | Cut |
|---|---|---|
| US - Deals waiting in Approvals (by owner) | Deals by stage | dealer pipeline, by person |
| US - Deals with no next step (stall risk, by stage) | Deals by stage | dealer pipeline, no next step |
| US - Intake over time (new deals) | Market report | monthly counts |
| US - Sales funnel (conversion by stage) | History | dealer pipeline |
| US - Time in stage | History | dealer pipeline, stage velocity |
| US - Vegas open deals by rep (by stage) | Deals by stage | Las Vegas pipeline, by person |
| US - Vegas Leads Activities by rep (by type) | Field report | Las Vegas pipeline |
| US - Vegas Open deals by stage | Deals by stage | Las Vegas pipeline |
| US - Activities by rep (by type) | Field report | US |
| US — Deals por loss reason | Closed deals | lost, by reason |
| US — Deals entrando por stage (mensual) | Market report | dealer pipeline, by month |
| US — Vegas Funnel conversion (Lead→Won) | History | Las Vegas pipeline |

### Insights dashboards → Reports → "Boards" (`crm.report_boards`)

| Pipedrive | CONTIGO board |
|---|---|
| US - Dealer Enrollment Ops | US · Dealer sign-up, Operations (reports 1 to 5, 9 to 11) |
| US - Vegas Sales Overview | US · Vegas, sales (reports 6 to 8 and 12) |
| MX Transacciones — Preview | MX · Transactions (reconciliation, wins by period) |
| MX Cobertura | MX · Coverage (field indicators, field report) |
| MX Enrollment — Funnel | MX · Sign-up funnel (deals by stage, leads, market report) |
| MX Ops — Tiendas | MX · Operations, stores (chains and key accounts, history) |

### Goal

| Pipedrive | CONTIGO |
|---|---|
| Deals won | `crm.goals` `pd_deals_won_us`: deals won per month, US market. Progress on the Leadership panel and in My team; the figure is set there by the market lead or an admin ([pending: goal figure]) |

### Team filters → factory saved views (or shared saved reports for closed deals)

| Pipedrive | CONTIGO |
|---|---|
| US Dealer Enrollment - deals without rep | Deal view "US · Alta de dealers sin persona asignada" (dealer pipeline, no owner) |
| Vegas AWPE - Audit | Deal view "Vegas · Revisión" (Las Vegas pipeline, list) |
| Vegas AWPE - Lost | Saved report "Vegas · Perdidos" (closed deals, lost, Las Vegas) |
| Vegas AWPE - Lost no response | Saved report "Vegas · Perdidos sin respuesta" (lost, by reason) |
| Vegas AWPE - Open (No Last Activity Date) | Deal view "Vegas · Abiertos sin actividad registrada" (quiet for 30 days) |
| Vegas AWPE - Open (No Sales Contact) | Deal view "Vegas · Abiertos sin persona de ventas" (no owner) |
| Vegas AWPE - Open no activity | Deal view "Vegas · Abiertos sin próximo paso" (no next step) |
| US - Organizations | Merchant view "US · Organizaciones" |
| US · axexo Business Portal | Merchant view "US · Portal axexo Business": all US merchants; [pending: exact filter condition, LuisRo Sanabria] |
| US - People | Not rebuilt: CONTIGO has no separate people list; contacts live on each merchant page and are found from Search |

The Las Vegas views and reports are created once the Las Vegas pipeline exists in the database.

### Zoho

No access to Zoho from CONTIGO and no importer. Nothing connects to Zoho without a technology review (Dan Mulligan or Michael Essiet).

## Tests

`tests/db/integraciones-migracion.test.ts` covers the field rule case by case, a reload against CONTIGO edits (name, owner, city, postal code, contact phone, email and name, deal stage and title), deciding clashes, the cutover, that every rebuilt item exists after `migrate reset`, and the rebuilt automations running on the engine. `tests/support/pipedrive-mock.mjs` serves the same routes, pagination and shapes as the real API with synthetic data. `tests/db/pipedrive.test.ts` runs the full import, a second full import, a delta and a re-map against a real Postgres; `tests/e2e/zz-pipedrive.spec.ts` runs it from the screen.

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
| Automations | Pipedrive has no API for them | Inventory by hand, rebuild as CONTIGO rules |
| Files and attachments | Need object storage, which is a platform decision (ADR-002) | After the platform decision |
| Email threads | The API only exposes the mailbox of the token's user | Decide whether email history is needed |
| Organization relationships (parent and child) | One API call per organization | Load once it is confirmed the team uses them; `Master Agent Account` stays as a field meanwhile |
| Filters as saved views | Filter conditions are Pipedrive-specific | Rebuild the ones the team uses |
| Which Pipedrive field is the S5 merchant reference | Not known from the configuration | `[pending: S5 / Data & Reporting]` |

## Tests

`tests/support/pipedrive-mock.mjs` serves the same routes, pagination and shapes as the real API with synthetic data. `tests/db/pipedrive.test.ts` runs the full import, a second full import, a delta and a re-map against a real Postgres; `tests/e2e/zz-pipedrive.spec.ts` runs it from the screen.

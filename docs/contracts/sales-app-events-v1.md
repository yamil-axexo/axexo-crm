# Sales App → CONTIGO events, v1 (proposed)

Status: **proposed by CONTIGO. Not agreed with the team that owns the Sales App and Sales Core.** Field names follow `VisitResponse` as documented for Sales Core. The connection is not live: no system sends events yet. Signing this contract with Product & Technology is the open step.

Four events: `visit.checked_out`, `store.created`, `onboarding.submitted` and `merchant.approved`. The first two are described by hand below; the full list, the JSON Schemas, the field matrix, the one-creator rule and dead letters are in the generated section at the end of this file.

`POST /api/v1/events/sales-app` · `Authorization: Bearer <key with scope events:write>` · JSON body.

Idempotent by `event_id`: the second delivery returns `{"status":"duplicate"}` and changes nothing.

## `visit.checked_out`
```json
{
  "event_id": "string, 8-80 chars, unique",
  "type": "visit.checked_out",
  "version": 1,
  "occurred_at": "ISO 8601 with offset",
  "data": {
    "visit_id": "Sales Core visit id",
    "customer_id": "Sales Core customer id (stored in CONTIGO as alias, system sales_core)",
    "salesperson_id": "Sales Core user id",
    "salesperson_email": "optional",
    "business_date": "YYYY-MM-DD",
    "checked_in_at": "ISO 8601",
    "checked_out_at": "ISO 8601 or null",
    "duration_seconds": 720,
    "sale": false,
    "rejection_reason": "owner_absent | no_cash | has_stock | not_interested | closed | null",
    "revisit": true,
    "revisit_reason": "string or null",
    "decision_maker_present": false,
    "auto_closed": false,
    "note": "string or null"
  }
}
```
Effect: the visit appears on the merchant timeline (read-only). `revisit: true` flags the open deal for a decision-maker revisit, due two days after `business_date`. `decision_maker_present: true` clears it. An unknown `customer_id` is stored, answered with `{"status":"unmatched"}` and placed in the exception queue.

Decision-maker revisit (optional fields, added 13-nov-2026, package `embudo`, catalog PIPE-05). `data` may also carry
`"revisit_due": "YYYY-MM-DD"` and `"decision_maker_contact": { "name": "…", "role": "owner | decision_maker | manager", "phone": "optional", "best_time": "optional, up to 120 characters" }`.
With `revisit: true` CONTIGO also creates one revisit task (a planned visit) dated `revisit_due` (or two days after
`business_date`), owned by whoever owns the open deal, the merchant or, failing both, the visitor; the task is created even
when the merchant has no open deal. The decision-maker is saved as a contact of the merchant (matched by phone or name, never
duplicated). A `rejection_reason` that is not in the reason catalog is no longer dropped in silence: it is counted in
`crm.unknown_reason_codes` and shown in Administration. The catalog and its version are published in `GET /api/v1/catalogs`
(`loss_reasons`, `reason_catalog.version`).

Visits logged by hand in CONTIGO (while this feed is not connected): a hand-logged visit stops counting in Mi equipo when a `visit.checked_out` arrives for the same merchant and the same `business_date`. Both stay in the merchant thread, each labeled with its origin. Nothing has to be cleaned up when the feed is turned on (`crm.visit_log`, migration `0010_field_work`).

## `store.created`
```json
{ "event_id": "…", "type": "store.created", "version": 1, "occurred_at": "…",
  "data": { "customer_id": "…", "market": "MX", "name": "…", "phone": "optional", "locality": "optional", "region": "optional", "salesperson_email": "optional" } }
```
Effect: one creator of stores. If a prospect with the same phone exists in that market, the alias is linked to it; otherwise the account is created in onboarding. CONTIGO emits `account.alias_issued` through its outbox with `{ account_id, system, external_id }`.

## Open questions for the owning team
1. Who creates the master store record and issues the canonical ID (committee decision #1).
2. Whether Tech already runs an event bus that should carry these events instead of HTTP (committee decision #12).
3. Sales Core documents region SV only; MX and US are not documented.

<!-- generated:matrix:start -->
## Events CONTIGO receives (v1)

| Event | Version | About | Required data |
| --- | --- | --- | --- |
| `visit.checked_out` | 1 | A visit ended. | `visit_id`, `customer_id`, `salesperson_id`, `business_date`, `checked_in_at`, `sale` |
| `store.created` | 1 | A store was created. | `customer_id`, `market`, `name` |
| `onboarding.submitted` | 1 | The merchant’s onboarding was submitted. | `customer_id`, `submitted_at` |
| `merchant.approved` | 1 | The merchant was approved and has a Merchant ID. | `customer_id`, `merchant_ref`, `approved_at` |

JSON Schemas: `sales-app-events-v1.schema.json` (generated from the same validation the endpoint runs).

## Field matrix: which system wins each field

| Data | Owner | Travels in | Rule |
| --- | --- | --- | --- |
| Store ID (customer_id) | Sales Core (onboarding) | `store.created · onboarding.submitted` | It is born there. CONTIGO stores it as an alias of its own ID and announces it with account.alias_issued. |
| Merchant ID in CONTIGO | CONTIGO | `account.alias_issued` | One creator: if the merchant already exists (same ID or same phone in the market), the event links to it; it never duplicates. |
| Trade name, city and state | CONTIGO | `store.created · onboarding.submitted` | The event carries them only to create the merchant the first time. If it exists, CONTIGO’s values win. |
| Merchant phone | CONTIGO | `store.created · onboarding.submitted` | Used to link to the prospect. It does not overwrite the existing one. |
| Account owner, territory, hierarchy and portfolio | CONTIGO | `account.reassigned · account.territory_set` | Only CONTIGO changes them. The seller email in the event only suggests an owner when the merchant is born without one. |
| Visit: date, duration, sale or not, reason, decision-maker, revisit | Sales App | `visit.checked_out` | The visit is recorded once, there. CONTIGO reads it and flags the revisit on the deal; it does not edit it. |
| Onboarding submitted and documents complete | Sales App | `onboarding.submitted` | Moves the merchant to "Onboarding" and leaves the entry in its thread. |
| Merchant ID | Sales Core (onboarding) | `merchant.approved` | Set by whoever approves. If another merchant in the market already has it, the message is held for manual review. |
| Deal stage and pipeline | CONTIGO | `deal.stage_changed` | No Sales App event moves the stage. Approval does not win the deal. |
| First transaction and sales activity | Sales data | `merchant_metrics_daily (archivo diario / daily file)` | Wins the deal and activates the merchant. It arrives in the daily file, not as an event. |

## One store creator

A store is looked up by its Sales Core id; if absent, by phone within the market (the prospect CONTIGO already had); only if neither exists is it created. `store.created` and `onboarding.submitted` share this path, so whichever arrives second links to the existing merchant and never duplicates it.

## Dead letters and replay

A message that does not match the contract is answered with `422` and kept in dead letters with a short reason (`unknown_type`, `unsupported_version`, `invalid_field:<path>`), scrubbed of prohibited data and capped in size. A valid message about a store CONTIGO does not know yet is kept as held (`unknown customer_id`). Both can be reprocessed from Administration; a replay runs on the same row, so idempotency by `event_id` still holds.
<!-- generated:matrix:end -->

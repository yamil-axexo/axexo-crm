# Sales App → CONTIGO events, v1 (proposed)

Status: **proposed by CONTIGO. Not agreed with the team that owns the Sales App and Sales Core.** Field names follow `VisitResponse` as documented for Sales Core.

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

# S5 → CONTIGO daily file `merchant_metrics_daily`, v1 (proposed)

Status: **proposed by CONTIGO. Not agreed with S5.** Aggregates only; CONTIGO never stores individual transactions.

`POST /api/v1/metrics/daily` · `Authorization: Bearer <key with scope metrics:write>`.

```json
{
  "as_of": "YYYY-MM-DD",
  "file_name": "merchant_metrics_daily_YYYYMMDD.json",
  "mode": "full | delta",
  "rows": [
    { "merchant_ref": "S5 merchant id or Sales Core customer id",
      "first_txn_at": "ISO 8601 or null", "last_txn_at": "ISO 8601 or null",
      "txn_count_30d": 0, "volume_minor_30d": 0, "currency": "MXN", "active_days_30d": 0,
      "status": "active | at_risk | inactive (optional)" }
  ]
}
```

Validation before anything is applied (REL-10): schema, unique `merchant_ref`, non-negative counts and amounts, and for `full` files a row count within ±20% of the previous full file. A file outside that band is recorded as rejected and nothing is applied. The same content sent twice returns `duplicate`.

Effects, in one transaction:
- An open deal of a merchant with `first_txn_at` is won with that date (`closed_by = transaction`).
- The merchant becomes active and a handoff task is created for operations in that market.
- A merchant with fewer than 5 active days in 30 moves to at risk, or inactive if it has no transactions.

Money is an integer in minor units with its currency (DATA-03). Volume in USD on the leadership panel uses the dated rate in `crm.fx_rates`, which S5 should also provide `[pending: S5]`.

## Merchant status (optional field, added 12-nov-2026, package `reportes`)

`status` is the merchant status as defined by the owner of the metric (Data & Reporting): `active`, `at_risk` or `inactive`.
When a row carries it, CONTIGO stores it and sets the merchant status to exactly that value: it does not recompute it
(catalog REP-04: one definition, one owner). When a row comes without it, CONTIGO falls back to its own rule (active with
5 or more selling days in the last 30; otherwise at risk, or inactive with no sales) and the screens say so. The
reconciliation screen (Reportes, "Conciliación con el archivo de ventas") lists every merchant whose status in CONTIGO
differs from the one in the latest file. Not yet agreed with Data & Reporting: until then the field stays optional.

## Funding, habit, manifest and corrections (optional fields, added 13-nov-2026, package `embudo`)

Catalog PIPE-06: closing is driven by transactional events, each milestone kept apart, and a milestone already set is never
overwritten in silence. All of these are optional: a file without them keeps working exactly as before.

```json
{
  "manifest": { "row_count": 2, "generated_at": "ISO 8601 (optional)", "sha256": "hex (optional)" },
  "rows": [
    { "merchant_ref": "…", "first_funding_at": "ISO 8601 or null", "funding_method": "cash | spei | ach | pix | other",
      "first_txn_at": "…", "habit_at": "ISO 8601 or null", "txn_count_30d": 0, "volume_minor_30d": 0, "currency": "MXN", "active_days_30d": 0 }
  ],
  "corrections": [
    { "merchant_ref": "…", "kind": "first_funding | first_txn | habit", "action": "void | restate",
      "at": "ISO 8601 (required for restate)", "method": "optional, first_funding only", "reason": "3 to 300 characters" }
  ]
}
```

- `manifest.row_count` must equal the number of rows received. If it does not, the file is recorded as rejected
  (`manifest_mismatch`), the answer is 409 and nothing is applied.
- `first_funding_at` (with `funding_method`): stored once per merchant. An open deal of that merchant, in a pipeline that
  closes by transaction and sitting before the "waiting for the first sale" stage, moves to that stage (`deal.funded`).
- `habit_at`: stored once per merchant, apart from the first transaction. It does not move the deal.
- A later file never overwrites a milestone already set. To change one, send a correction: `void` (it did not happen) or
  `restate` (it happened at another time). Every correction is an appended row in `crm.milestone_events` with the previous
  value and the reason. Voiding `first_txn` reopens the deal that the transaction had won (stage event with cause
  `correction`, a task for its owner, merchant back to onboarding); restating it changes the win date and logs the old one.
- Re-sending a cut (`as_of`) that was already loaded with different figures for a merchant stores the before and the after
  in `crm.metric_restatements`; the response reports `restatedRows`.
- Response adds `funded`, `corrections` and `restatedRows`.

Pulling the file (instead of receiving it) is an adapter left off (`src/server/adapters/sales-file.ts`, variable `SALES_FILE`).
Not yet agreed with Data & Reporting: the funding and habit fields, the method list and where the file is left `[pending: Data & Reporting]`.


## Late files, required manifest, TPV by product and commission (added 13-nov-2026, package `reportes2`)

- **Late files are rejected.** A file whose `as_of` is earlier than the latest cutoff already applied is recorded as
  rejected (`stale_as_of`), the answer is 409 and nothing is applied: an older cutoff never moves merchant status back.
  The same `as_of` is still accepted (it is a correction and keeps its before and after, see PIPE-06).
- **Manifest can be required.** Administration has a setting (Administración, "Tableros y valores propuestos"):
  when it is on, a file with no `manifest` is recorded as rejected (`manifest_missing`), 409, nothing applied. It is off
  (proposed value) until Data & Reporting delivers the manifest in every file.
- **Optional per-row fields.** CONTIGO stores them as they come and never computes them:

```json
{ "tpv_by_product": [{ "product": "string (1-60)", "volume_minor_30d": 0 }],
  "commission_minor_30d": 0 }
```

Without them, screens say there is no data. With `status` missing, CONTIGO uses its fallback rule and says so on screen
("Estado calculado por CONTIGO con su regla de respaldo").

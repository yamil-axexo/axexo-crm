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
      "txn_count_30d": 0, "volume_minor_30d": 0, "currency": "MXN", "active_days_30d": 0 }
  ]
}
```

Validation before anything is applied (REL-10): schema, unique `merchant_ref`, non-negative counts and amounts, and for `full` files a row count within ±20% of the previous full file. A file outside that band is recorded as rejected and nothing is applied. The same content sent twice returns `duplicate`.

Effects, in one transaction:
- An open deal of a merchant with `first_txn_at` is won with that date (`closed_by = transaction`).
- The merchant becomes active and a handoff task is created for operations in that market.
- A merchant with fewer than 5 active days in 30 moves to at risk, or inactive if it has no transactions.

Money is an integer in minor units with its currency (DATA-03). Volume in USD on the leadership panel uses the dated rate in `crm.fx_rates`, which S5 should also provide `[pending: S5]`.

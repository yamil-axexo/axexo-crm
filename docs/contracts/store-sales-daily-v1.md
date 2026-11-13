# Data & Reporting → CONTIGO nightly file `store_sales_daily`, v1 (proposed)

Status: **proposed by CONTIGO. Not agreed with Data & Reporting** `[pending: Data & Reporting]`. Aggregates per store only; CONTIGO never stores individual transactions.

Two ways in, same contract:
- Pushed: `POST /api/v1/metrics/stores` · `Authorization: Bearer <key with scope metrics:write>`.
- Pulled: the nightly job `integraciones2.store_sales_nightly` asks the sales file adapter (`SALES_FILE`) for the next file. The adapter is **off**: with it off the job goes nowhere and says "Canal apagado".

```json
{
  "contract": "store_sales_daily",
  "version": 1,
  "as_of": "YYYY-MM-DD",
  "file_name": "store_sales_daily_YYYYMMDD.json",
  "rows": [
    {
      "merchant_ref": "S5 merchant id or Sales Core customer id",
      "currency": "MXN",
      "activations": [ { "carrier": "Telcel", "mtd": 12, "prev_month": 30, "d90": 80 } ],
      "payments":    [ { "product": "Recargas", "mtd": 150000, "prev_month": null, "d90": 900000 } ]
    }
  ]
}
```

- `mtd`: month to date, as of `as_of`. `prev_month`: the whole previous calendar month. `d90`: the last 90 days to `as_of`.
- `activations` are counts by carrier. `payments` are payment volume by product in minor units of `currency` (DATA-03). `currency` is required when `payments` is present.
- **No activity is empty, never zero.** `0`, `null` or a missing value are all stored as empty and shown empty on the store record and in My team.
- Validation before anything is applied: schema, unique `merchant_ref` in the file, unique carrier and product per row, non-negative integers. A row whose `merchant_ref` does not match an active store is counted as unmatched.
- Idempotent by content: the same file twice returns `duplicate`. A new file for the same `as_of` replaces that store's figures for that day.
- The load is a data load (E5.F3/F4/F5): it records start and end in CONTIGO status, does not run inside the market maintenance window or while another load runs, and its owner is notified if it fails or does not arrive by its expected time.

Where it shows: store record (Data tab, "Store sales"), My team ("Team store sales"), and the route tool read (`performance.activations_mtd`, `performance.activations_prev_month`).

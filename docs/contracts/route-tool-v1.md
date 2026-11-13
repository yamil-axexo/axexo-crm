# CONTIGO ↔ route tool, v1 (proposed)

Status: **proposed by CONTIGO.** The route tool is not chosen or connected (adapter `routes`, variable `ROUTE_TOOL`, **off**). Connecting it goes through the technology review (Dan Mulligan or Michael Essiet).

## Read: the stores of one person

`GET /api/v1/routes/stores?owner_email=<email>` · key with scope `accounts:read`, limited to the key's market.

```json
{
  "owner_email": "rep@axexo.com",
  "market": "MX",
  "data": [
    {
      "account_id": "uuid",
      "name": "Store name",
      "address": "street or null", "locality": "city or null", "region": "state or null", "postal_code": "or null",
      "contact": "contact name or null",
      "merchant_ref": "Merchant ID or null",
      "approved_products": ["SIM activation"],
      "performance": {
        "txn_count_30d": 0, "activations_mtd": 12, "activations_prev_month": 30,
        "sales_as_of": "YYYY-MM-DD or null", "last_visit_on": "YYYY-MM-DD or null"
      }
    }
  ]
}
```

Only stores the person owns, never someone else's. Like the rest of the API it carries no phone numbers or emails. `null` in performance means no data or no activity. Up to 500 stores. A test key (`mode = test`) returns an empty list.

## Back: a check-in becomes a visit

`POST /api/v1/routes/checkins` · key with scope `events:write`.

```json
{ "checkin_id": "unique id from the tool", "account_id": "uuid", "owner_email": "rep@axexo.com",
  "checked_in_at": "ISO 8601 with offset", "checked_out_at": "ISO 8601 or null", "note": "optional, up to 500" }
```

The check-in is stored as an open visit (`crm.visits`, outcome `open`) on the store's thread, with the person if the email matches an active user. Idempotent by `checkin_id`: the same check-in twice returns `duplicate`. The note is marked as text from the route tool (IA-07).

Contract test: `tests/db/integraciones2.test.ts` ("E5.F6").

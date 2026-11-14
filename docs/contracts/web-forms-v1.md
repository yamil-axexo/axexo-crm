# Website → CONTIGO forms, v1

Two ways to connect a form:

1. **Hosted page**: `/f/<slug>`. Ready to use.
2. **API**: `POST /api/v1/forms/<slug>` from the website backend, with `Authorization: Bearer <key with scope forms:write>` and an `Idempotency-Key` header.

```json
{ "business_name": "required", "contact_name": "required", "phone": "phone or email required", "email": "", "locality": "", "message": "" }
```

Optional fields, on both paths:

| Field | What it is |
|---|---|
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` | Campaign attribution (requirement E3.F6). The hosted page reads them from its own address: `/f/<slug>?utm_source=...`. |
| `gclid`, `fbclid` | Click identifiers from Google and Meta, read the same way. |
| `ttclid`, `li_fat_id`, `twclid` | Click identifiers from TikTok, LinkedIn and X, read the same way (added 13-nov-2026, package `embudo`). |
| `landing_page`, `referrer` | Page where the person landed and page they came from. Only host and path are stored: anything after `?` or `#` is dropped. The hosted page fills them by itself. |
| `timezone` | IANA time zone of the store (for example `America/Tijuana`), added 13-nov-2026 by package `embudo2`. The first contact clock counts business hours in this zone; without it (or with an unknown zone) it uses the market zone. Never rejects the form. |
| `ref` | Referral code of a merchant (8 characters). The link `/r/<code>` opens the form with it. The lead is attributed to that merchant; an unknown code is ignored and never rejects the form. |
| `x_store_count` (or `store_count` in the API) | Number of stores, used by the assignment rules that route by size. |
| `consent` | `true` when the person ticked the email opt-in (requirement E3.F7). The hosted page shows an optional, unticked box. |
| `consent_text` | API only: the exact wording the person accepted on the website. If absent, the hosted page wording is stored. |
| `consent_at` | API only: ISO 8601 timestamp of the opt-in on the website. If absent or in the future, the arrival time is stored. |

Attribution values are trimmed to 200 characters and never reject the lead. Page, referrer and the click identifiers of TikTok, LinkedIn and X are stored since 13-nov-2026 (package `embudo`); every arrival is kept as a touch (`crm.source_touches`), so the first one is never overwritten by the last, and the touches travel to the merchant and the deal on conversion. The stored lead shows its origin and its consent, with the date, in the lead detail.

Each form belongs to one market and one go-to-market motion, and points to a routing rule. Since 13-nov-2026 the market's ordered assignment rules (Administration, Assignment and pipeline) decide first; if none does, the form's routing rule applies as before; and before a lead is left with no owner it goes to the market lead. Every decision is written to `crm.assignment_log`. A submission that fails to be saved because of a failure on CONTIGO's side is held in `crm.intake_retries` and retried by a scheduled job (the API answers `{"status":"accepted","retry":"held"}`). The lead is assigned by atomic round robin among the members who hold a current sales role in that market (if none does, and the fallback does not either, the lead stays unowned and visible to the market's sellers), gets a response deadline from the rule, and is checked against existing merchants by phone and by name similarity.

The hosted page includes a honeypot field. Rate limiting is not implemented yet (SEC-06).

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
| `consent` | `true` when the person ticked the email opt-in (requirement E3.F7). The hosted page shows an optional, unticked box. |
| `consent_text` | API only: the exact wording the person accepted on the website. If absent, the hosted page wording is stored. |
| `consent_at` | API only: ISO 8601 timestamp of the opt-in on the website. If absent or in the future, the arrival time is stored. |

Attribution values are trimmed to 200 characters and never reject the lead. Page and referrer, and the other click identifiers named in E3.F6 (TikTok, LinkedIn, X), are not stored yet. The stored lead shows its origin and its consent, with the date, in the lead detail.

Each form belongs to one market and one go-to-market motion, and points to a routing rule. The lead is assigned by atomic round robin among the members who hold a current sales role in that market (if none does, and the fallback does not either, the lead stays unowned and visible to the market's sellers), gets a response deadline from the rule, and is checked against existing merchants by phone and by name similarity.

The hosted page includes a honeypot field. Rate limiting is not implemented yet (SEC-06).

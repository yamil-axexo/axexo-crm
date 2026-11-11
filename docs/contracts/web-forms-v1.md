# Website → CONTIGO forms, v1

Two ways to connect a form:

1. **Hosted page**: `/f/<slug>`. Ready to use.
2. **API**: `POST /api/v1/forms/<slug>` from the website backend, with `Authorization: Bearer <key with scope forms:write>` and an `Idempotency-Key` header.

```json
{ "business_name": "required", "contact_name": "required", "phone": "phone or email required", "email": "", "locality": "", "message": "" }
```

Each form belongs to one market and one go-to-market motion, and points to a routing rule. The lead is assigned by atomic round robin among active members, gets a response deadline from the rule, and is checked against existing merchants by phone and by name similarity.

The hosted page includes a honeypot field. Rate limiting is not implemented yet (SEC-06).

# Engineering Standard v1: compliance of this PR

Source: `axexo-CONTIGO-Estandar-Ingenieria-v1-2026-11-11`. Status as of 11-Nov-2026, for the staging candidate. Staging may hold current Pipedrive data under ADR-005; development and CI use synthetic data.

**Met** = implemented and covered by a test or a file you can open. **Partial** = part of the rule is in place; the gap is stated. **Not yet** = not in this PR. **Open** = needs a decision or an owner outside this repository. **N/A** = the thing the rule governs does not exist here yet.

Summary: 29 Met, 22 Partial, 10 Not yet, 19 Open, 6 N/A, out of 86 rules.

## Portability
| Rule | Level | Status | Evidence or gap |
|---|---|---|---|
| PORT-01 | MUST | Met | `src/dal`, `src/domain`, `src/server` import `server-only`; DTOs returned to pages |
| PORT-02 | MUST | Met | No client data SDK; tables live in schema `crm`, not exposed; CSP `connect-src 'self'` (E2E header test) |
| PORT-03 | MUST | Met | `db/migrations/*.up.sql` and `*.down.sql`; `scripts/migrate.mjs`; up, down and reset exercised in CI |
| PORT-04 | SHOULD | Met | `src/server/adapters/identity.ts`; AWS implementation described in ADR-004 |
| PORT-05 | MUST | Met | `src/env.ts` (zod); refuses persona login and missing IdP in production |
| PORT-06 | SHOULD | Met | `output: 'standalone'`; E2E suite runs `node .next/standalone/server.js` |
| PORT-07 | SHOULD | Met | No ISR, no Vercel-only APIs |

## Data
| Rule | Level | Status | Evidence or gap |
|---|---|---|---|
| DATA-01 | MUST | Met | `market_code not null` on every business table, indexed on the large ones |
| DATA-02 | MUST | Partial | `crm.markets` has timezone, currency, locales, `data_region`, flags, `privacy_notice_version`. The notice version has no value `[pending: Legal]` |
| DATA-03 | MUST | Met | `amount_minor bigint` + `currency char(3)`; conversion only in the leadership panel with a dated rate |
| DATA-04 | MUST | Met | `timestamptz` everywhere; dates shown in the market time zone |
| DATA-05 | MUST | Met | E.164 check constraint; `toE164` validates per country with libphonenumber (unit test) |
| DATA-06 | MUST | Partial | No full fiscal ID is stored. The Pipedrive import keeps only the last 4 characters of `Tax ID` and drops fields that look like account, card or password fields, before the raw copy is written (DB test). Encryption with KMS comes with the platform |
| DATA-07 | SHOULD | Not yet | Addresses are plain columns, not per-market validated `jsonb` |
| DATA-08 | MUST | Partial | `crm.field_definitions` + `custom jsonb`, shown in Administration. No owner or review date per field, no editor |
| DATA-09 | SHOULD | Met | `app.uuid_v7()` default on every table (DB test). Synthetic seed rows use deterministic IDs |
| DATA-10 | SHOULD | Not yet | No `export_market` script |
| DATA-11 | MUST | Partial | Nothing is hard-deleted: the app role has no `DELETE`; merges archive. Retention and purge `[pending: Legal]` |
| DATA-12 | MUST | Met | Transactional figures arrive as daily aggregates from S5; the CRM stores no transactions |

## Identity and authorization
| Rule | Level | Status | Evidence or gap |
|---|---|---|---|
| AUTHZ-01 | MUST | Partial | Google OIDC through the adapter, domain enforced server-side. Needs the OAuth client configured in staging to be exercised end to end; MFA is an IdP policy `[pending: Workspace admin]` |
| AUTHZ-02 | MUST | Met | `crm.memberships`, `crm.user_territories`, `ancestor_ids`; no claims |
| AUTHZ-03 | MUST | Met | RLS enabled and forced on all 36 tables (DB test asserts none is missing) |
| AUTHZ-04 | MUST | Met | `withUser` in `src/server/db.ts`; `app.current_user_id()` |
| AUTHZ-05 | MUST | Met | `contigo_app` has no BYPASSRLS, owns nothing (DB test) |
| AUTHZ-06 | MUST | Met | Scope functions wrapped in `(select …)`; indexes on `owner_id`, `territory_id`, `market_code`, GIN on `ancestor_ids` |
| AUTHZ-07 | MUST | Partial | Lists and search filter by market explicitly; detail pages rely on RLS plus the record ID |
| AUTHZ-08 | MUST | Met | `tests/db/permissions.test.ts`: 21 tests, allowed and denied per role × object × action, as the app role |
| AUTHZ-09 | MUST | Partial | Directory sync is built as an adapter and off (`DIRECTORY_ADAPTER`, job `seguridad.directorio`): it needs a read-only directory service account and its approval. Meanwhile: unused access report, periodic access review signed off by the market lead, expiry dates, and sessions that expire within 12 h (ADR-008) |
| AUTHZ-10 | MUST | Met | No external users |

## Application security
| Rule | Level | Status | Evidence or gap |
|---|---|---|---|
| SEC-01 | MUST | Open | ASVS 5.0 L2 is the target; no assessment has been run |
| SEC-02 | MUST | Met | `runAction` and `apiHandler` authenticate; domain commands authorize and validate with zod |
| SEC-03 | MUST | Met | No `NEXT_PUBLIC_` variable exists |
| SEC-04 | MUST | Open | Patch policy needs an owner `[pending: Engineering]` |
| SEC-05 | MUST | Met | CSP with per-request nonce, HSTS, `frame-ancestors 'none'`, Referrer-Policy, Permissions-Policy (E2E test). `style-src` allows inline styles |
| SEC-06 | MUST | Partial | Rate limiting in the database (sliding window, `app.rate_hit`): API per key and per IP with `429` and `Retry-After`, failed keys per IP, public forms per IP and per form (views and submissions), minimum fill time, trap field and page key. Not yet: searches inside the app, an edge limit, and the live anti-bot service (adapter built, off) |
| SEC-07 | MUST | Met | There are no exports |
| SEC-08 | MUST | Partial | `scripts/scan-prohibited.mjs` scans the repo in CI and free-text columns with `--db`. At write time: card numbers and SSNs are removed from imported notes and refused in custom text fields (unit and DB tests). Not yet applied to every free-text input |
| SEC-09 | MUST | Partial | Frozen lockfile, Dependabot, secret scan in CI. SAST and license check not configured |
| SEC-10 | SHOULD | Open | Google Workspace policy |
| SEC-11 | MUST | Open | Pentest before widening users |
| SEC-12 | MUST | N/A | No AI features |

## Secrets and keys
| Rule | Level | Status | Evidence or gap |
|---|---|---|---|
| KEY-01 | MUST | Met | The app holds no cloud keys |
| KEY-02 | SHOULD | Open | Staging uses a database password set by a person and stored in Vercel; IAM auth comes with the platform |
| KEY-03 | MUST | Open | `DATABASE_URL` must be created as "Sensitive" in Vercel `[pending: Yamil, at deploy]` |
| KEY-04 | MUST | Partial | TLS required to the database outside localhost. Encryption at rest is the provider's; KMS comes with the platform |
| KEY-05 | MUST | Open | Depends on ADR-002 |

## Reliability
| Rule | Level | Status | Evidence or gap |
|---|---|---|---|
| REL-01, REL-02, REL-05 | SHOULD | Open | SLO, alerts, RPO and RTO `[pending: Dan]` |
| REL-03, REL-04 | MUST | Open | Multi-AZ and tested restores come with the production platform |
| REL-06 | MUST | Partial | Outbox written in the same transaction as the change, insert only, with a versioned event catalog (`docs/contracts/domain-events-v1.md`). Publisher job built (fan-out per subscriber, signature, idempotent by event id). Real HTTP delivery is an adapter that stays off until the transport is approved |
| REL-07 | MUST | Met | Idempotency keys for forms, Sales App events and S5 files (DB and E2E tests) |
| REL-08 | MUST | Partial | Outbound: retries after 1, 5, 30 and 120 minutes, dead letters on the fifth failure, manual resend. Inbound (Sales App): messages outside the contract and messages for unknown stores are kept with a reason and can be reprocessed. Exercised with the simulated adapter only: no live subscriber yet |
| REL-09 | MUST | Partial | Per-market flags exist (`close_by_transaction`); down migrations tested. No rehearsed rollback by a second person |
| REL-10 | MUST | Partial | Schema, unique key, non-negative amounts, ±20% row band with quarantine, checksum (DB test). No manifest file |

## Performance
| Rule | Level | Status | Evidence or gap |
|---|---|---|---|
| PERF-01 | MUST | Not yet | Budgets not measured |
| PERF-02 | MUST | Met | Keyset pagination on merchants, leads and audit (E2E test) |
| PERF-03 | SHOULD | Not yet | No query budget in CI |
| PERF-04 | MUST | Partial | Transaction-scoped identity, no prepared statements. Pooler behavior under load not verified |
| PERF-05 | MUST | Partial | `pg_trgm` GIN index on normalized names; search by phone and alias. No FTS; no fiscal ID search |
| PERF-06 | SHOULD | Partial | UUID v7 keys keep partitioning possible; not partitioned |
| PERF-07 | MUST | Not yet | No load test (100K merchants, 1M activities) |
| PERF-08 | MUST | Met | `vercel.json` pins functions to `cle1` (us-east-2), the region of the staging database. The standard names us-east-1; the Supabase project was created in us-east-2 |

## Observability
| Rule | Level | Status | Evidence or gap |
|---|---|---|---|
| OBS-01 | MUST | Partial | Errors are logged as JSON without PII or payloads. No request-wide structured log with pseudonymous user and market |
| OBS-02 | SHOULD | Not yet | No tracing |
| OBS-03 | MUST | Partial | The database writes the log: a trigger on every `crm` table copies each change to the `audit` schema with who, channel and request id; nobody can edit it (DB test). Exports, searches, reveals of restricted data and reads with an API key are counted in `audit.read_log` with alerts. The copy outside the database is built and off (`AUDIT_ARCHIVE_ADAPTER`); list views of personal data are not logged (ADR-008) |
| OBS-04 | SHOULD | N/A | Applies to Option 3 |
| OBS-05 | MUST | Partial | Active days and actions per person, on-time lead response, days to first sale. No weekly series |
| OBS-06 | SHOULD | Open | `[pending: Legal]` |

## Operations
| Rule | Level | Status | Evidence or gap |
|---|---|---|---|
| OPS-01 | MUST | Not yet | Staging resources were created through the provider consoles and connectors, not as code |
| OPS-02 | MUST | Open | Infrastructure specification for Squad 6 |
| OPS-03 | MUST | Partial | Local dev and test databases plus staging. No production |
| OPS-04 | MUST | Partial | CI workflow and PR template in the repo. Branch protection with two reviewers `[pending: repo admins]` |
| OPS-05 | MUST | N/A | No production deploys |
| OPS-06 | MUST | Partial | Versioned, reversible migrations. Expand-and-contract discipline starts with the first change after this PR |
| OPS-07 | MUST | N/A | No cloud resources defined as code |
| OPS-08 | MUST | Partial | Built by a Claude Code agent against local databases with synthetic data. Exception recorded in ADR-005: staging loads current Pipedrive data through an import that runs inside the application, so records do not pass through the agent. Secrets are set by a person. On 11-Nov-2026 a malformed `DATABASE_URL` made the driver print the staging database password in the host's runtime log, which the agent read while diagnosing; the password was rotated and the env schema now rejects a malformed URL before it reaches the driver (unit test) |
| OPS-09 | MUST | Open | No separate email was sent. Sign-off on the staging stack, and on loading current Pipedrive data into it (ADR-005), is requested through this pull request |

## Compliance and AI
| Rule | Level | Status | Evidence or gap |
|---|---|---|---|
| COMP-01, COMP-03, COMP-04 | MUST | Open | Residency opinion, subprocessor register, incident matrix `[pending: Legal]` |
| COMP-02 | MUST | Partial | `crm.consents` per contact or lead, channel and purpose, with evidence and date; opt-outs in `crm.contact_suppressions`; every outside send asks `app.may_contact` (DB test). The privacy notice version per market is still empty `[pending: Legal]` |
| COMP-05 | MUST | Open | SOX scope depends on whether the CRM feeds commissions |
| COMP-06 | SHOULD | Not yet | |
| AI-01 | MUST | N/A | No model calls |

# Engineering Standard v1: compliance of this PR

Source: `axexo-CONTIGO-Estandar-Ingenieria-v1-2026-11-11`. Status as of 13-Nov-2026, on `design-v1` after integration 95-7 (migrations 0001 to 0042: waves 1 to 3, wave 4 `ciclo-cs` 0031, `campo-canal` 0032, `partners-contratos` 0033, `ia` 0034, `integraciones-migracion` 0035 and `integraciones2` 0036, wave 6 `datos2` 0037, `embudo2` 0038, `campo2` 0039 and `reportes2` 0040, and wave 7 `conectores` 0041 and `plataforma` 0042). Staging may hold current Pipedrive data under ADR-005, which is still unsigned; development and CI use synthetic data.

**Met** = implemented and covered by a test or a file you can open. **Partial** = part of the rule is in place; the gap is stated. **Not yet** = not built. **Open** = needs a decision or an owner outside this repository. **N/A** = the thing the rule governs does not exist here yet.

Summary: 28 Met, 31 Partial, 6 Not yet, 16 Open, 5 N/A, out of 86 rules (after integration 95-2: AUTHZ-09 moved from Not yet to Partial).

## What integration 95-7 changed (13-Nov-2026)
| Rule | Change |
|---|---|
| AUTHZ-03 | 15 new tables from wave 7 (0041, 0042), all with RLS forced (268 tables, 740 policies) |
| Adapters (Tech Implementation Review) | Every adapter has a written `live` mode that turns on only with three things: its variable set to `live`, the provider credentials and `<VARIABLE>_APPROVAL` with the written sign-off reference. One gate (`src/server/adapters/live/gate.ts`) and one registry (`src/server/adapters/registry.ts`) cover all of them, including the wave 6 ones (scheduled reports to Slack, feedback digest to P&T, Academy progress, lakehouse cross-match) and live screens (Broadcast). `docs/adapters.md` is the sign-off annex; `.env.example` lists names without values. A DB test fails if an adapter file is not in the registry |
| AI-02 / IA-07 (egress) | One server-side `fetch`: `egressFetch` (`src/server/net/egress.ts`). The connector HTTP client goes through it, so every live connector is checked against the closed allowlist plus its own provider hosts; contract services take their host only from the operator-set URL variable. The network-level control on the platform stays an operator step (`docs/egress.md`) |
| AUT-02 | Event delivery reads the outbox by committed transaction id (`txid`, no 2 s gap); notices are fed from the outbox by rules; browser push is a channel of the single notice service |
| Proposed values | Platform values and recovery objectives without a figure join the single proposed values list in CONTIGO status |
| MIG | 0042 adds stored generated `search_tsv` columns to `accounts`, `leads` and `deals` and a `txid` column with a volatile default to `outbox_events`: each rewrites its table (fine at current volumes; on large tables run in a maintenance window). 0041 only relaxes status checks and adds columns. Cycle reset, down to 0018 and up checked |

## What integration 95-6 changed (13-Nov-2026)
| Rule | Change |
|---|---|
| AUTHZ-03 | 19 new tables from wave 6 (0037 to 0040), all with RLS forced (253 tables, 717 policies) |
| AUTHZ (roles) | One Finance role (`datos2` and `reportes2` each created it): reads its reports, does no commercial work (no merchant edits, no activities), and changes owners, merges and bulk edits only in markets where the business decision `ops.operator_rights` is on. The database repeats it: `app.write_markets()` gives Finance a market only through `app.operator_markets()`. New KAM role sells and holds key accounts. DB test `integracion-95-6` |
| DATA (one model per concept) | One lead time zone column and one business clock: `app.business_due(market, from, minutes, zone)` with market holidays and a safe fallback for an unknown zone (the `business_due_tz` copy was removed); one exception kind constraint carrying the kinds of `embudo2`, `campo2` and `reportes2`; one saved views entry on the deals board |
| Proposed values | Decisions, pipeline values, field thresholds and board settings stay where each package keeps them; CONTIGO status shows them in one list (`src/dal/proposed.ts`), each with its owner and where it is changed |
| MIG | 0037 moves duplicate contact phones to `held_phone` before the unique index and backfills legal entities on contracts and leads; 0038 backfills `leads.first_contact_at` and assigns an owner to automations without one; 0039 routes open exceptions without owner. All set-based, no renames; each has its `.down.sql`, cycle reset, down to 0018 and up checked |
| Adapters | New adapters of wave 6 (report Slack channel, snapshot file, billing, Academy progress, feedback to P&T, lakehouse crossmatch) are off and listed on CONTIGO status with what is missing |

## What integration 95-4 changed (13-Nov-2026)
| Rule | Change |
|---|---|
| AUTHZ-03 | 76 new tables from wave 4, all with RLS forced; the partner user reads only its subtree (DB test `integracion-95-4`: no merchant care alert outside it) |
| AI-01, AI-02 | One AI adapter (`AI_ADAPTER`, off; egress allowlist `AI_EGRESS_ALLOWLIST`, closed answers, quoted outside text). The account review draft of Merchant care no longer has its own switch. No model calls |
| OPS (jobs) | One run log: data loads are runs of the job runner (`crm.job_runs` with `load_key`; one running load at a time enforced by a unique index); `crm.load_runs` is only a view |
| Adapters | Every external adapter of wave 4 is off and listed on CONTIGO status with what is missing to turn it on; one document vault (`CONTIGO_DOCUMENT_VAULT`) for enrollment files and generated documents |
| DATA (one model per concept) | One balance (view joining the funding feed and care signals) and one low balance rule; one agency create path; one writer of the per-role legal entity limit; one `app.people_with_role`; unused `market_comms` WhatsApp columns dropped |

## What this pass changed (13-Nov-2026, package `gobierno`)
The previous version was dated 11-Nov-2026 and had fallen behind the code. Corrected, control by control:

| Rule | Was | Now | Why |
|---|---|---|---|
| AUTHZ-03 | Met, "36 tables" | Met, 158 tables and 453 policies | Counted on a freshly migrated database after integration 95-2 |
| AUTHZ-05, DATA-11 | "the app role has no `DELETE`" | No `DELETE` on business records; 11 configuration tables listed | The grant exists on configuration and preference tables |
| SEC-07 | Met, "there are no exports" | Met, exports governed | Seven export routes with reason, cap per role, daily alert and audit |
| DATA-08 | Partial, "no owner or review date per field, no editor" | Partial, with owner, decision, review date and editor | Package `datos`; what is still missing is stated |
| REL-01, REL-02, REL-05 | Open | Partial | Measured in the product with an alert; values and RPO and RTO still pending |
| PERF-01 | Not yet | Partial | Response time measured; no budget set |
| OBS-01 | Partial | Partial, request identifier end to end | Migration 0028 |
| OBS-02 | Not yet | Partial | Traces adapter built and turned off |
| OBS-05 | Partial, "no weekly series" | Partial, weekly series exists | Package `reportes` |
| COMP-02 | Not yet | Partial | Consent on web leads and on templates |
| REL-03, REL-04, REL-09, OBS-03, OPS-04, OPS-05, OPS-09, COMP-04, SEC-02, SEC-12, AUTHZ-08, DATA-06 | | Same status, evidence updated | Runbooks, restore test record, go-live checklist, deployment record, incident log |
| AUTHZ-09 | Not yet | Partial | Integration 95-2 (`seguridad`): directory adapter off, unused-access report and access review signed off by the market lead |
| OBS-03, COMP-02, DATA-06 | | Same status, evidence updated at integration 95-2 | Database-written log with the request identifier, consent register, one fiscal ID model |

How it was checked: counts taken from a database migrated from zero on 13-Nov-2026; grants read from the database catalog; every file cited in a changed row exists in the tree and was read or searched for the behavior described. The text of the standard is not in this repository, so the status of each rule follows the evidence in the code against the rule as this document already described it. Rows not listed above were carried over as they were and not re-verified one by one in this pass; rows already updated by the packages `eventos-api` (SEC-06, REL-06, REL-08) were kept.

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
| DATA-06 | MUST | Partial | No full fiscal ID is stored. One fiscal ID model (`crm.tax_ids`, package `mercados`): format and check digit, registry check (adapter off) and human review; it keeps the last 4, a keyed fingerprint to find repeats and the verification state, and the full value goes only to the protected-data adapter, which is off (`PROTECTED_DATA_ADAPTER`). The US dealer record (package `us-ficha`) uses the same model; keeping the full value needs a written exception `[pending: Michael Essiet or Dan Mulligan]`. The Pipedrive import keeps only the last 4 characters of `Tax ID` and drops fields that look like account, card or password fields, before the raw copy is written (DB test). The test data generator (`scripts/synthetic-lib.mjs`) builds a tax ID with a valid format and also stores only its last 4 characters (DB test). Encryption with KMS comes with the platform |
| DATA-07 | SHOULD | Not yet | Addresses are plain columns, not per-market validated `jsonb` |
| DATA-08 | MUST | Partial | `crm.field_definitions` + `custom jsonb`. Each field carries its owner, purpose, the decision it enables, a review date, a personal data class and an untrusted mark when it was imported; market leads propose and administration approves; definitions are edited in Data, Fields (package `datos`, migration 0023). A field can be linked to the change request that asked for it and the written decision is kept as the reason for the change (migration 0028). Missing: value validation with JSON Schema, and creating contact and activity fields from the screen |
| DATA-09 | SHOULD | Met | `app.uuid_v7()` default on every table (DB test). Synthetic seed rows use deterministic IDs |
| DATA-10 | SHOULD | Not yet | No `export_market` script |
| DATA-11 | MUST | Partial | Business records are never hard-deleted: the app role has no `DELETE` on merchants, contacts, leads, deals, activities or the audit log; merges archive and can be undone. `DELETE` is granted on 11 tables of configuration, preferences and working copies (`automation_state`, `deal_items`, `help_lessons`, `import_raw`, `rollout_key_people`, `saved_reports`, `saved_view_pins`, `saved_views`, `team_champions`, `training_materials`, `user_territories`), counted on 13-Nov-2026. Retention and purge `[pending: Legal]` |
| DATA-12 | MUST | Met | Transactional figures arrive as daily aggregates from S5; the CRM stores no transactions |

## Identity and authorization
| Rule | Level | Status | Evidence or gap |
|---|---|---|---|
| AUTHZ-01 | MUST | Partial | Google OIDC through the adapter, domain enforced server-side. Needs the OAuth client configured in staging to be exercised end to end; MFA is an IdP policy `[pending: Workspace admin]` |
| AUTHZ-02 | MUST | Met | `crm.memberships`, `crm.user_territories`, `ancestor_ids`; no claims |
| AUTHZ-03 | MUST | Met | RLS enabled and forced on all 268 tables of schema `crm` (740 policies), counted on a freshly migrated database on 13-Nov-2026 (migrations 0001 to 0042). The two views added in wave 4 (`crm.account_balance_latest`, `crm.load_runs`) run as the caller (`security_invoker`), so the policies of their tables apply. `tests/db/permissions.test.ts` fails if any table lacks it and each package repeats the check for its own tables |
| AUTHZ-04 | MUST | Met | `withUser` in `src/server/db.ts`; `app.current_user_id()` |
| AUTHZ-05 | MUST | Met | `contigo_app` has no BYPASSRLS and owns nothing (DB test; counted again on 13-Nov-2026). It has no `DELETE` on business records; DATA-11 lists the 11 configuration tables where it does |
| AUTHZ-06 | MUST | Met | Scope functions wrapped in `(select …)`; indexes on `owner_id`, `territory_id`, `market_code`, GIN on `ancestor_ids` |
| AUTHZ-07 | MUST | Partial | Lists and search filter by market explicitly; detail pages rely on RLS plus the record ID |
| AUTHZ-08 | MUST | Met | `tests/db/permissions.test.ts`: 21 tests, allowed and denied per role × object × action, as the app role. Each package adds the denied cases for its own tables and actions (31 files under `tests/db`) |
| AUTHZ-09 | MUST | Partial | Directory sync is built as an adapter and off (`DIRECTORY_ADAPTER`, job `seguridad.directorio`): it needs a read-only directory service account and its approval. Meanwhile: unused access report, periodic access review signed off by the market lead, expiry dates, and sessions that expire within 12 h (ADR-008) |
| AUTHZ-10 | MUST | Met | No external users |

## Application security
| Rule | Level | Status | Evidence or gap |
|---|---|---|---|
| SEC-01 | MUST | Open | ASVS 5.0 L2 is the target; no assessment has been run |
| SEC-02 | MUST | Met | `runAction`, `apiHandler` and `apiRead` authenticate; domain commands authorize and validate with zod |
| SEC-03 | MUST | Met | No `NEXT_PUBLIC_` variable exists |
| SEC-04 | MUST | Open | Patch policy needs an owner `[pending: Engineering]` |
| SEC-05 | MUST | Met | CSP with per-request nonce, HSTS, `frame-ancestors 'none'`, Referrer-Policy, Permissions-Policy (E2E test). `style-src` allows inline styles |
| SEC-06 | MUST | Partial | Rate limiting in the database (sliding window, `app.rate_hit`): API per key and per IP with `429` and `Retry-After`, failed keys per IP, public forms per IP and per form (views and submissions), minimum fill time, trap field and page key. Not yet: searches inside the app, an edge limit, and the live anti-bot service (adapter built, off) |
| SEC-07 | MUST | Met | Exports exist since package `eventos-api` and are governed in one place (`src/domain/exports.ts`): each of the 7 export routes asks for a reason, applies a row cap per role (sales reps have none and cannot export), counts against a daily threshold that notifies administration, and writes an audit event with the reason and the filters. The earlier line "there are no exports" no longer applied |
| SEC-08 | MUST | Partial | `scripts/scan-prohibited.mjs` scans the repo in CI and free-text columns with `--db`. At write time: card numbers and SSNs are removed from imported notes and refused in custom text fields (unit and DB tests). Not yet applied to every free-text input |
| SEC-09 | MUST | Partial | Frozen lockfile, Dependabot, secret scan in CI. SAST and license check not configured |
| SEC-10 | SHOULD | Open | Google Workspace policy |
| SEC-11 | MUST | Open | Pentest before widening users |
| SEC-12 | MUST | N/A | No AI features yet. Package `ia` of the build program has not been integrated; its model adapter ships turned off |

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
| REL-01, REL-02, REL-05 | SHOULD | Partial | Since migration 0028 CONTIGO measures availability and the 95th percentile of response time per screen, per saved change and per API call, and shows them on the status page and in Administration, Governance. A scheduled job notifies administration once per objective and day when one is not met. The objective values are set by a person and none is set yet. RPO, RTO and restore test frequency are fields that refuse a value without who agreed to it and when: `[pending: Dan Mulligan]` |
| REL-03, REL-04 | MUST | Open | Multi-AZ and point-in-time recovery come with the production platform (ADR-002). What exists: the runbook `docs/runbooks/respaldo-y-restauracion.md` and the on-screen record of restore tests, which is empty because no restore has been tested |
| REL-06 | MUST | Partial | Outbox written in the same transaction as the change, insert only, with a versioned event catalog (`docs/contracts/domain-events-v1.md`). Publisher job built (fan-out per subscriber, signature, idempotent by event id). Real HTTP delivery is an adapter that stays off until the transport is approved |
| REL-07 | MUST | Met | Idempotency keys for forms, Sales App events and S5 files (DB and E2E tests) |
| REL-08 | MUST | Partial | Outbound: retries after 1, 5, 30 and 120 minutes, dead letters on the fifth failure, manual resend. Inbound (Sales App): messages outside the contract and messages for unknown stores are kept with a reason and can be reprocessed. Exercised with the simulated adapter only: no live subscriber yet |
| REL-09 | MUST | Partial | Flags per market and per pipeline; down migrations tested (cycle `reset`, `down`, `up` on seeded data); runbook `docs/runbooks/despliegue-y-vuelta-atras.md`; technical owner and backup per component recorded on screen, with no names yet `[pending: Dan Mulligan]`; a release cannot be marked as released without its go-live checklist. No general flag mechanism per role, and no rollback rehearsed by a second person |
| REL-10 | MUST | Partial | Schema, unique key, non-negative amounts, ±20% row band with quarantine, checksum (DB test). No manifest file |

## Performance
| Rule | Level | Status | Evidence or gap |
|---|---|---|---|
| PERF-01 | MUST | Partial | Response time is measured since migration 0028: per screen in the person's browser, and per saved change and API call on the server (95th percentile from a histogram). No budget is set: the objective values are `[pending: Dan Mulligan]` |
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
| OBS-01 | MUST | Partial | Every request carries an identifier from the proxy to the database transaction: it is stored on audit events and on error records, returned by the API in `x-request-id` and shown to the person as a short reference when something fails on our side (DB and E2E tests). Errors are logged as JSON without PII or payloads. No request-wide structured log with pseudonymous user and market shipped to a log tool |
| OBS-02 | SHOULD | Partial | The traces adapter (`src/server/adapters/traces.ts`) receives one span per request and is turned off (`TRACES_ADAPTER`). No tracing tool is connected; connecting one is new technology and needs the Tech Implementation Review |
| OBS-03 | MUST | Partial | The database writes the log: a trigger on every `crm` table copies each change to the `audit` schema with who, channel and request id; nobody can edit it (DB test). Exports, searches, reveals of restricted data and reads with an API key are counted in `audit.read_log` with alerts. The copy outside the database is built and off (`AUDIT_ARCHIVE_ADAPTER`); list views of personal data are not logged (ADR-008). Every database row change also carries the request identifier of its entry (package `gobierno`) |
| OBS-04 | SHOULD | N/A | Applies to Option 3 |
| OBS-05 | MUST | Partial | Active days and actions per person, on-time lead response, days to first sale, and a weekly usage series per person and team (package `reportes`). The rollout metric is a default proposal that the market leads have not confirmed |
| OBS-06 | SHOULD | Open | `[pending: Legal]` |

## Operations
| Rule | Level | Status | Evidence or gap |
|---|---|---|---|
| OPS-01 | MUST | Not yet | Staging resources were created through the provider consoles and connectors, not as code |
| OPS-02 | MUST | Open | Infrastructure specification for Squad 6 |
| OPS-03 | MUST | Partial | Local dev and test databases plus staging. No production |
| OPS-04 | MUST | Partial | CI workflow and PR template in the repo. The template now carries the go-live checklist (Tech Implementation Review, engineering standard, guide updated in the same change), mirrored on screen per release. Branch protection with two reviewers `[pending: repo admins]` |
| OPS-05 | MUST | N/A | No production deploys. The record is ready for them: CONTIGO notes by itself the commit it is running, and administration adds who deployed and how it ended (Administration, Governance, Deployments) |
| OPS-06 | MUST | Partial | Versioned, reversible migrations. Expand-and-contract discipline starts with the first change after this PR |
| OPS-07 | MUST | N/A | No cloud resources defined as code |
| OPS-08 | MUST | Partial | Built by a Claude Code agent against local databases with synthetic data. Exception recorded in ADR-005: staging loads current Pipedrive data through an import that runs inside the application, so records do not pass through the agent. Secrets are set by a person. On 11-Nov-2026 a malformed `DATABASE_URL` made the driver print the staging database password in the host's runtime log, which the agent read while diagnosing; the password was rotated and the env schema now rejects a malformed URL before it reaches the driver (unit test) |
| OPS-09 | MUST | Open | No separate email was sent. Sign-off on the staging stack, and on loading current Pipedrive data into it (ADR-005), is requested through this pull request. From migration 0028 on, the Tech Implementation Review is the first item of every release's go-live checklist and a release cannot be marked as released without its evidence |

## Compliance and AI
| Rule | Level | Status | Evidence or gap |
|---|---|---|---|
| COMP-01, COMP-03, COMP-04 | MUST | Open | Residency opinion, subprocessor register, incident matrix `[pending: Legal]`. The product now keeps an incident log (Administration, Governance, Service) and shows the data region per market; neither replaces the legal documents |
| COMP-02 | MUST | Partial | `crm.consents` per contact or lead, channel and purpose, with evidence and date; opt-outs in `crm.contact_suppressions`; every outside send asks `app.may_contact` (DB test). The privacy notice version per market is still empty `[pending: Legal]` |
| COMP-05 | MUST | Open | SOX scope depends on whether the CRM feeds commissions |
| COMP-06 | SHOULD | Not yet | |
| AI-01 | MUST | N/A | No model calls: the single AI adapter is off and the rules version answers (package `ia`) |

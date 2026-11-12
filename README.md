# axexo CONTIGO

In-house CRM for axexo. Web app that works with the existing Sales App: the Sales App records visits, S5 reports transactions, CONTIGO owns leads, pipelines, the account tree, attribution and follow-up.

**Status: staging candidate.** Local development and CI use synthetic data only. Staging can load the current Pipedrive data for US and MX through a read-only import (decision and limits in `docs/adr/ADR-005-pipedrive-data-in-staging.md`). Production platform is an open decision (see `docs/adr/ADR-002-platform.md`).

## How it is built

```
Browser ──HTTPS──> Next.js (App Router, server-rendered, output: standalone)
                     │  src/app        pages, server actions, /api/v1 route handlers
                     │  src/domain     the only place business rules live (AUT-01)
                     │  src/dal        read queries, return DTOs (PORT-01)
                     │  src/server     db connection, request context, adapters
                     ▼
                   PostgreSQL  schema "crm" (tables, FORCE RLS) + schema "app" (identity and scope functions)
```

- The browser never talks to the database (PORT-02). There is no client-side data SDK and no `NEXT_PUBLIC_` variable.
- Every query runs inside a transaction that sets `app.user_id`; row-level security decides which rows exist for that person (AUTHZ-03, AUTHZ-04).
- The app connects as `contigo_app`, a role with no `BYPASSRLS`, no table ownership and no `DELETE` on business tables (AUTHZ-05).
- Every business change writes an audit event and an outbox event in the same transaction (OBS-03, REL-06).
- Provider-specific pieces sit behind adapters (`src/server/adapters`). Staging uses Supabase Auth only as an OIDC broker for Google Workspace.

## Run it locally

Requirements: Node 22+, pnpm 10+, PostgreSQL 16+.

```bash
pnpm install
cp .env.example .env.local            # set DATABASE_URL and MIGRATION_DATABASE_URL
createdb contigo_dev
pnpm db:migrate                        # versioned SQL in db/migrations (up/down)
pnpm db:seed                           # synthetic data for MX and US (never in production)
pnpm dev
```

With `DEMO_PERSONAS=1` the login screen lists synthetic personas (admin, leadership, market lead, supervisor, rep, operations) so permissions can be reviewed role by role. The env schema refuses that flag when `APP_ENV=production`, and the database refuses persona sessions unless the `demo_personas` setting is on.

## Checks

| Command | What it proves |
|---|---|
| `pnpm typecheck` / `pnpm lint` | Types and lint |
| `pnpm test` | 383 tests in 30 files: unit tests for rules and wording, plus allowed/denied tests per role × object × action and domain tests against a real Postgres (AUTHZ-08). The database is migrated and seeded once per run and kept as a template (`<database>_tpl`); every file of `tests/db` starts from a fresh copy of it, so files do not depend on each other or on their order. The migration user needs the right to create databases |
| `pnpm build && pnpm e2e` | 282 end-to-end tests in 22 files against the standalone build: the business flows, a full Pipedrive import against a simulated API, and every screen at 1440, 1024 and 390 px with accessibility checks (axe, WCAG 2.2 AA tags) |
| `pnpm scan:prohibited` | No cards, SSNs, keys or connection strings in the repo; `--db` scans free-text columns (SEC-08) |

## Changes after committee 2 (waves 1 to 3) / Cambios después del comité 2 (olas 1 a 3)

The second committee (11-Nov-2026) walked the app as the real teams. Its findings were built in three waves of packages and integrated on `rc/olas-1-3`. Reasons, tables and the full list are in `docs/adr/ADR-006-design-v1-1.md`.

**By package.** Wave 1: `diseno` (entry page, first sign-in, help), `campo` (the visit as an activity, street work), `reparto` (distribution of the book by place or territory), `admin` (lead routing, web lead origin and consent, audit filters, status page). Wave 2: `leads` (conversion, business-hours clock, lead list, pass or release a lead), `liderazgo` (closed deals with CSV export, Leadership panel, adoption, Mi equipo, weekly field report, one home screen per role), `operaciones` (orders with lines, handoff and Operations queue, return with a reason, notices, bulk close, win by hand), `b2b` (account types and hierarchy, fields by sale type, manageable stages, on hold, loss reasons by sale type), `contenido` (report a problem, help and first steps). Wave 3: `vocabulario` (one vocabulary in Spanish and English, `docs/glosario.md`), `contenido2` (help, training and entry page up to date) and the final integration (the guide under the same vocabulary test, "s/d" and "n/a" for a missing value, next-step list enforced in the domain, board filters folded on phones, screenshots retaken).

**Migrations 0009 to 0017** (each with its `.down.sql`; the ones marked with * create or replace row-level policies):

| Migration | What it adds |
|---|---|
| `0009_onboarding` * | Each person's first-steps list (one policy: own row). |
| `0010_field_work` | Visit as an activity kind; `crm.visit_log` counts Sales App and hand-logged visits once. |
| `0011_distribution` * | Current owner per market, place and territory; read and update policies of merchants and leads are replaced so supervisors see and move records with no current owner. |
| `0012_admin_controls` | Routing only to people who can sell in the market, web lead origin and consent date, audit indexes, status function. |
| `0013_leads` * | Account type and contact role on the lead, business hours per market (three policies on the new table), pass or release a lead, search for records carried by others. |
| `0014_leadership` | Who loaded the exchange rate and when, adoption counts, indexes for closed deals. |
| `0015_operations` * | Order pipelines with lines, Operations stages and second owner, Operations catalogs, checks and notices (ten policies), separation of duties as a trigger. |
| `0016_b2b` * | Account type catalog (three policies), fields by sale type, archived stages, on hold, loss reasons by sale type. |
| `0017_problem_reports` * | Problem reports and administration's answer (three policies). |

**Counts on the release candidate:** 383 vitest tests in 30 files (green twice in a row and with shuffled file order), 282 end-to-end tests in 22 files, and the migration cycle `reset`, nine times `down`, `up` on seeded data with the same row counts before and after.

**Decisions taken by default, to be confirmed by Yamil** (detail in ADR-006): a seller can pass their own lead to a teammate; one next-step sheet and one rule; business hours Monday to Friday 9:00 to 18:00 until administration changes them; a returned deal arrives as a task in Hoy; supervisors and market leads appear in Mi equipo only if they carry records; Operations reads the audit log and the alerts of its markets; anyone with access can report a problem; "s/d" and "n/a" mark a missing value.

## Where to look

- `docs/standard-compliance.md`: every rule of the Engineering Standard v1 with its status and evidence.
- `docs/scope.md`: which catalog features are in this PR and which are not.
- `docs/adr/`: architecture decisions, including the two that are still open.
- `docs/contracts/`: proposed v1 contracts for Sales App events, the S5 daily file and web forms.
- `docs/pipedrive-migration.md`: how the Pipedrive import works, what maps to what and what is not migrated.
- `docs/adr/ADR-006-design-v1-1.md`: the design handoff as built, the product rules it introduced, what the second committee changed (waves 1 to 3) and what was left out.
- `docs/glosario.md`: the product vocabulary in Spanish and English, guarded by `tests/unit/vocabulario.test.ts` and `tests/e2e/zx-vocabulario.spec.ts`.

## Not in this repository yet

Infrastructure as code, the outbox publisher, rate limiting, fiscal ID capture and encryption, consent records, AI features, and any live integration other than the read-only Pipedrive import. Each one is listed with its rule ID in `docs/standard-compliance.md`.

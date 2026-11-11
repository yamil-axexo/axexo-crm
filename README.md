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
| `pnpm test` | Unit tests for rules, plus allowed/denied tests per role × object × action and domain tests against a real Postgres (AUTHZ-08) |
| `pnpm build && pnpm e2e` | 109 end-to-end tests against the standalone build: the business flows, a full Pipedrive import against a simulated API, and every screen at 1440, 1024 and 390 px with accessibility checks (axe, WCAG 2.2 AA tags) |
| `pnpm scan:prohibited` | No cards, SSNs, keys or connection strings in the repo; `--db` scans free-text columns (SEC-08) |

## Where to look

- `docs/standard-compliance.md`: every rule of the Engineering Standard v1 with its status and evidence.
- `docs/scope.md`: which catalog features are in this PR and which are not.
- `docs/adr/`: architecture decisions, including the two that are still open.
- `docs/contracts/`: proposed v1 contracts for Sales App events, the S5 daily file and web forms.
- `docs/pipedrive-migration.md`: how the Pipedrive import works, what maps to what and what is not migrated.
- `docs/adr/ADR-006-design-v1-1.md`: the design handoff as built, the product rules it introduced and what was left out.

## Not in this repository yet

Infrastructure as code, the outbox publisher, rate limiting, fiscal ID capture and encryption, consent records, exports, AI features, and any live integration other than the read-only Pipedrive import. Each one is listed with its rule ID in `docs/standard-compliance.md`.

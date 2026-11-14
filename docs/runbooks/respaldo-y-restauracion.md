# Runbook: backup and restore (GOB-07, REL-02 to REL-05)

Owner of this runbook: `[pending: Dan Mulligan]` (technical owner of the "Database and backups" component; the name is recorded in Administration, Governance, Releases). Backup: `[pending: Dan Mulligan]`.

Backups, point-in-time recovery and the restore itself belong to the platform that hosts the database, not to CONTIGO. CONTIGO does three things: it tells what has to be backed up, it keeps the record of every restore test on screen (Administration, Governance, Service, "Restore tests"), and it shows what was agreed (RPO, RTO, test frequency) with who agreed to it and when. Nothing in this file is a number someone agreed to: every figure that needs a decision is marked `[pending: who]`.

## 1. What is backed up

| What | Where it lives | How it is recovered |
|---|---|---|
| All business data, configuration, audit log, outbox, governance records | One PostgreSQL database, schemas `crm` and `app` | Platform backup with point-in-time recovery (this runbook) |
| Schema and row-level security | The same database; source of truth in `db/migrations/*.sql` (each with its `.down.sql`) | Restored with the database; can also be rebuilt with `node scripts/migrate.mjs up` |
| Application code | Git repository | Redeploy the commit recorded in Governance, Deployments |
| Environment variables and secrets | The host's secret store, set by a person | Not in the backup and never in the repository. The list of names is in `.env.example`; values are re-entered by the owner |
| Files | None. CONTIGO stores no files: attachments are an adapter that is turned off | n/a |
| Sign-in | The identity provider (Google Workspace through the OIDC broker) | Not backed up by CONTIGO; people and memberships live in `crm.users` and `crm.memberships`, inside the database |

Never part of a backup export handled by hand: full official IDs, bank accounts, cards or passwords. CONTIGO does not store them (`src/domain/guard.ts`), so a backup does not carry them.

## 2. How often, and how much can be lost

| Agreement | Value | Who agrees |
|---|---|---|
| RPO (most data that can be lost) | `[pending: Dan Mulligan]` | CPTO |
| RTO (longest time until service is back) | `[pending: Dan Mulligan]` | CPTO |
| Backup frequency and retention | `[pending: Dan Mulligan]` | CPTO, with Squad 6 |
| Point-in-time recovery enabled on production | `[pending: Dan Mulligan]` (production platform is open, ADR-002) | CPTO |
| Restore test frequency | `[pending: Dan Mulligan]` (the catalog proposes quarterly; not agreed) | CPTO |
| Backup configuration of the current staging project | Not verified. `[pending: Dan Mulligan / Michael Essiet]` | Whoever administers the staging database |
| Data residency per market | `[pending: Legal]` (COMP-01) | Legal |

When a value is agreed, an administrator records it in Administration, Governance, Service, "Recovery": the screen asks for the value, the full name of who agreed and the date, and refuses a recovery objective without them.

## 3. How to restore

Do this with two people: one runs, one checks. Never restore over the live database as a first step.

1. **Open an incident** in Administration, Governance, Service (title, severity, when it started, who is affected). If CONTIGO itself is down, write it down elsewhere and record it as soon as it is back.
2. **Decide the point in time.** Take the timestamp just before the damage. The audit log reference shown to the person who reported the problem (the 8-character code on the error screen) finds the request in Governance, Service, "Unexpected errors".
3. **Restore to a new database**, not over the damaged one, with the platform's point-in-time recovery to that timestamp. Exact console steps: `[pending: Dan Mulligan]` (they depend on the production platform chosen in ADR-002).
4. **Check the restored database before sending anyone to it** (connection of the schema owner):
   - `node scripts/migrate.mjs status` lists every migration of the deployed commit as applied.
   - `select count(*) from crm.accounts; select count(*) from crm.deals; select max(at) from crm.audit_events;` The last audit event is close to the chosen point in time.
   - `select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'crm' and c.relkind = 'r' and not (c.relrowsecurity and c.relforcerowsecurity);` returns no rows (every table keeps forced row-level security).
   - The role `contigo_app` exists, has no `BYPASSRLS` and owns no table.
5. **Point the application at the restored database** (the two connection variables on the host), redeploy the same commit, and check `/api/health` and the status page.
6. **Tell the teams** what was lost between the point in time and the incident, if anything, with an announcement.
7. **Close the incident** with cause, actions and resolution time. The screen refuses to close it without them.

## 4. How the restore is tested

A backup that was never restored does not count. The test is the same procedure, steps 3 and 4, against a scratch database that is deleted afterwards.

1. Pick a point in time from the last 24 hours.
2. Restore to a scratch database and time it from start to "checks pass".
3. Run the checks of step 4. Additionally compare with the source: row counts of `crm.accounts`, `crm.deals`, `crm.leads`, `crm.activities` and `crm.audit_events` up to the chosen timestamp.
4. Delete the scratch database.
5. An administrator records the test in Administration, Governance, Service, "Restore tests": date, environment, who ran it, minutes it took, result (restored correctly or failed) and where the evidence is (ticket or run, no passwords). A failed test is recorded too and opens an incident.

The record starts empty. The status page shows "Last tested restore: To be defined" until the first test that went well.

## 5. What CONTIGO measures meanwhile

- Availability, response time per screen and unexpected errors, in Administration, Governance, Service and on the status page. A health probe job writes one measurement per run.
- Every request carries an identifier that reaches the audit log and the error record; the person sees its short reference on the error screen.
- Traces to an external tool are an adapter that is turned off (`TRACES_ADAPTER`). Turning it on is new technology: it needs the Tech Implementation Review sign-off.

## 6. Automated restore test (local, GOB-07)

`scripts/restore-test.mjs` runs the test above end to end against a local test database, without anyone typing steps:

```
MIGRATION_DATABASE_URL=postgres://postgres@127.0.0.1:5433/contigo_<package>_unit node scripts/restore-test.mjs
```

1. Counts rows in `crm.accounts`, `deals`, `leads`, `activities`, `contacts`, `audit_events`, `outbox_events`, `users` and `memberships`.
2. `pg_dump` (custom format) of the database, then `pg_restore` into a scratch database.
3. Compares the counts table by table. Any difference = failed.
4. Drops the scratch database and the dump file.
5. Records the test in `crm.restore_tests` with environment "local", minutes, result and both counts. It shows in Administration, Governance, Service.

It refuses to run with `APP_ENV=production`, against a non-local host, or against a database whose name does not start with `contigo_`. It runs in the unit tests (`tests/db/plataforma.test.ts`, "GOB-07").

The same test against staging and production (point-in-time recovery of the platform) and the RPO, RTO and service objective values are still to be set. [pendiente: Dan Mulligan] Until then they show as pending in CONTIGO status, and the values are edited in Administration, Governance, Service, with who agreed and when.

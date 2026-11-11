# ADR-005: Current Pipedrive data in staging

Status: **Decided by Yamil Alvarez on 11-Nov-2026. Sign-off from Dan Mulligan or Michael Essiet is requested through the pull request (OPS-09).**

## Decision
Staging loads the current Pipedrive data for US and MX (configuration and records) so the team can test replacing Pipedrive end to end before any production platform exists.

## What this deviates from
The Engineering Standard v1 allows Option 1 (Vercel + Supabase) only with synthetic data, and OPS-08 keeps Claude Code agents on synthetic data. This ADR records the exception and what bounds it. It does not change the production recommendation in ADR-002.

## What bounds the exception
1. **Read-only on Pipedrive.** The adapter (`src/server/adapters/pipedrive.ts`) has no write operation. Nothing changes in Pipedrive.
2. **The data never passes through the agent.** The import runs inside the application: server to Pipedrive API to database. The API token is a Sensitive variable on the host, set by a person.
3. **Prohibited data stays out (DATA-06, SEC-08).** Fields that hold an official ID keep only their last 4 characters; fields that look like account, card or password fields are not stored; card numbers and SSNs inside notes are removed before the raw copy is written. Both rules have tests.
4. **Access.** Vercel Authentication stays on for the project, Google sign-in is limited to the company domain, demo personas are off in the database, and every table keeps forced row-level security. The raw landing zone is readable by admins only and can be emptied from the screen once the migration is accepted.
5. **Exit.** Before go-live the database moves to the platform chosen in ADR-002. The schema is standard Postgres and the import can be re-run there.

## Open points for the reviewers
- Whether Supabase (us-east-2) is acceptable for this data for the length of the test. `[pending: Dan Mulligan / Michael Essiet]`
- Residency and subprocessor register for MX data (COMP-01, COMP-03). `[pending: Legal]`
- Retention of the raw copy. Default in this PR: emptied by an admin after acceptance.

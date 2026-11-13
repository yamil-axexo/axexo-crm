# Runbook: deployment and rollback (GOB-04, REL-07 to REL-09)

Technical owner of "Deployment and rollback": `[pending: Dan Mulligan]`. Backup: `[pending: Dan Mulligan]`. Both names are recorded in Administration, Governance, Releases, "Owners per component". The screen warns while there are not two different people named, and a release cannot be marked as released while its go-live checklist is incomplete.

## Before deploying

1. **The release exists in CONTIGO** (Administration, Governance, Releases) with its notes in Spanish and English. A release that touches commissions or merchant enrollment needs a planned date and has to be announced before that date: the screen refuses to release it earlier.
2. **Announce it.** "Announce" publishes the notes to the teams (What's new) before the change, not after.
3. **Go-live checklist complete, each item with evidence** (`src/content/release-checklist.ts`, mirrored in `.github/pull_request_template.md`):
   - Technology review (Tech Implementation Review): written sign-off from Dan Mulligan or Michael Essiet, requested by email to engineering@axexo.com. No new technology goes live without it.
   - Engineering standard: controls cited, `docs/standard-compliance.md` up to date.
   - Tests green on the commit going out (rules and permissions, build, end to end, prohibited data scan).
   - Migrations tested up and down on seeded data, rollback written.
   - Two people can deploy and roll back.
   - Backup verified (see `respaldo-y-restauracion.md`).
   - User guide and release notes updated in the same change.
   - No real data in test environments, or a signed exception.
4. **Maintenance window**, if people will notice: Administration, Governance, Releases, "Maintenance calendar". Each person sees the windows of their market in "Request a change".

## Deploying

1. Apply pending migrations with the schema owner connection: `MIGRATION_DATABASE_URL=... node scripts/migrate.mjs up`. Check with `node scripts/migrate.mjs status`. Migrations are backward compatible with the previous commit, so the database goes first.
2. Deploy the commit on the host. Exact console steps for production: `[pending: Dan Mulligan]` (ADR-002 is open).
3. Check `/api/health`, the status page (deployed version and number of migrations) and one screen per role.
4. The deployment is recorded: CONTIGO notes by itself the commit it is running the first time it sees it (job "deploy watch"); an administrator adds who deployed and how it ended in Governance, "Deployments". A deployment made by hand outside that path is recorded by hand.
5. Mark the release as released.

## Rolling back

1. Redeploy the previous commit (the one before in Governance, "Deployments").
2. Only if the new migration itself is the problem: `node scripts/migrate.mjs down` once per migration to undo, newest first. Every migration has its `.down.sql`, and the cycle down and up runs in CI on seeded data. A down migration drops what the up created: export first whatever was written to the new tables if it has to be kept.
3. Record the deployment as "Rolled back", open an incident and close it with cause and actions.

## Who can do this

At least two named people who have each done it once. Today: `[pending: Dan Mulligan]`. Branch protection with two reviewers: `[pending: repository administrators]`.

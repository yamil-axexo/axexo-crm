# Runbook: moving staging to synthetic data (GOB-08)

**This is a decision, not a routine task. It belongs to Michael Essiet or Dan Mulligan.** Until one of them decides, staging keeps the current Pipedrive data under the exception recorded in ADR-005, which is still unsigned. Nothing in this runbook has been executed.

## The rule

A test environment carries no real data. Production is the only environment with real merchant data. Staging and previews run on the base seed plus the generator (`scripts/synthetic.mjs`). The Engineering Standard allows the current staging platform only with synthetic data.

CONTIGO shows where an environment stands in Administration, Governance, Test data: merchants in total, from the generator, imported from Pipedrive, and real people with access. While a non-production environment holds imported merchants the screen says so in a warning.

## What has to be decided first

| Decision | Who |
|---|---|
| Sign ADR-005 and keep real data in staging for the replacement test, or move staging to synthetic now | Michael Essiet or Dan Mulligan |
| If the replacement test continues: where it runs with real data (the production platform of ADR-002) | Dan Mulligan |
| Whether the configuration imported from Pipedrive (pipelines, stages, fields, loss reasons) is kept. It is configuration, not personal data | Michael Essiet or Dan Mulligan, with Yamil Alvarez |
| Whether real people keep their access to staging after the change (their name and work email are in `crm.users`) | Michael Essiet or Dan Mulligan |

## Procedure (after the decision)

Two people. Announce it to the teams first: everything they captured in staging disappears.

1. **Announcement** in CONTIGO with the date, and a maintenance window (Administration, Governance, Releases).
2. **Platform backup** of staging before touching anything, kept for the retention the decision sets `[pending: Michael Essiet / Dan Mulligan]`.
3. **Export what is kept**, only if the decision keeps it: configuration through Administration, Import and export (pipelines, stages, fields, catalogs). No merchants, contacts, leads, deals, activities or notes.
4. **Rebuild the database from zero** with the schema owner connection, against staging and never production (both scripts refuse `APP_ENV=production`):
   ```bash
   MIGRATION_DATABASE_URL=... node scripts/migrate.mjs reset
   MIGRATION_DATABASE_URL=... APP_ENV=staging node scripts/seed.mjs
   MIGRATION_DATABASE_URL=... APP_ENV=staging node scripts/synthetic.mjs --market MX --accounts 500 --seed 42 --depth 4
   MIGRATION_DATABASE_URL=... APP_ENV=staging node scripts/synthetic.mjs --market US --accounts 200 --seed 42 --depth 3
   MIGRATION_DATABASE_URL=... APP_ENV=staging node scripts/synthetic.mjs --market SV --accounts 100 --seed 42 --depth 3
   ```
   The same market, seed and volume always give the same merchants, so a bug found on staging can be reproduced locally with the same command. Volumes above are examples: choose them for the test at hand.
5. **Remove the Pipedrive token** from the staging host so the import cannot be run again there by mistake. The import adapter stays in the code for production.
6. **Re-import the configuration** that was exported in step 3, if any.
7. **Give access back** to the people who test, if the decision keeps it (Administration, People).
8. **Verify** in Administration, Governance, Test data: "Imported from Pipedrive" reads 0 and the warning is gone. In the database: `select count(*) from crm.account_aliases where system = 'pipedrive';` returns 0, `select count(*) from crm.import_raw;` returns 0, and `pnpm scan:prohibited --db` finds nothing.
9. **Record it**: a deployment entry and the go-live checklist item "No real data in test environments" from then on reads "generator data".

## What the generator gives

Per market (MX, US, SV): chains up to eight levels deep, owners taken from the test personas of that market, places with coordinates, phone numbers in the market's format, the last four characters of a tax ID generated with a valid format (RFC with check digit, EIN, NIT; the full value is never stored), seven days of sales for active stores, and ten named edge cases (very long name, accents and symbols, no phone, no owner, no place, lost long ago, created today, two merchants with the same name, no tax ID). Running the same command twice adds nothing. Every run is listed on screen with market, volume, seed and who ran it.

## Previews per branch

Not set up. When they are, each preview database is built with the same three commands of step 4 and never from a copy of production. `[pending: Dan Mulligan]` (depends on the platform of ADR-002).

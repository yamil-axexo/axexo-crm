## What changes

## Rules of the Engineering Standard this touches
<!-- IDs, for example AUTHZ-03, REL-07 -->

## Definition of Done
- [ ] Rule IDs cited above
- [ ] Migrations are reversible (up and down) and backward compatible
- [ ] Unit tests, permission tests (allowed and denied) and E2E for the change
- [ ] Copy in Spanish and English
- [ ] No prohibited data, no secrets, nothing sensitive in `NEXT_PUBLIC_`
- [ ] User guide, first steps and release notes updated in this same change when the team sees something different (E7.F8)
- [ ] `docs/standard-compliance.md` and `docs/scope.md` still tell the truth after this change
- [ ] CI green
- [ ] Two reviewers other than the author

## Going to production (go-live checklist, mirrored in Administration, Governance, Releases)
<!-- Source: src/content/release-checklist.ts. Each item is checked in CONTIGO with its evidence before the release is marked as released. -->
- [ ] Tech Implementation Review: written sign-off from Dan Mulligan or Michael Essiet (email to engineering@axexo.com). No new technology goes live without it
- [ ] Engineering standard: controls cited above and compliance document up to date
- [ ] Tests green on the commit going out
- [ ] Migrations tested up and down, rollback written (`docs/runbooks/despliegue-y-vuelta-atras.md`)
- [ ] Two people can deploy and roll back
- [ ] Backup verified before deploying (`docs/runbooks/respaldo-y-restauracion.md`)
- [ ] User guide and release notes up to date; the release was announced before the change
- [ ] No real data in test environments, or a signed exception (`docs/runbooks/staging-a-datos-sinteticos.md`)

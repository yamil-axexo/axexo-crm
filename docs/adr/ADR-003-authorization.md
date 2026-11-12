# ADR-003: Authorization with forced row-level security

Status: Proposed (11-Nov-2026).

## Decision
Two layers that must both agree:

1. **Capability matrix** (`src/domain/policy.ts`): which role may perform which action in which market. Read by the UI (what to show), by every domain command (what to allow) and by tests.
2. **Row-level security** (`db/migrations/0002_access.up.sql`): which rows exist for a person. Enabled and forced on every table in `crm`.

Roles: `admin` and `lt` are global; `market_lead`, `supervisor`, `rep`, `ops` belong to one market. Access is a row in `crm.memberships` with validity dates. Removing access closes the row; nothing is deleted.

Scope of a row:
- Market lead, operations, admin and leadership see the whole market.
- A supervisor sees accounts owned by members of their team, unowned accounts in the market, and accounts with no current owner in the market (see "No current owner" below).
- A rep sees accounts they own and unowned accounts in their territories.
- Whoever owns a parent account sees the whole tree under it (`ancestor_ids`).
- Deals, contacts, visits, metrics, aliases and attributions inherit the scope of their account.

Extra locks:
- A restrictive policy allows writes only to roles with write access in that market, so `lt` is read-only at the database, not just in the UI.
- The app role has no `DELETE` on business tables. Merging archives; ending access sets `valid_to`.
- `audit_events` rejects update, delete and truncate through triggers, including for the schema owner.
- `sessions` has no policies and no grants; it is reachable only through `SECURITY DEFINER` functions.

## Assumption to carry to any platform
Scope functions are `SECURITY DEFINER` and read `memberships` without passing through the policies they feed. The migration owner therefore needs `BYPASSRLS` (true for `postgres` on Supabase; on RDS it must be granted explicitly to the migration role). The application role never has it.

## Evidence
`tests/db/permissions.test.ts` runs allowed and denied cases per role × object × action against a real database, as the application role, in CI.

## No current owner (added 11-Nov-2026, migration `0011_distribution`)
Decided by Yamil Alvarez on 11-Nov-2026 with the work package "reparto". Review is requested through the pull request.

**The problem.** After the Pipedrive import, most records in both markets sit under a service account or under people who are inactive. The roles proposal of 11-Nov-2026 gives the distribution of those records to the market leads and the supervisors, by territory. A supervisor only saw the team's records and the unowned ones, so the people who have to distribute the book could neither see it nor move it.

**The rule.** A merchant or a lead has no current owner when:
- it has no owner, or
- its owner has no current sales role (`rep`, `supervisor` or `market_lead`) in the market of the record. That covers a service account, an inactive person, a person whose membership in that market ended, and a person who only sells in another market.

"Current" is evaluated at query time against `crm.memberships` and `crm.users.is_active`. Nothing is stored on the record, so the moment access is removed the records become visible to supervisors, and the moment they are reassigned to someone who sells they stop being visible market-wide.

**Who sees and who moves.**

| Role | Records with no current owner in their market |
|---|---|
| Admin, market lead | See them and reassign them to anyone who sells in the market (unchanged) |
| Operations, leadership | See them, do not reassign (unchanged) |
| Supervisor | **New:** sees them, with their deals, tasks and exceptions, and reassigns them to people on their own team |
| Rep | Does not see them. Still sees unowned leads of the market (`0008_open_leads`) and unowned merchants in their territories |
| Any role of another market | Does not see them |

**Why at the supervisor level and market-wide.** The distribution is by territory, and a territory does not belong to one team until the merchants are assigned. Limiting a supervisor to "ownerless records of my team" is empty by definition: a record with no current owner has no team. The cost is that two supervisors of the same market (for example D2D and B2B/ISO in Mexico) both see the pool. Each one can only move records into their own team, every batch is audited with who moved what from whom to whom, and the market lead can move them back.

**Consequences worth knowing.**
- Operations is not a sales role, so a merchant owned by an Operations user counts as having no current owner and shows up in the supervisor's pool. Deals owned by Operations on a merchant that has a current owner are not affected. If the decision on ownership after onboarding (requirements E10.F12) ends with Operations keeping merchants, the role list lives in one place: `app.seller_keys` in the migration.
- The exception "Merchant with no owner" still counts only merchants with no owner at all and an active lifecycle. Opening one exception per merchant of the service account would add thousands of items to the queue. Mi equipo shows the pool as one block per holder instead, with counts.
- A store with no owner that hangs from a chain is carried by whoever owns the chain; it does not count as "no owner" in filters and counts (same rule as the exception and the data quality tab).

**How it is enforced.**
- Database: `app.seller_keys(markets)` returns who sells today as `'MX:<user id>'` keys; the policies `accounts_read`, `accounts_upd`, `leads_read` and `leads_upd` add the case to the supervisor branch. Deals, activities, contacts and exceptions inherit it from the merchant or the lead. The function is evaluated once per query and reads only memberships. The row that results from a supervisor's update must stay in their team, unowned, or without a current owner; it cannot end up under another team.
- Domain: `src/domain/reparto.ts`. Capabilities `account.reassign`, `lead.assign`, `deal.reassign` and `account.territory` belong to admin, market lead and supervisor. A supervisor's target must be on their team; a market lead's target must sell in the market. Every operation runs in batches of 500 and writes one audit event per batch.
- Tests: `tests/db/reparto.test.ts` (allowed and denied per role and market, at the database and in the domain) and `tests/e2e/reparto.spec.ts`.

**Territories.** `crm.territories` is a per-market catalog maintained by admin (`src/domain/territories.ts`); it ships empty and the real list is a business decision. A new merchant with no territory takes its owner's territory when the owner has exactly one in that market (trigger `accounts_territory`), which covers manual entry, lead conversion and integrations with the same rule. A merchant cannot carry a territory of another market.

**Performance.** With thousands of visible merchants the planner chose to JIT-compile list queries and the compilation cost more than the query (0.5 to 1.5 s extra per screen, measured with 6,000 merchants). The migration turns JIT off for the application role in the application database. Indexes added: trigram on city and state (`place_norm`), `(market_code, region)`, open deals and open leads by `(market_code, owner_id)`.

**Not decided here.** Who the records go to (the owner table per territory) stays with the market leads and supervisors. Notifying the new owner before a bulk change (requirements E4.F6) is not built: the confirmation step says so and asks the person to tell them.


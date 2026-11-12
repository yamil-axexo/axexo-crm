# ADR-003: Authorization with forced row-level security

Status: Proposed (11-Nov-2026).

## Decision
Two layers that must both agree:

1. **Capability matrix** (`src/domain/policy.ts`): which role may perform which action in which market. Read by the UI (what to show), by every domain command (what to allow) and by tests.
2. **Row-level security** (`db/migrations/0002_access.up.sql`): which rows exist for a person. Enabled and forced on every table in `crm`.

Roles: `admin` and `lt` are global; `market_lead`, `supervisor`, `rep`, `ops` belong to one market. Access is a row in `crm.memberships` with validity dates. Removing access closes the row; nothing is deleted. A row can also carry an end date set in advance (see "Rules added after the admin and leadership committee").

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

## Rules added after the admin and leadership committee (11-Nov-2026)
Migration `0012_admin_controls`, `tests/db/admin.test.ts`, `tests/e2e/admin.spec.ts`.

- **A role can expire.** `valid_to` may be set when access is granted or later ("Vence el"). The role is valid until the end of that calendar day in the market's time zone (global roles: end of the day in UTC) and stops on its own: the scope functions and the session loader already ignore a membership past `valid_to`, so nothing has to run that day. The domain rejects a date in the past.
- **Removing access also removes the person from lead routing.** `endMembership` closes the membership and, in the same transaction, takes the person out of every rotation of a market where they no longer hold a sales role, and clears them as the fallback. Each rule change is its own audit event. Records they own are not moved: the confirmation shows how many accounts, open deals and open leads they hold and whether they will be left with no current owner (see "No current owner" below), and Data quality lists records whose owner has no access (`app.works_in`).
- **Routing never assigns to someone without a current sales role in that market** (`app.rr_next` with `app.can_sell_in`). This also covers a membership that expired by date, where no command ran. If nobody in the rotation is eligible the lead goes to the fallback, if eligible; otherwise it stays unowned, which sellers of that market can see and take (`0008_open_leads`).
- **One administrator without an expiry date must always remain.** Ending the last one, or giving it an expiry date, is rejected. An administrator whose access expires does not count.
- **Granting Administration needs a separate confirmation** (`confirmAdmin`), validated in the domain, not only in the form. It is still one person's decision: there is no second approver. `[pending: whether a second administrator must approve]`
- **"Evaluate rules now" is a write.** New capability `rules.run` (admin, market lead, supervisor). Leadership keeps reading Mi equipo (`board.supervisor`) but cannot run it. The rules run as the system user; the audit event `rules.evaluated` is written under the person who ran them, in a second transaction right after. The automatic refresh when a board is opened (at most every 15 minutes) is not a person's action and is not audited.
- **Leadership is read-only and says so.** `isReadOnly` (every current role is `lt`) drives a "Solo lectura" mark in the top bar. `tests/db/admin.test.ts` calls every domain command that changes data as Leadership and expects `forbidden` on each, with no audit event and no row count changed.
- **Stage configuration is edited by admin only** (`updateStage`: names in both languages, stall days, entry requirements), audited with before and after. The catalog policies already limit `crm.stages` updates to admin.
- **Status page.** New capability `status.read` (admin, leadership). `app.system_status()` is `SECURITY DEFINER` and returns only counts and dates from tables that are admin-only (import runs, ingest batches, inbound events, API clients, outbox); it raises `42501` for any non-global role.
- **Audit log names.** The log resolves record names with the reader's own row-level scope: a reader who cannot see a record gets no name and no link for it. Filters never widen `audit_read`.
- **Integration tests from Administration** still enter as the system user (same path as the real sender) and now leave `integration.simulated` under the person who ran them.

## Assumption to carry to any platform
Scope functions are `SECURITY DEFINER` and read `memberships` without passing through the policies they feed. The migration owner therefore needs `BYPASSRLS` (true for `postgres` on Supabase; on RDS it must be granted explicitly to the migration role). The application role never has it.

## Evidence
`tests/db/permissions.test.ts` runs allowed and denied cases per role × object × action against a real database, as the application role, in CI. `tests/db/admin.test.ts` covers access expiry, access removal and routing, the read-only sweep for Leadership and the status function.

## No current owner (added 11-Nov-2026, migration `0011_distribution`)
Decided by Yamil Alvarez on 11-Nov-2026 with the work package "reparto". Review is requested through the pull request.

**The problem.** After the Pipedrive import, most records in both markets sit under a service account or under people who are inactive. The roles proposal of 11-Nov-2026 gives the distribution of those records to the market leads and the supervisors, by territory. A supervisor only saw the team's records and the unowned ones, so the people who have to distribute the book could neither see it nor move it.

**The rule.** A merchant or a lead has no current owner when:
- it has no owner, or
- its owner has no current role that carries records (`rep`, `supervisor`, `market_lead` or `ops`) in the market of the record. That covers a service account, an inactive person, a person whose membership in that market ended, and a person who only works in another market. Admin and leadership are global roles and do not make someone a current owner.

Operations counts as a current owner (changed at integration, 11-Nov-2026): after onboarding, the deal and the merchant can stay under Operations (requirements E10.F12), and that is an owner who is working the record. Being a current owner is not the same as selling: Operations is not a target of a distribution and does not enter lead rotations (`app.can_sell_in`, `0012_admin_controls`).

"Current" is evaluated at query time against `crm.memberships` and `crm.users.is_active`. Nothing is stored on the record, so the moment access is removed the records become visible to supervisors, and the moment they are reassigned to someone who sells they stop being visible market-wide.

**Removing access and the pool count the same.** The confirmation in Administration ("Quitar este acceso"), the result of `endMembership` and the "Sin dueño vigente" block in Mi equipo count the same three things for a person in a market: merchants not archived, open deals and open leads. The confirmation says whether the role being removed is the person's last record-carrying role in that market (`vacates`); if it is, the result notice links to the distribution tool with that person's records already filtered. Removing a global role, or one of two record-carrying roles in the same market, leaves nothing without a current owner and says so.

**Who sees and who moves.**

| Role | Records with no current owner in their market |
|---|---|
| Admin, market lead | See them and reassign them to anyone who sells in the market (unchanged) |
| Operations, leadership | See them, do not reassign (unchanged). What an Operations user owns in their market is not in this pool |
| Supervisor | **New:** sees them, with their deals, tasks and exceptions, and reassigns them to people on their own team |
| Rep | Does not see them. Still sees unowned leads of the market (`0008_open_leads`) and unowned merchants in their territories |
| Any role of another market | Does not see them |

**Why at the supervisor level and market-wide.** The distribution is by territory, and a territory does not belong to one team until the merchants are assigned. Limiting a supervisor to "ownerless records of my team" is empty by definition: a record with no current owner has no team. The cost is that two supervisors of the same market (for example D2D and B2B/ISO in Mexico) both see the pool. Each one can only move records into their own team, every batch is audited with who moved what from whom to whom, and the market lead can move them back.

**Consequences worth knowing.**
- A merchant, deal or lead owned by an Operations user of that market has a current owner: it does not show up in the supervisor's pool, and a supervisor of another team does not see it. When that person loses the Operations role, it does. The role list lives in one place, `app.owner_roles()` in the migration; the keys and the application read it from there.
- The exception "Merchant with no owner" still counts only merchants with no owner at all and an active lifecycle. Opening one exception per merchant of the service account would add thousands of items to the queue. Mi equipo shows the pool as one block per holder instead, with counts.
- A store with no owner that hangs from a chain is carried by whoever owns the chain; it does not count as "no owner" in filters and counts (same rule as the exception and the data quality tab).

**How it is enforced.**
- Database: `app.owner_keys(markets)` returns who is a current owner today as `'MX:<user id>'` keys, for the roles in `app.owner_roles()`; the policies `accounts_read`, `accounts_upd`, `leads_read` and `leads_upd` add the case to the supervisor branch. Deals, activities, contacts and exceptions inherit it from the merchant or the lead. The function is evaluated once per query and reads only memberships. The row that results from a supervisor's update must stay in their team, unowned, or without a current owner; it cannot end up under another team.
- Domain: `src/domain/reparto.ts`. Capabilities `account.reassign`, `lead.assign`, `deal.reassign` and `account.territory` belong to admin, market lead and supervisor. A supervisor's target must be on their team; a market lead's target must sell in the market. Every operation runs in batches of 500 and writes one audit event per batch.
- Tests: `tests/db/reparto.test.ts` (allowed and denied per role and market, at the database and in the domain) and `tests/e2e/reparto.spec.ts`.

**Territories.** `crm.territories` is a per-market catalog maintained by admin (`src/domain/territories.ts`); it ships empty and the real list is a business decision. A new merchant with no territory takes its owner's territory when the owner has exactly one in that market (trigger `accounts_territory`), which covers manual entry, lead conversion and integrations with the same rule. A merchant cannot carry a territory of another market.

**Performance.** With thousands of visible merchants the planner chose to JIT-compile list queries and the compilation cost more than the query (0.5 to 1.5 s extra per screen, measured with 6,000 merchants). The migration turns JIT off for the application role in the application database. Indexes added: trigram on city and state (`place_norm`), `(market_code, region)`, open deals and open leads by `(market_code, owner_id)`.

**Not decided here.** Who the records go to (the owner table per territory) stays with the market leads and supervisors. Notifying the new owner before a bulk change (requirements E4.F6) is not built: the confirmation step says so and asks the person to tell them.


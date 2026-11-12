# ADR-003: Authorization with forced row-level security

Status: Proposed (11-Nov-2026).

## Decision
Two layers that must both agree:

1. **Capability matrix** (`src/domain/policy.ts`): which role may perform which action in which market. Read by the UI (what to show), by every domain command (what to allow) and by tests.
2. **Row-level security** (`db/migrations/0002_access.up.sql`): which rows exist for a person. Enabled and forced on every table in `crm`.

Roles: `admin` and `lt` are global; `market_lead`, `supervisor`, `rep`, `ops` belong to one market. Access is a row in `crm.memberships` with validity dates. Removing access closes the row; nothing is deleted. A row can also carry an end date set in advance (see "Rules added after the admin and leadership committee").

Scope of a row:
- Market lead, operations, admin and leadership see the whole market.
- A supervisor sees accounts owned by members of their team and unowned accounts in the market.
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
- **Removing access also removes the person from lead routing.** `endMembership` closes the membership and, in the same transaction, takes the person out of every rotation of a market where they no longer hold a sales role, and clears them as the fallback. Each rule change is its own audit event. Records they own are not moved: the confirmation shows how many accounts, open deals and open leads they hold, and Data quality lists records whose owner has no access (`app.works_in`).
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

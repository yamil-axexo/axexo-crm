# ADR-003: Authorization with forced row-level security

Status: Proposed (11-Nov-2026).

## Decision
Two layers that must both agree:

1. **Capability matrix** (`src/domain/policy.ts`): which role may perform which action in which market. Read by the UI (what to show), by every domain command (what to allow) and by tests.
2. **Row-level security** (`db/migrations/0002_access.up.sql`): which rows exist for a person. Enabled and forced on every table in `crm`.

Roles: `admin` and `lt` are global; `market_lead`, `supervisor`, `rep`, `ops` belong to one market. Access is a row in `crm.memberships` with validity dates. Removing access closes the row; nothing is deleted.

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

## Assumption to carry to any platform
Scope functions are `SECURITY DEFINER` and read `memberships` without passing through the policies they feed. The migration owner therefore needs `BYPASSRLS` (true for `postgres` on Supabase; on RDS it must be granted explicitly to the migration role). The application role never has it.

## Evidence
`tests/db/permissions.test.ts` runs allowed and denied cases per role × object × action against a real database, as the application role, in CI.

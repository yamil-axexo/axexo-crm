# ADR-008: Audit log written by the database, administration by area, restricted fields, privacy controls

Status: **Proposed on 13-Nov-2026 (package `seguridad`, migration 0027). Needs sign-off from Dan Mulligan or Michael Essiet (Tech Implementation Review) before it reaches an environment with real data.** It changes authorization (ADR-003): new roles, new policies and a new schema. It certifies nothing: it builds the controls and says which ones are still missing for SOX or SOC.

Catalog items: SEG-03, SEG-01, SEG-02, SEG-04, SEG-07, SEG-09, SEG-08, UX-02. Requirements: E4.F2, E4.F4, E4.F9.

## Decision
1. **The database writes the audit log.** A trigger on every `crm` table copies each insert, update, delete and truncate to the `audit` schema (`audit.data_log` for business data, `audit.config_log` for configuration): table, row, columns that changed, before and after, who, database role, entry channel (screen, API, web form, import, scheduled job, integration, direct SQL) and request id. A change made by direct SQL is logged with channel `sql` and opens an alert. `audit.attach_all()` runs at the end of every `migrate up`, so a table created by a later migration gets its trigger; a test fails if a `crm` table has neither a trigger nor a row in `audit.excluded_tables` with its reason.
2. **Nobody edits the log.** `contigo_app` has `SELECT` only; update, delete and truncate raise an error for every role, the schema owner included. The single exception is redaction for an erasure request in progress (decision 8).
3. **The application log stays** (`crm.audit_events`): it carries the business meaning (who moved a deal and why). The database stamps its channel and request id.
4. **Reads that leave CONTIGO are counted.** `audit.read_log` gets a row for every export (a trigger on the `*.exported` events, so no export screen can forget), search, reveal of restricted data, data subject export, "view as" session and read made with an API key. `app.security_scan()` (hourly job) compares them with thresholds and opens alerts; new alerts notify whoever handles the audit log through the notification service.
5. **Administration by area.** A membership with role `admin` and `admin_areas` null administers everything, as before. With areas it administers only those: `access`, `config`, `audit`, `integrations`. `policy.ts` maps each capability to its area and the database repeats it (`app.has_area`). An area never works records (sell, merge, reassign) and never grants Administration: only full administration does, in the domain and in a restrictive policy. One full administrator with no expiry always remains.
6. **Who sees an account.** New, on top of ADR-003: the account team (`crm.account_team`, read or edit, separate from ownership), supervision over several levels (`teams.parent_team_id`), a role limited to one legal entity, an `agency` role confined to what its agency recruited (stamped by the database on leads, merchants and deals, in its pipeline and region), and a read-only `partner` role confined to one account and its tree. Direct sales of the same market (sales and supervision) do not see what an agency recruited, and "someone else already has it" (`app.search_others`) does not name it to them either. `app.can_see_account()` states the whole rule in one place.
7. **Restricted fields live in their own table** (`crm.account_sensitive`) with no privilege for the application role: they are read and written only through functions that check the role, return the value only with a reason of 10 characters or more, and leave the event before returning it. Screens show them masked. The log keeps that the value changed, never the value. The prohibited-data guard still applies: no cards, bank accounts or IDs.
8. **Erasure keeps the fact.** A data subject erasure anonymizes name, phone, email and message in the contact or lead, and blanks those same keys in the log rows of that person. Ids, amounts, dates, who did what and which columns changed stay. Redaction is only possible while an erasure request for that person is in progress, and is itself logged.
9. **Consent and opt-out are rows**, per contact or lead, channel and purpose, with evidence and date. `app.may_contact()` is the one question every outside send asks: an opt-out always wins; marketing also needs a live consent. The notification service and the mailing export already ask it.
10. **"View as" is read-only by construction**: only read capabilities survive, every server action is cut in `runAction`, restricted data cannot be revealed, and it needs a reason, expires (60 minutes at most) and is logged with who, whom and why.
11. **Search does not enumerate.** Phone matches only a whole number (7 digits or more, compared from the end); an external id only matches exactly; 30 searches per person per minute.

## What stays off, and what turns it on
| Piece | State | To turn it on |
|---|---|---|
| Copy of the log outside the database | Off: daily batches are built with their SHA-256 and stay queued as "channel off" | An approved destination (object storage or the lakehouse), a `live` implementation in `src/server/adapters/audit-archive.ts`, and `AUDIT_ARCHIVE_ADAPTER` |
| Google directory sync (same-day removal) | Off: the job does nothing | A read-only directory service account, its approval, a `live` implementation in `directory.ts`, and `DIRECTORY_ADAPTER`. Meanwhile: unused access report and periodic access review with the market lead's sign-off |
| Field encryption with managed keys | Off: values are stored as they are, behind the controls of decision 7 | The approved key service, a `live` implementation in `field-crypto.ts`, and `FIELD_CRYPTO_ADAPTER` |
| Retention rules | Built, all off, no period loaded | Legal defines the period per rule; whoever holds the audit area loads it, reads the preview and turns the rule on |
| Response period for data subject requests | Empty per market | Legal defines the days per country; requests created before have no due date |

## Not decided here
1. Whether the log moves to a separate database or stays as a schema. A schema with no write privilege is the smallest step that makes it independent of application code.
2. MFA for roles that export: CONTIGO signs in with Google and does not see the second factor. It is a Google Workspace policy.
3. Partial administrators still read every market (they are global, like Leadership). Narrowing that needs a decision on who audits what.
4. A Finance role (E4.F2). Today Finance reports open to leadership, market leads and administration.
5. Consent and opt-out stay inside CONTIGO: they are not published as domain events, because the useful payload is a personal address. Propagating an opt-out to another system needs its own contract.
6. Secure capture of documents and ids, and the privacy notice version per market: they depend on Legal and on a provider that is not approved.

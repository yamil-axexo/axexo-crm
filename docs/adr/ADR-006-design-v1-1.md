# ADR-006: Design v1.1 (Dock + "Lo siguiente") and the product rules it brings

Status: **Decided by Yamil Alvarez on 11-Nov-2026. Review is requested through the pull request.**

Source: the design handoff `HANDOFF-CONTIGO-Diseno-UX-v1-2026-11-11.md` and the prototype v1.1 (Kiko's approved logo, black plus the axexo green family, Poppins, one theme).

## Decision
The interface layer is replaced by the handoff design. Data model, permissions (row-level security), the Pipedrive importer and the integrations are unchanged.

## What changed for the person using it
1. **Navigation.** A top bar and a dock with four destinations (Hoy, Leads, Negocios, Comercios) plus create. Mi equipo, Panel del LT and Administración live in the account menu.
2. **Hoy is a work queue**, not a dashboard: the most urgent record on top ("Ahora"), then overdue, today and suggested.
3. **Completing always asks for the next step.** It cannot be saved without "¿Qué sigue?" unless the person chooses to close. This applies in Hoy, in the merchant record and in Actividades.
4. **The merchant record opens over the list** (panel on desktop, beside the list on tablet, full screen on mobile) with tabs Hilo, Árbol and Datos.
5. **Deals board**: drag on desktop with a mouse, a stage selector on tablet and mobile. A card with no next step is shown as a warning.
6. **Leads** carry a first-contact clock; "Tomar y llamar" assigns an unowned lead and opens the call.

## Product rules introduced here (each one has tests)
| Rule | Where | Why |
|---|---|---|
| A logged attempt ("no answer") stops the first-contact clock and must schedule the next attempt; the lead becomes "contacted" only when the person was reached. "Call later" is not an attempt and is not offered for a lead. | `src/domain/queue.ts`, `tests/db/queue.test.ts` | The clock measures the response of whoever attends the lead. The attempt stays in the thread and in the audit trail, with its outcome. |
| A suggestion handled from Hoy needs a dated next step (it cannot be closed with "nothing else"), closes as scheduled together with any other open notice on the same record, and does not come back for 7 days. | `src/domain/queue.ts`, `src/domain/rules.ts` | The person committed to a dated next step; the same rule already applied to dismissed exceptions. |
| Changing stage asks for the next step when the deal has none, and saves both in one transaction. | `src/domain/deals.ts` (`moveDeal`) | The gate already existed for open stages; the board can now satisfy it in place. |
| Hoy shows the 5 most important suggestions, one per record, and says how many more there are. Leads without a first-contact clock (the ones that arrive from an import) do not enter Hoy or the dock badge. | `src/dal/queue.ts` (`SUGGESTED_PER_DAY`), `tests/db/queue.test.ts` | After the Pipedrive import almost no open deal carries a next step. Without this rule the queue of a single person opened with close to two thousand items. The backlog is worked in Negocios and Comercios, which show it with filters and counts. |
| Merchant health is one word plus a dot: Activo, Sin transaccionar, En riesgo, Lead nuevo. | `src/lib/health.ts` | It derives from the lifecycle S5 maintains and from whether there is an open deal. The lifecycle itself is still shown in Datos. |
| Deal amounts are summed per currency and never converted. | `src/dal/pipelines.ts` | The handoff leaves the MX currency decision open. |

## Changes after the evaluation committee (11-Nov-2026)
An independent committee of four reviewers (functional QA, security and controls, adoption, market comparison) went through this branch on synthetic data. What was fixed here, each with a test:
- **Cross-market write closed.** An activity could be linked to a lead or deal of another market by pairing it with an own merchant. The domain now validates every linked record and migration `0007_hardening` adds the same check to the row-level policy.
- **Sign-in log.** Starting and ending a session leaves an audit event (migration `0007_hardening`).
- **Prohibited data in free text.** Notes, activity subjects, next steps, deal titles and loss notes refuse card numbers, SSNs and CLABE account numbers at save time. Card detection now requires a real brand prefix and length, so an IMEI is not mistaken for a card.
- **Stage gates cannot be skipped.** Moving forward several stages requires what every stage in between requires.
- **Next step.** It cannot be cleared on an open deal or dated in the past.
- **Public form.** A second business sent from the same open form is a second lead (the idempotency key now includes what was sent).
- **Links that crashed pages.** Repeated or malformed URL parameters are ignored instead of returning a 500.
- **Calling.** When the merchant has no phone, call and WhatsApp use its contact's phone; contact and lead phones are tappable.
- **No signal.** Links, stage moves and take-a-lead do not fire while offline; the person stays on the screen with a notice.
- **"Today" is the market's day.** Rules and lists compared dates against the server's UTC day, which turns over at 18:00 in Mexico City: for the rest of the evening a next step due today counted as missing, and a revisit alert fired a day early. Every comparison now uses the market's calendar day (`marketToday` in `src/server/db.ts`); a unit test fails if `current_date` or a sliced ISO date comes back into `src`. The task created when a lead converts is a dated task instead of one at 10:00 UTC.
- Smaller ones: tree view order, tablet-portrait record at full screen, account menu above the record panel, dock sizes, search by CONTIGO ID, long text wrapping, contrast of the revisit notice, Spanish wording ("negocio").

What the committee raised that is a decision, not a fix, is listed in the committee report delivered with the pull request.

### Decisions taken by Yamil on the committee's open points (11-Nov-2026)
- **Leads with no owner are visible to sellers of their market.** Before, only supervisors, market leads and admins saw them, so "Tomar y llamar" did not exist for a rep. Migration `0008_open_leads` adds that case to the read and update policies. A rep can take one; nobody can work one without taking it (the row that results from an update must be theirs, and the domain says so before the database does). Leads owned by someone else stay hidden from other reps.
- **An attempt is not a contact.** The first-contact clock still stops at the first logged attempt. Mi equipo and Panel del LT now show two numbers over the same leads: "Primer intento a tiempo" and "Contacto logrado".
- **The next step is asked every time something is completed.** This keeps the handoff rule over the earlier features-committee position (block only on stage change). The risk the features committee named, filler dates, is to be measured in the pilot.
- **Operations can edit and move the deals of its market.** After onboarding the deal stays with Operations, so the role needs to carry it to the end. It still cannot create deals or work leads. Every change is audited with the person's name, like a seller's.
- **Won by hand during the pilot.** In the three pipelines that close by first transaction (MX B2B/ISO, MX D2D Store Enrollment, US Dealer Enrollment) the per-pipeline switch is off in staging until the S5 file is connected, because without it nobody could win a deal. This is configuration, not code: the switch is in Administración and each change is audited. A deal won by hand is stored as `closed_by = 'manual'`, creates no handoff to operations and does not change the merchant's health; both still come from the first transaction.

## Field work: what the second committee changed (11-Nov-2026, package `campo`)
A second committee walked the app as the real field people (US field sales in English on a phone, Mexico D2D). Its common finding: a team that works on the street had nowhere to log a visit, and the sheet and the merchant record were written for calls and proposals. What changed, each with a test in `tests/db/campo.test.ts` and `tests/e2e/campo.spec.ts`:

| Change | Where | Why |
|---|---|---|
| **A visit is an activity.** "Visita" is an activity type: open with a date it is a visit to make; done, it carries how it ended (sale or sign-up, no sale, go back for the decision-maker), the day it happened (up to 31 days back) and, optionally, who visited as a name separate from the owner. | Migration `0010_field_work`, `src/domain/activities.ts` | Requirements E12.F1 and E17.F1 define the visit as a dated activity on the store, and E16.F3 says street reps are not users. The Sales App, which will bring visits, is not connected. |
| **Visits count once, with their origin.** `crm.visit_log` lists Sales App visits and hand-logged ones. A hand-logged visit stops counting when the Sales App brings a visit for the same merchant and day. Mi equipo counts from that list, by the owner of the merchant. The thread shows both, each labeled. | Migration `0010_field_work`, `src/dal/boards.ts` | Mi equipo showed zero visits, so the team kept its spreadsheet. When the Sales App connects, nobody has to clean anything up. |
| **"Go back for the decision-maker" flags the deal**, exactly as a Sales App visit does, and the next visit clears it. With a visit already scheduled on that merchant, the revisit rule does not also raise a suggestion. | `src/domain/followup.ts`, `src/domain/rules.ts` | PIPE-05 only worked with the Sales App. The scheduled visit is the revisit: two entries for the same thing in Hoy read as noise. |
| **Start from the activity.** The dock's create button offers "Registrar actividad" (visit, call or note): the merchant is searched right there by name or phone, and the sheet saves without leaving the screen. A visit or a call logged this way asks for the next step, like completing a task. | `src/ui/log.tsx`, `src/dal/field.ts` | Logging a visit took six taps and ended up stored as a meeting. |
| **The complete sheet speaks street.** "Visitar" is a next step and leaves a visit to make; "Otra tarea" takes a line of text; a short note can be left; a visit to make is completed with visit outcomes; date shortcuts are consecutive and never offer Sunday. | `src/ui/complete.tsx`, `src/domain/queue.ts`, `src/server/sheet.ts` | Everything ended up as "Dar seguimiento a ...", which tells nobody anything when planning the week. |
| **Calling from the merchant record or from a deal asks how it went** on return, and the call stays in the thread with its outcome. A visit or a call logged on a merchant with a single open deal is linked to that deal, so the deal does not stay flagged "no next step". | `src/ui/log.tsx` (`CallLink`), `src/domain/activities.ts` | It only happened in Hoy and in Leads. |
| **Merchant record for the street:** address under the name with "Cómo llegar" (a maps link built from the written address; no API and no keys), "Mensaje de texto" (`sms:`) next to Llamar and WhatsApp, a one-tap "Visita", a copy button for IDs in other systems. | `src/app/(app)/comercios/ficha.tsx` | The address was only an edit field at the bottom of Datos, and US stores do not all use WhatsApp. |
| **The thread dates what was done by the day it was done**, not by the day the task was created, and says what each line was (note, call, meeting, task) and how it ended. Same in the deal detail. | `src/dal/accounts.ts`, `src/dal/pipelines.ts` | A call completed today showed three days ago, under today's notes and with no outcome. |
| **Moving someone else's work asks first and says what happened.** Reassigning a merchant and dismissing a team item open a confirmation that states what will move, and end with a notice. The dismissal takes an optional reason. | `src/ui/confirm.tsx` | One tap moved a store with its deal and tasks, or hid a team item for 7 days. |

Not done here, on purpose:
- **Next-step options per motion.** One list serves every team (Llamar, Visitar, Enviar propuesta, Reunión, Otra tarea). Hiding "Enviar propuesta" and "Reunión" for store sales, or adding "Enviar documentos" and "Capacitar", needs the list validated by the field leads. `[pending: Carlos Alvarado (MX D2D) and Sal Zavaleta (US)]`
- **Reason for visit** as a closed list (E12.F1). The list itself is open in the requirements (E12.F4). The visit has an outcome and a free note.
- **A catalog of street reps** and a "street rep" field on the merchant (E16.F3, E16.F4). The name lives on each visit, with suggestions from the names already used in the market; there is no list to maintain or to change in bulk when someone leaves.
- **Telling the person who receives a reassigned merchant.** The confirmation and the notice are for whoever reassigns; CONTIGO still has no notifications.

## Changes after committee 2 (waves 1 to 4) / Cambios después del comité 2 (olas 1 a 4)
The second committee (11-Nov-2026) walked the app as the real teams. What it asked for was built in three waves of packages, each on its own branch and database, and merged with `--no-ff` into `design-v1` (wave 1 and wave 2) and into `rc/olas-1-3` (wave 3 and this section).

### What was built, by package
| Wave | Package | What it brought | Migration |
|---|---|---|---|
| 1 | `diseno` | Entry page, first sign-in with a checklist per role, help. | `0009_onboarding` |
| 1 | `campo` | The visit as an activity, visits counted once, the sheet and the merchant record for street work (section above). | `0010_field_work` |
| 1 | `reparto` | Distribution of the book: who is a current owner, supervisors see and hand out what nobody carries, by place or territory, one record or a whole book. | `0011_distribution` |
| 1 | `admin` | Lead routing never hands a lead to someone who cannot sell in the market, origin and dated consent of web leads, stages edited by hand survive the import, audit filters, status page. | `0012_admin_controls` |
| 2 | `leads` | Conversion with account type and contact role, first-contact clock in business hours, lead list with search and bulk close, "it exists and X carries it" in search, pass a lead or release it. | `0013_leads` |
| 2 | `liderazgo` | Closed deals with CSV export, Leadership panel with a dated exchange rate, adoption, Mi equipo, board filters, weekly field report, one home screen per role. | `0014_leadership` |
| 2 | `operaciones` | Orders with product lines, two next-step lanes (Sales and Operations) that reach Hoy, handoff and Operations queue, return with a reason, Operations fields, notices inside the app, bulk close, win by hand with the real close date. | `0015_operations` |
| 2 | `b2b` | Account type catalog and hierarchy, fields by sale type, manageable stages, on hold, loss reasons by sale type, corporate contacts. | `0016_b2b` |
| 2 | `contenido` | Report a problem from any screen, help and first steps rewritten against the screens. | `0017_problem_reports` |
| 3 | `vocabulario` | One vocabulary in Spanish and English (`docs/glosario.md`), `<html lang>` and the first language follow the person, tests that guard the wording. | none |
| 3 | `contenido2` | Help, first steps, training and entry page brought up to wave 2. | none |
| 3 | integration | The guide uses the glossary and only names controls that exist; no long dashes anywhere, "s/d" and "n/a" mark a missing value; the next-step list is enforced in the domain, not only by the sheet; the Administration tab for problem reports is "Problemas reportados"; board filters fold behind "Filtros" on phones and "Míos" is an option of the person selector; entry page screenshots retaken on the final product; database tests start from a fresh database per file. | none |

### Migrations 0009 to 0017
| Migration | One line | Changes row-level policies |
|---|---|---|
| `0009_onboarding` | `crm.user_onboarding`: each person's first-steps list, marked and hidden by its owner only. | Yes: one policy on the new table (own row). |
| `0010_field_work` | "Visit" as an activity kind with outcome and visitor name; `crm.visit_log` counts Sales App and hand-logged visits once. | No. |
| `0011_distribution` | Current owner per market (`app.owner_roles`, `app.owner_keys`), place and territory on the merchant, indexes for thousands of merchants. | Yes: read and update on `crm.accounts` and `crm.leads` are replaced so supervisors see and move records with no current owner. |
| `0012_admin_controls` | Routing skips people without a current sales role (`app.can_sell_in`, `app.rr_next`), web lead origin and consent date, hand-edited stages, audit indexes, `app.system_status`. | No policy is created or dropped. |
| `0013_leads` | Account type and contact role on the lead, `crm.market_hours` and `app.business_due`, `app.hand_lead` (pass or release), `app.search_others`. | Yes: three policies on the new `crm.market_hours` (everyone reads, administration writes). Lead policies are unchanged: passing a lead goes through `app.hand_lead`. |
| `0014_leadership` | Who loaded the exchange rate and when, `app.adoption` (counts, no content), indexes for closed deals. | No. |
| `0015_operations` | Order pipelines with lines, Operations stages and second owner, `crm.ops_catalog`, `crm.deal_ops_checks`, `crm.notices`, separation of duties as a trigger (`app.deals_ops_guard`). | Yes: ten policies on the new tables and on `crm.deal_items`. |
| `0016_b2b` | `crm.account_types`, fields by sale type, archived stages, on hold (`crm.deal_pause_guard`), loss reasons by sale type, contact roles, one catalog shared with `0013`. | Yes: three policies on the new `crm.account_types`. |
| `0017_problem_reports` | `crm.problem_reports`: a person's reports and administration's answer. | Yes: three policies on the new table. |

The cycle `reset`, nine times `down`, `up` runs clean with seeded data (see Verification).

### Decisions taken by default, to be confirmed by Yamil
Nobody could be asked while the waves were built. Each of these is the choice the builder left written, with the reason; all are small to change.
1. **A seller can pass their own lead to a teammate** who sells in the same market, or release it. It goes through `app.hand_lead`; the lead policy still does not let a seller write a lead that stops being theirs.
2. **One next-step sheet and one rule.** The lists for store sales, B2B and Operations live in one place (`NEXT_SETS`); the sheet picks by who completes and by sale type.
3. **Business hours are Monday to Friday, 9:00 to 18:00**, in the market's time zone, until administration changes them per market. The first-contact clock only runs inside them.
4. **A returned deal arrives as a task.** The return becomes the seller's next step, due today in Hoy, with the reason Operations chose. There is no separate notice, email or Slack.
5. **Supervisors and market leads appear in Mi equipo only if they carry records** of their own.
6. **Operations reads the audit log and the alerts of its markets** (`audit.read`, `exception.read`).
7. **Anyone with access can report a problem**; administration answers and marks it attended.
8. **"s/d" (Spanish) and "n/a" (English) mark a missing value**, with "Sin dato" / "No data" as its title and accessible name. Long dashes are not used, in sentences or alone.

### Verification of the release candidate (12-Nov-2026)
Run on `rc/olas-1-3` with its own databases and ports:
- `pnpm typecheck`, `pnpm lint`, `pnpm scan:prohibited`: clean.
- `pnpm test`: 383 tests in 30 files, green twice in a row and with the file order shuffled. Every file of `tests/db` now starts from a freshly seeded database (`tests/db/fresh-db.ts` recreates it from a template copy), so the result no longer depends on the order between files; the fixed order by path that wave 2 added is gone.
- `pnpm build` and `pnpm e2e`: 282 end-to-end tests in 22 files against the standalone build.
- Migration cycle on seeded data: `reset`, nine times `down` (0017 back to 0009), `up`. Row counts are the same before and after (439 merchants, 337 deals, 84 leads, 249 activities) and every table of schema `crm` keeps forced row-level security.

### Wave 4: acceptance round (12-Nov-2026)
Two packages built in parallel after the acceptance round and merged with `--no-ff` into `design-v1`, plus what the integrator closed.

| Package | What it brought | Migration |
|---|---|---|
| `ajustes-campo` | Street seller catalog by market and team (not users), visits by who visited in the field report and its CSV, "Visited by" filter in Merchants; winning by hand completes what is missing in the same sheet, closes open tasks and notifies the seller; Operations cannot win before the handover; the handover asks for what the stage requires, including an additional deal field (`field:<key>`); the onboarding checklist applies by pipeline; a duplicate Merchant ID warns and asks to confirm; a visit with no sale asks why; street loss reasons by market; sellers see their own closed deals. | `0018_field_adjustments` |
| `ajustes-lider` | A new lead is noticed inside CONTIGO: dock counter and tab title refresh every minute, opt-in browser alert, lead watch on Mi equipo; the notice of a team with no supervisor on Mi equipo; Leads filters by sale type and team; Closed deals and its CSV say how a deal was won and who marked it; the won rule comes from each pipeline's real setting; granting Administration names its scope, who gets it and until when, and logs the confirmation; readable audit detail; B2B deals propose the account's own pipeline. | none |
| integration | Conflicts resolved in `admin/page.tsx`, `supervisor/page.tsx`, `guide.ts` and `lib/audit.ts`. Then: US time is said by name ("11:00 AM Eastern", "hora del Este") with the reader's local time in parentheses when the browser is in another zone, and threads, audit log, Status and Adoption name the zone they use (`zoneName`, `marketTime`, `OwnTime`); a converted lead inherits its territory or the sheet asks (`territoryFor`); "Take this store" (`takeAccount`); the default next step lands on a working day (`marketWorkday`, `workday`); the quiet-deals filter folds into Filters on phones; wording ("Para avanzar", "quien decide", "Administration"); three help questions. | none |

`0018_field_adjustments`: `crm.street_sellers` with forced row-level security and three policies (read by market, insert and update through `app.can_manage_street`), `app.visitor_names` replaced to suggest the catalog first, `activities.no_sale_code`, an index on the normalized Merchant ID, eight street loss reasons scoped to MX (an `update`), `pipelines.ops_checklist` (default true, false for order pipelines). The way up drops, renames and deletes nothing and disables no trigger; the way down drops what it added. There is no `0019`.

**Decisions taken by default in wave 4, to be confirmed by Yamil**
1. **Territory on conversion.** With one territory, the merchant is born in it. With two or more, the lead's city decides; when it does not, the conversion sheet asks and the domain refuses to guess (`pick_territory`).
2. **Who can take an unassigned store.** Supervision and the market lead, any store of their scope; a seller, only the stores in their own territories, which is the limit the database already had in `accounts_upd`. Otherwise the record says to ask supervision or the market lead. Taking a store is logged as `account.reassigned`.
3. **Sellers see their own closed deals** (`report.own`), with no export.
4. **The default next step skips the days the market does not work** (its business hours; Monday to Friday by default). A date the person picks by hand is not moved.
5. **The local time is computed in the browser** (`OwnTime`), with no cookie and no page reload, so it also works on screens that never saved the reader's zone.

**Second acceptance round on the integrated build (same day)**
- The tab title "(1) Lead nuevo" lasted under half a second because the screen refresh rewrote the page title. `LeadWatch` now watches `<head>` while there are unseen leads and puts the prefix back on the new title; it stops on a screen change and on unmount.
- A return from Operations keeps the reason code, the note and the deal title on the seller's next-step task (`activities.custom.ops_return`, no migration). Hoy, the deal, the board and the threads compose the sentence in the reader's language (`src/dal/step-text.ts`); the free note stays as written. If the seller writes another next step, the mark is removed.
- Hoy of a supervisor or market lead with nothing of their own says "No tienes pendientes propios" / "Nothing of your own to do" in the title and in the card while the team has open alerts, and "Todo al día" only when the team has none.

**Left open after wave 4**
- Administration has no screen yet to edit what a stage asks for beyond the fixed list (`field:<key>`), to switch `pipelines.ops_checklist`, or to change who a street seller reports to.
- First steps for Sales are the same in every market (stores before leads); the US and B2B variants are not written.
- The no-sale reason "No estaba el decisor" comes from `0004_pipedrive_mirror` and still reads that way; changing it in every environment needs a data migration.

### Verification after wave 4 (12-Nov-2026)
Run on `design-v1` with the integrator's databases (`contigo_unit`, `contigo_test`, `contigo_cycle`) and default ports:
- `pnpm typecheck`, `pnpm lint`, `pnpm scan:prohibited`: clean.
- `pnpm test`: 426 tests in 34 files, green twice in a row.
- `pnpm build` and `pnpm e2e`: 304 end-to-end tests in 25 files against the standalone build.
- Migration cycle on seeded data: `reset`, ten times `down` (0018 back to 0009), `up`.
- Walked with Playwright at 1440 and 390 px, in Spanish and in English: winning by hand from the card, the visit sheet, the field report and its two CSV files, Mi equipo with the lead watch and street sellers, closed deals, granting Administration. No overflow and no console errors.

## Deliberately not built
- **Terminales tab** in the merchant record. It was not part of this build's data; decided by Yamil on 11-Nov-2026.
- **Offline reading with data stored on the device.** The no-signal banner and disabled saving are built. The cached read (Hoy queue and the last merchants opened) is not: it stores merchant data on the device, which touches access and retention controls. Turning it on needs an explicit decision from Michael Essiet or Dan Mulligan together with whoever owns the SOX and SOC controls. `[pending: owner of SOX/SOC controls]`
- **Map view** of merchants. The control exists, disabled, per the handoff.
- **Light or dark mode switch.** One theme, per the handoff.

## Known gaps against the handoff
- Screens built before the redesign (lead and deal detail, Administración, Panel del LT, Mi equipo detail) carry the new tokens, type and components, and pass the three-width and accessibility sweep, but their layout was not redrawn against a prototype screen because the prototype does not include them.
- Interface texts of those older screens still use the inline ES/EN pair helper instead of the ICU message files. Both languages exist; moving them is mechanical.
- Performance targets (INP on a mid-range Android, first useful screen on 4G) are not measured yet: they need a real device or a lab profile against staging.
- Pseudo-localization (+35%) is not in CI.

## Verification
`pnpm test` (database and unit), `pnpm e2e` (every acceptance criterion of handoff section 6 at 1440, 1024 and 390 px, plus axe with WCAG 2.2 AA tags on every screen). Counts for the release candidate are in "Verification of the release candidate" above.

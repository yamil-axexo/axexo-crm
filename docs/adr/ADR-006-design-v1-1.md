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
`pnpm test` (database and unit), `pnpm e2e` (every acceptance criterion of handoff section 6 at 1440, 1024 and 390 px, plus axe with WCAG 2.2 AA tags on every screen).

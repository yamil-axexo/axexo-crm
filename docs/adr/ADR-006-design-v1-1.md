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
- Smaller ones: tree view order, tablet-portrait record at full screen, account menu above the record panel, dock sizes, search by CONTIGO ID, long text wrapping, contrast of the revisit notice, Spanish wording ("negocio").

What the committee raised that is a decision, not a fix, is listed in the committee report delivered with the pull request.

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

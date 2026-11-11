# Scope of this PR against the feature catalog

Source: `CRM-catalogo-funcionalidades-2026-11-11` (95 items; the committee marked 20 as visible in the pilot and 35 as foundation).

Markets with data: MX and US. SV is configured (market row and pipeline) with no data, so it can be turned on without schema changes.

## Visible in the pilot (20)
| ID | Feature | Status | Notes |
|---|---|---|---|
| DAT-04 | Deduplication and golden record | Built | Detection by phone and name similarity across the market at capture; duplicate queue; merge that archives. No per-field survivorship rules |
| LEAD-01 | Prospect inside the account object | Built | Converting a lead creates the account as prospect, its contact, attribution and a deal |
| PIPE-01 | Pipelines per motion with exit criteria and required fields | Built | Configuration is data; shown read-only in Administration |
| PIPE-03 | Rotting and stalled deals | Built | Days per stage, badge on the board, exception |
| PIPE-04 | Coded loss and no-sale reasons | Built | |
| PIPE-05 | Decision-maker revisit visible in the funnel | Built | Set by Sales App visit events |
| PIPE-06 | Close by transactional event | Built | Nobody can mark a deal as won; the S5 file does |
| ACT-01 | Single timeline | Built | Activities, Sales App visits, stage changes, owner changes |
| ACT-02 | Mandatory next step | Built | Enforced on every open stage |
| CAMPO-03 | Book of accounts, territories, reassignment | Built | Single account and whole book. No territory editor |
| CAMPO-04 | Supervisor board and exception queue | Built | |
| CAMPO-06 | Enrollment file and control desk | Not in this PR | Needs the document vault decision (committee #9); documents are prohibited data in the CRM |
| CANAL-05 | Commission and incentive visibility | Not in this PR | Needs committee decisions #4 and #5 |
| CS-01 | Lifecycle with owned handoffs | Built | Lifecycle driven by S5; handoff task to operations on first sale |
| CS-03 | Early alerts and playbooks | Partial | Alerts for activation risk and at-risk merchants. No playbooks |
| REP-01 | Dashboards by role | Built | Today, Supervision, Leadership panel |
| UX-01 | Account page with what matters on top | Built | |
| UX-02 | Speed, optimistic UI, search by any alias | Partial | Search by name, phone and external ID. No optimistic UI; speed not measured |
| UX-03 | Saved views as queues, useful empty states | Partial | Shared views and empty states. People cannot save their own view yet |
| GOB-03 | Adoption and usage metrics | Partial | Active days and actions per person |

## Foundation (35)
| Status | IDs |
|---|---|
| Built | DAT-01, DAT-02, DAT-03, LEAD-03, CANAL-03, AUT-01, AUT-06, SEG-01, GOB-01, GOB-08 |
| Partial | DAT-05 (registry of 5 objects fed by the Pipedrive import, values editable with type validation; no editor for definitions), CAMPO-01 (contract and intake built; no live connection), REP-02 (stage events; no snapshots), REP-04 (S5 figures with cut date; no reconciliation), AUT-02 (outbox written; no publisher), AUT-04 (three inbound endpoints with keys; no read API), MULTI-01 (minor units, dated rate; synthetic rates), MULTI-02 (legal entity, locale, time zone; UI in ES and EN), SEG-03 (immutable audit), SEG-08 (API keys hashed, shown once), GOB-02 (gaps and duplicates), GOB-04 (CI, migrations, PR template) |
| Not in this PR | DAT-07, AUT-03, AUT-07, MULTI-03, MULTI-04, SEG-02, SEG-04, SEG-07, GOB-05, GOB-07, GOB-09, GOB-10 |
| N/A | IA-07 (no AI features) |

## Deliberately out, per the committee's "what not to build"
Routing, check-in and GPS (Sales App), offline writes, commission calculation, KYB and OCR, WhatsApp inbox, visual workflow builder, free-form report builder, autonomous agents.

## Present in the earlier clickable demo, not carried into this build
Guided tour, help pages, reports page, automations page, the Pipedrive parity page. The demo remains available as a visual reference of the full scope.

## Added after the first cut: Pipedrive replacement
Read-only import of the Pipedrive configuration and records for US and MX, custom fields on merchants and deals, products on deals, and the first-transaction rule per pipeline. Detail and what is not migrated: `docs/pipedrive-migration.md`.

# ADR-007: Automations as data, a job runner, and stage steps with approval

Status: **Proposed on 12-Nov-2026 (package `automatizaciones`, migration 0019). Needs sign-off from Dan Mulligan or Michael Essiet (Tech Implementation Review) before anything here is switched on in a live environment.**

Catalog items: AUT-03, AUT-01, PIPE-02, PIPE-03, LEAD-04.

## Decision
1. **Rules are rows, not code.** `crm.automations` holds one definition per market (optionally per sales type): what it looks at (open deals, leads, merchants), when (on the scheduled check or on a domain event), conditions over a fixed catalog of fields, and one to three actions. The nine rules that used to be one SQL statement in `src/domain/rules.ts` are the seeded defaults; `evaluateRules` keeps its contract.
2. **The engine never writes a business record with its own SQL.** Every action calls the same domain function the screen uses (`moveDealTx`, `assignLeadTx`, `setWaitingOnTx`, the prohibited-data guard). A rule that blocks a person blocks the automation, and the per-rule log says why.
3. **An automation does not cross markets.** The market is part of the definition and of every query the engine builds. It cannot be changed after creation.
4. **No visual flow builder.** Conditions and actions are edited with forms. The committee ruled the canvas out.
5. **One runner for everything on a schedule.** `src/server/jobs/runner.ts`: transaction-level advisory lock per job, a run log (`crm.job_runs`), and three triggers: `POST /api/cron/run` (off unless `CRON_SECRET` is set), an opportunistic tick after an authenticated response (at most once a minute, decided in the database), and "Run now" in Administration.
6. **A stage step is data** (`crm.stage_transitions`): who may take it, whether it needs evidence, whether it needs approval, by whom, with a backup and a time limit. `moveDealTx` is the only path that changes a stage and it consults the step. Approving moves the deal in the same transaction, under the identity and limits of the person who asked.
7. **Evidence is a link with a note**, never a file. File storage is off and identity or bank documents remain prohibited data.
8. **One database invariant for every entry path**: a deal lives in a stage of its own pipeline, and the pipeline belongs to the deal's market (`crm.deal_integrity`).

## What stays off, and what turns it on
| Piece | State | To turn it on |
|---|---|---|
| External scheduled trigger | Off: the route answers 503 | Set `CRON_SECRET` (16+ characters) and have the platform call `POST /api/cron/run` every minute with `Authorization: Bearer <secret>`. `vercel.json` was not touched. |
| Opportunistic trigger | On by default | `JOBS_ON_VISIT=0` turns it off. |
| Lead escalation | Off per market | Administration > Automations > Lead escalation. |
| Steps with approval or evidence | None configured | Administration > Automations > Stage steps and approvals. |
| Notices outside CONTIGO | Not in this package | Automations, approvals and escalations notify with a task in Hoy; the notices package rewires `ruleTask`, `approvalTask` and `escalationTask`. |

## Not decided here
1. Whether invariants move from TypeScript to Postgres functions with writes only through RPC (the catalog's "how" for AUT-01). `contigo_app` still holds direct INSERT and UPDATE on `crm`. This ADR adds one trigger and a shared rule module (`src/domain/intake.ts`); the rest is for the Tech Implementation Review.
2. Who approves which step, and who the backup is (C1 and the control desk).
3. The first-contact goal for dealers, to be set from four weeks of the market's own baseline.

## Consequences
1. Events are read from `crm.outbox_events` with the engine's own cursor (`crm.settings`, key `automation_event_cursor`). The engine does not mark events as published: that belongs to whoever publishes them outward. An event committed by a transaction that stays open for more than two seconds after a later event has been read can be skipped.
2. Without the external trigger, jobs run only while someone has the app open.
3. Pausing a rule that opens queue notices closes its open notices at the next check.

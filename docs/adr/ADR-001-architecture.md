# ADR-001: Application architecture

Status: Proposed (11-Nov-2026). Decision owner: Engineering (Tech Implementation Review).

## Context
CONTIGO is a sister application of Kore with its own repository, database and deployment. The Engineering Standard v1 asks for code that runs on Vercel for staging today and moves to AWS without a rewrite.

## Decision
- Next.js App Router, server-rendered, `output: 'standalone'`. No ISR, no Vercel-only APIs.
- Three server layers, all marked `server-only`:
  - `src/domain`: commands. Each one validates with zod, checks the capability matrix (`policy.ts`), runs in one transaction, writes audit and outbox. UI actions, API routes and integrations all call the same commands.
  - `src/dal`: read queries that return plain DTOs, keyset-paginated.
  - `src/server`: connection (`withUser`, `withSystem`), request context, adapters.
- Plain PostgreSQL. SQL migrations with up and down files. No ORM and no provider SDK for data.
- Rules that open and close exceptions are one SQL statement in `src/domain/rules.ts`, evaluated on demand and at most every 15 minutes when a board is opened. A scheduler replaces the on-demand trigger once the platform is chosen.

## Consequences
- Moving to AWS changes `DATABASE_URL` and the identity adapter. No query changes.
- Forms work as real HTML forms with server actions; client JavaScript is limited to dialogs and form state.
- There is no background worker yet: the outbox is written but nothing publishes it.

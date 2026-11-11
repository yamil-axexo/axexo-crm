# ADR-002: Production platform

Status: **Open. Decision owner: Dan Mulligan, with Squad 6.**

The Engineering Standard v1 compares three options and recommends Option 3 (AWS native) for production, accepts Option 2 (Vercel web + data in AWS) and allows Option 1 (Vercel + Supabase) only for demo and staging with synthetic data.

## What this repository does today
Staging runs on Option 1: Vercel project `axexo-crm` and Supabase project `axexo-crm` (us-east-2), synthetic data only.

## What has to be decided before any real data
1. Production platform (Option 2 or 3).
2. IaC tool and container platform used by Tech (OPS-01, OPS-02).
3. AWS accounts per environment (OPS-03).
4. SLO, RPO and RTO (REL-01, REL-05).

## What the code already assumes so the decision stays cheap
Standard Postgres only, connection through a transaction-mode pooler, identity set with `set_config`, provider features behind adapters, container build verified by the E2E suite.

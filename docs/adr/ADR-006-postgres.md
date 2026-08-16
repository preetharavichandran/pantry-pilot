# ADR-006 — Postgres for v1 local and app

## Status

Accepted

## Context

SQLite was considered for zero-infra spikes. Production and sibling Life Atlas services use Postgres. Compose already needs Redis for BullMQ.

## Decision

**PostgreSQL from day one** for app and local Compose. No SQLite dialect path.

## Consequences

Requires Docker for DB locally. Migrations and types stay aligned with prod. Avoids dual-ORM / dual-SQL rework.

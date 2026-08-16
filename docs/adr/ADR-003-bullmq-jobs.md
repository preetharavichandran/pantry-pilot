# ADR-003 — BullMQ job boundaries

## Status

Accepted

## Context

Need durable async work without making inventory mutations eventually-consistent for the user.

## Decision

| Queue | Responsibility | Sync HTTP still? |
|-------|----------------|------------------|
| `plan.generate` | Optional async plan (`POST …/plans` with `async: true` → 202) | Yes — default sync generate |
| `recipe.ingest` | Apply CloudEvents (Kafka/Dev enqueue when BullMQ on) | Dev can apply sync if BullMQ off |
| `plan.confirm.deferred` | Horizon-end **nudge** only (log / future notify) | **Confirm + check-off stay sync** |

`BULLMQ_ENABLED` (default true) starts workers in-process with the API. Redis from Compose.

## Consequences

Retries for ingest/plan jobs. Inventory accuracy remains human-gated and immediate on confirm/check-off.

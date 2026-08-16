# ADR-005 — Recipe projection freshness and degraded mode

## Status

Accepted

## Context

RecipeHub is the writer; PantryPilot plans from a local projection fed by Kafka CloudEvents. Events or the broker may be down.

## Decision

- **Ingest:** Kafka topic `lifeatlas.recipes` (primary). Idempotent by CloudEvent `id` in `processed_cloud_events`.
- **Upsert** on `created`/`updated`; **soft-delete** on `deleted`.
- **No HTTP poll sync.** Local demos without Kafka may use fixture seed (`npm run seed:projections`) or Development-only `POST /dev/recipe-events` (same ingest path as Kafka).
- **Stale banner:** if newest `projected_at` is older than `PROJECTION_STALE_AFTER_MS` (default 7d), new plans set `projectionStale=true`. Planning still works from last projection.
- **Empty projection:** `POST …/plans` returns `409 empty_projection`.

## Consequences

Core pantry CRUD never depends on Kafka. Planner depends on projection contents, not live RecipeHub HTTP.

# ADR-009 — Kafka primary for recipe ingest

## Status

Accepted

## Context

RecipeHub publishes CloudEvents via console | kafka | sns | both. PantryPilot needs a durable projection. HTTP poll sync was considered for Week 1.

## Decision

**Kafka/Redpanda** is the primary ingest path (Week 2 consumer). Do **not** build an HTTP poll sync layer. Week 1 may leave projection empty; Redis is in Compose early for BullMQ, not for recipe sync.

## Consequences

One mental model for recipe freshness. SNS remains an optional later adapter for AWS demos. Depends on RecipeHub `PUBLISH_MODE=kafka` for end-to-end event demos.

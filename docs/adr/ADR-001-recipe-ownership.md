# ADR-001 — Recipe ownership in RecipeHub

## Status

Accepted

## Context

PantryPilot needs recipes for planning. Owning a second recipe store would diverge ids and break pantry matching on canonical ingredient ids.

## Decision

RecipeHub is the sole recipe writer and source of truth. PantryPilot stores a **projection** (Week 2+) and never publishes `lifeatlas.recipe.*` events. Clients create/update recipes via RecipeHub (future: RecipeHub UI / redirect). PantryPilot does **not** expose a recipe write proxy.

## Consequences

Demo “add recipe” hits RecipeHub, then events (or temporary empty projection until Week 2). Clear CV story: one writer, event-driven read model.

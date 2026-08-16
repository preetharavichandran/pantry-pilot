# ADR-008 — No recipe write proxy

## Status

Accepted

## Context

PLAN originally listed `POST/PATCH /households/{id}/recipes` as a RecipeHub proxy. Product UI for recipes belongs in RecipeHub v2; PantryPilot UI will redirect for create/update.

## Decision

Omit recipe write proxy from PantryPilot v1. Keep a **read** `RecipeHubClient` for ingredients/recipes as needed. Household↔recipe “favorites” (if any) stay local and optional.

## Consequences

Demo uses two base URLs for recipe create vs pantry. Ownership and Idempotency-Key stay on RecipeHub. Less API surface and no fake second editor.

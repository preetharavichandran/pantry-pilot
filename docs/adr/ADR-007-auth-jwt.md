# ADR-007 — JWT auth aligned with RecipeHub

## Status

Accepted

## Context

PantryPilot is multi-household; callers must be identifiable. RecipeHub already uses Dev HMAC JWT and Google OIDC (`sub` = creator).

## Decision

- Mirror RecipeHub auth modes: `Development` | `Google`.
- Local/dev: **shared** issuer, audience, and signing key with RecipeHub so one DevToken works for both APIs.
- Authorize household access by `households.owner_sub = jwt.sub`.
- v1: at most one household per `sub`.
- Prod UX (refresh-before-expiry, gateway) documented in `production-next.md`; domain API remains strict on the presented access token.

## Consequences

Coherent identity across catalog writes and pantry tenancy. Membership/invites can add `household_members` later without changing JWT shape.

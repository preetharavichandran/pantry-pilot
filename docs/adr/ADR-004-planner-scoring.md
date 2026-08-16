# ADR-004 — Planner scoring weights and test strategy

## Status

Accepted

## Context

PantryPilot v1 must pick meals deterministically from a recipe projection and coarse pantry so results are testable and never silently mutate stock.

## Decision

Greedy horizon planner scores each eligible recipe per day×slot:

| Signal | Weight (normal) | Notes |
|--------|-----------------|-------|
| Pantry overlap | 0.45 | Quantity-aware fraction of lines covered |
| Expiry urgency | 0.20 | Boost if using stock expiring within 3 days |
| Budget soft-fit | 0.15 | `1 - stubShopCost/budget` when budget set |
| Meal slot fit | 0.20 | Hard filter: non-matching slots score −∞ |
| Repeat penalty | −0.35 | Applied when recipe id already used in plan |

`objective=use_stock` (wind-down later) raises pantry/expiry weights.

Portions = household size; recipe lines are treated as authored for 2 portions (scale × size/2).

Stub unit costs live in `STUB_UNIT_COSTS` for soft budget only.

**Tests:** unit tests in `tests/planner.test.ts` cover overlap preference, repeat penalty, slot filter, expiry boost, and shopping-gap reduction when stocked.

## Consequences

Weights are API-stable via ADR; change only with a new ADR revision. Swap/replace uses the same scorer excluding the current recipe.

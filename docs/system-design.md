# System design — PantryPilot

## Role

Inventory-aware meal prep for a **household**: plan the next N days (default 3), match a coarse pantry, emit a shopping list, keep stock roughly accurate via shopping check-off and confirm-cooked.

Recipes are **not** owned here. RecipeHub is the catalog writer; PantryPilot keeps a local **recipe projection** fed by CloudEvents (`lifeatlas.recipe.*`).

## Architecture (v1)

```
Client (curl / future UI / LifeConsole)
    │  Bearer JWT (sub = user)
    ▼
PantryPilot API (+ optional in-process BullMQ workers)
    ├── domain: Household, Pantry, Plan, Shopping, Confirm
    ├── planner: deterministic scoring (pure, unit-tested)
    ├── db: PostgreSQL
    ├── RecipeHubClient (HTTP reads only — no write proxy)
    ├── Kafka consumer → (optional) BullMQ recipe.ingest → projection
    └── degraded banners when projection empty/stale
Postgres · Redis (BullMQ) · Redpanda/Kafka (optional profile)
```

## Auth & tenancy

- JWT: `Development` (shared HMAC with RecipeHub) | `Google` OIDC
- v1: **one household per `sub`**; members/invites later via `household_members`

## Core loops

1. Optional pantry **seed** (or skip) → **generate plan** → shopping list → **check-off** → restock  
2. **Confirm cooked** (`all` / `mostly`+skips / `no`) → deplete (+ optional leftovers) → re-plan  

## Degraded mode

| Condition | Behavior |
|-----------|----------|
| Empty projection | `POST …/plans` → `409 empty_projection`; `/health` → `status: degraded` + banners |
| Stale projection | Plan still generated; `plan.projectionStale=true` + `degraded.banners` |
| Kafka off | Banner on health; fixtures / `/dev/recipe-events` for local demos |
| RecipeHub HTTP down | Pantry + plan from projection still work (reads optional) |

Standalone rule: pantry CRUD never requires the bus or RecipeHub.

## Explicit non-goals (v1)

- Publishing `lifeatlas.recipe.*` (RecipeHub only)
- Recipe write proxy / recipe editor UI
- Wind-down / TripWeaver (v2)
- AI plan authority (explain/tie-break later; stock stays deterministic)

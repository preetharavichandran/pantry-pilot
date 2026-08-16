# PantryPilot

Life Atlas **Project 3** — inventory-aware meal prep (TypeScript / Node / Postgres / Redis / BullMQ / Kafka consumer).

**v1 is complete** for the local closed loop: seed/skip → plan → shop check-off → confirm cooked → re-plan.

Recipes are owned by **[RecipeHub](https://github.com/preetharavichandran/recipe-hub)**. PantryPilot never publishes `lifeatlas.recipe.*` and does not proxy recipe writes — create/update via RecipeHub (future UI redirects there).

> **Not a public GO LIVE yet.** See [docs/production-next.md](docs/production-next.md) for gateway, managed data stores, Google OIDC, and observability still required before internet exposure. Production images refuse Dev JWT unless `ALLOW_DEV_AUTH=true` (Compose lab only).

## Status

| Week | Deliverable | Status |
|------|-------------|--------|
| 1 | Household + pantry API, JWT, Compose Postgres/Redis | Done |
| 2 | Kafka projection, deterministic planner, plan/shopping APIs | Done |
| 3 | Check-off restock, confirm-cooked, BullMQ jobs | Done |
| 4 | Demo script, docs/ADRs, degraded-mode polish | Done |

## Quick start

```bash
cp .env.example .env
docker compose up -d postgres redis
npm install
npm run migrate
npm run seed:projections
npm run dev
```

Health: `GET http://localhost:3102/health` (includes `degraded` banners when projection empty/stale).

### Auth

```bash
TOKEN=$(../recipe-hub/scripts/dev-token.sh user-a)
```

Shared Dev JWT with RecipeHub (`iss` / `aud` / signing key).

## Demo (PLAN.md script)

```bash
npm run demo
```

Automated steps 1–5; step 6 documents RecipeHub create → event → projection (no PantryPilot write path).

Manual curl walkthrough:

```bash
# 1) Create household — skip pantry seed
curl -s -X POST http://localhost:3102/households \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"size":2,"budgetSoft":80,"planHorizonDays":3}'

# 2) Plan → shop-heavy list
curl -s -X POST "http://localhost:3102/households/$HOUSEHOLD_ID/plans" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'

# 3) Check off → restock
curl -s -X POST "http://localhost:3102/households/$HOUSEHOLD_ID/shopping-lists/$LIST_ID/checkoffs" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"itemIds":["…"]}'

# 4) Confirm cooked → deplete
curl -s -X POST "http://localhost:3102/households/$HOUSEHOLD_ID/plans/$PLAN_ID/confirm" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"outcome":"all"}'

# 5) Re-plan (pantry-aware)
curl -s -X POST "http://localhost:3102/households/$HOUSEHOLD_ID/plans" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'

# 6) Create recipe on RecipeHub (not here) → Kafka → next plan candidates
# See ../recipe-hub/README.md
```

## Verification

```bash
npm test
npm run smoke:week2
npm run smoke:week3
npm run demo
docker compose --profile kafka up -d && npm run e2e:kafka
```

## Kafka (optional)

```bash
docker compose --profile kafka up -d
KAFKA_ENABLED=true npm run dev
```

**Redpanda** = Kafka-compatible local broker (`localhost:19092`).

## API (v1)

| Method | Path | Auth |
|--------|------|------|
| GET | `/health` | no |
| POST | `/households` | JWT |
| GET/PATCH | `/households/{id}` | JWT |
| GET/PUT | `/households/{id}/pantry` | JWT |
| POST | `/households/{id}/plans` | JWT (`async:true` → BullMQ) |
| GET | `/households/{id}/plans/current` | JWT |
| POST | `/households/{id}/plans/{planId}/meals/{mealId}/replace` | JWT |
| POST | `/households/{id}/plans/{planId}/confirm` | JWT |
| GET | `/households/{id}/shopping-lists/current` | JWT |
| POST | `/households/{id}/shopping-lists/{listId}/checkoffs` | JWT |
| POST | `/dev/recipe-events` | JWT (Development) |

## Docs

- [system-design.md](docs/system-design.md)
- [trade-offs.md](docs/trade-offs.md)
- [production-next.md](docs/production-next.md) — **pre–GO LIVE**
- [integration.md](docs/integration.md)
- [adr/](docs/adr/)

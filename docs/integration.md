# Integration

## RecipeHub

| Direction | v1 mechanism |
|-----------|----------------|
| Outbound | HTTPS **reads** (ingredients, recipes) via `RecipeHubClient`. **No write proxy.** |
| Inbound | Kafka CloudEvents `lifeatlas.recipe.created\|updated\|deleted` → `RecipeProjection` |

**PantryPilot does not publish `lifeatlas.recipe.*`.** Recipe create/update: call **RecipeHub** directly (demo step 6).

### Local RecipeHub

- Base URL default: `http://localhost:8080`
- Reads: anonymous
- Writes: Bearer JWT + `Idempotency-Key` (not proxied)

### Events

| Setting | Default |
|---------|---------|
| Enable | `KAFKA_ENABLED=true` |
| Brokers | `localhost:19092` |
| Topic | `lifeatlas.recipes` |
| Group | `pantry-pilot` |

**Redpanda** = Kafka-protocol-compatible broker (no ZooKeeper). Idempotent by CloudEvent `id`. **No `householdId` on events.**

```bash
docker compose --profile kafka up -d
# .env: KAFKA_ENABLED=true
npm run migrate && npm run dev
npm run e2e:kafka
```

Without Kafka: `npm run seed:projections` or Development `POST /dev/recipe-events` (same ingest path — **not** HTTP poll sync).

### Demo + smokes

```bash
npm run demo          # PLAN.md steps 1–5 + RecipeHub handoff note
npm run smoke:week2
npm run smoke:week3
```

### Degraded mode

| Signal | Where |
|--------|--------|
| Empty projection | `POST …/plans` → `409 empty_projection`; `/health.status = degraded` |
| Stale projection | `plan.projectionStale` + `degraded.banners` on plan response |
| Kafka off | `/health.degraded.banners` |
| Freshness window | `PROJECTION_STALE_AFTER_MS` (default 7d) |

Pantry CRUD never depends on Kafka or RecipeHub.

## BullMQ

| Queue | Role |
|-------|------|
| `plan.generate` | Async plan when body includes `"async": true` |
| `recipe.ingest` | CloudEvent apply (Kafka/Dev enqueue when enabled) |
| `plan.confirm.deferred` | Horizon-end nudge — confirm/check-off stay **sync** |

`BULLMQ_ENABLED=true` (default) uses `REDIS_URL`.

## Auth

```bash
TOKEN=$(../recipe-hub/scripts/dev-token.sh user-a)
```

Shared Dev JWT iss/aud/key with RecipeHub. Prod: Google OIDC (see `production-next.md`).

## TripWeaver (v2)

`lifeatlas.trip.dates_changed` / `planned` → wind-down. Not in v1.

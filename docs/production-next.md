# Production next — go-live readiness

Pre–**GO LIVE** checklist for PantryPilot and the Life Atlas edge. v1 is an MVP that stays **standalone and extensible**; items below are deliberate deferrals.

Do **not** treat local Compose (direct ports, Dev JWT, single API instance) as production topology.

**v1 GitHub ship status:** the closed inventory loop, Kafka projection, BullMQ jobs, docs/ADRs, and demo are complete for portfolio review. Items in **Before GO LIVE** below are still required before a public internet deploy.

---

## Hardened in v1 (ship hygiene)

| Guard | Behavior |
|-------|----------|
| `NODE_ENV=production` + `AUTH_MODE=Development` | Refused unless `ALLOW_DEV_AUTH=true` (Compose lab only) |
| `AUTH_MODE=Google` | Requires `AUTH_GOOGLE_AUDIENCE` |
| Production `DATABASE_URL` | Must be set explicitly (no silent local default) |
| `GET /health` | `503` when Postgres is unreachable; `degraded` when projection empty |
| Docker image | `npm ci --omit=dev`; `NODE_ENV=production` |

---

## Before GO LIVE (edge & scale)

| Component | Why | Notes |
|-----------|-----|--------|
| **API Gateway** | TLS, rate limits, WAF, single hostname | Required when APIs are public-facing |
| **Load balancer** | Multi-instance without sticky sessions | Stateless JWT on each instance |
| **Managed Postgres + Redis** | Backups, TLS, credentials rotation | Replace Compose credentials |
| **Kafka / MSK (or SNS consumer)** | Live RecipeHub events in prod | Local Redpanda is lab-only |
| **Redis session / revocation** | Only if server-side sessions or refresh denylist | Access-token JWT path needs no sticky sessions |
| **Google OIDC** | Replace Dev HMAC | Same `sub` story as RecipeHub; shared SPA audience until per-API audiences |
| **Proactive token refresh** | Avoid mid-session 401s | Client/BFF refreshes **before** expiry; APIs stay strict |
| **Clock-skew leeway** | Small `exp` grace | Seconds only — not a refresh substitute |
| **Observability** | Planner latency, confirm rates, ingest lag | OpenTelemetry → shared Life Atlas exporters |
| **Separate worker process** | Scale ingest/plan independently | Today workers can co-locate with API |

### Token expiry on API → API

- Forwarded user JWT: upstream 401 → fail to client; refresh and retry at the edge  
- Service credentials (if ever): refresh once and retry  
- Domain API does **not** hold user refresh tokens  

---

## Product roadmap (post-v1)

### Wind-down + TripWeaver

- Consume `lifeatlas.trip.dates_changed` / `planned`
- Same planner with `objective=use_stock`, horizon clamped to departure
- Heavier pantry/expiry weights; clamp new SKUs on shopping list

### Receipt parse-and-confirm

- AI proposes line items → **human confirm** → pantry restock (same mutation path as check-off)
- Never silent OCR writes

### Hybrid AI explain / tie-break

- Deterministic planner remains authority for stock and plan selection
- AI may explain score breakdown or break near-ties only when wired behind an adapter

### Household members

- `household_members` (owner/member); invites UX
- Drop one-household-per-`owner_sub` uniqueness when multi-household is needed
- Shared shopping check-off

### Other

- Per-person meal overrides + optional calorie targets  
- PantryPilot UI; recipe create/edit = **redirect to RecipeHub UI**  
- LifeConsole readiness tile / BFF  
- Per-API JWT audiences when gateway exists  
- SNS consumer adapter (optional AWS demo)  

---

## Extensibility already in v1

- Postgres from day one  
- JWT `Development` \| `Google` mode switch  
- `owner_sub` unique — membership table later  
- Integrations behind ports (HTTP reads + Kafka ingest)  
- No recipe publish / no write proxy  
- Redis + BullMQ job boundaries (sync inventory mutations)  
- RFC 9457 problem+json  
- Degraded banners on `/health` and plan responses  

When adding gateway/LB/BFF: keep domain APIs auth-capable and standalone.

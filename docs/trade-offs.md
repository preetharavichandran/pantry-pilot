# Trade-offs

| Decision | Options | Chosen | Why |
|----------|---------|--------|-----|
| Primary job | Wind-down first vs meal prep first | Meal prep first | Daily dogfooding; wind-down reuses the same engine |
| Inventory accuracy | Silent deduct vs confirm-cooked | Confirm cooked | Trust > clever drift |
| Recipe writes | Proxy via PantryPilot vs RecipeHub direct | **RecipeHub direct** | One writer; future UI redirects; no duplicate editor |
| Auth | Fake headers vs JWT aligned with RecipeHub | **Shared JWT** | Coherent Life Atlas identity (`sub`) |
| Households | Many + members now vs one per user | **One per user (v1)** | Real meal-prep owner; members later without redesigning pantry |
| Database | SQLite spike vs Postgres | **Postgres day one** | Prod parity; avoid dual dialect |
| Event ingest | SNS first vs Kafka vs poll | **Kafka**; no poll sync | Matches RecipeHub handoff; skip throwaway HTTP sync |
| Planner | AI-first vs deterministic | Deterministic | Testable; Life Atlas AI rule |
| Meals | 3 mains vs B+D | B+D; lunch off | Less list noise |
| Receipts | OCR in v1 vs later | Later | Don’t block planner loop |
| BullMQ vs sync mutations | All inventory async vs sync confirm/check-off | **Sync mutations**; async plan/ingest/nudge | Users need immediate pantry truth |
| Local recipes without Kafka | Dual sync paths vs fixtures + Dev inject | Fixtures / `/dev/recipe-events` | Same ingest handler as Kafka — not a poll sync |

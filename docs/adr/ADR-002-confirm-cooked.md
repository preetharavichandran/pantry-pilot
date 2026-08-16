# ADR-002 — Coarse inventory + confirm-cooked

## Status

Accepted

## Context

Perfect per-meal logging is expensive and users abandon it. Silent auto-deduct drifts from reality.

## Decision

Keep **coarse pantry** (ingredient id + qty + optional expiry). Mutations happen only on explicit user actions:

1. Shopping **check-off** → restock  
2. **Confirm cooked** (`all` / `mostly`+skips / `no`) → deplete planned recipes (scaled like the planner)  
3. Optional **leftovers** restock on confirm  

No AI and no silent household-size deduct.

## Consequences

Trustable stock for planning. Slight under/over-count is acceptable. Extensible to receipts later behind the same confirm gate.

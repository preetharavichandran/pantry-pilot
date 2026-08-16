-- Household + coarse pantry (Week 1)
-- Extensible: add household_members later; drop unique(owner_sub) when multi-household lands.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS households (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub text NOT NULL,
  size integer NOT NULL CHECK (size >= 1 AND size <= 20),
  budget_soft numeric(12, 2) NULL,
  plan_horizon_days integer NOT NULL DEFAULT 3 CHECK (plan_horizon_days >= 1 AND plan_horizon_days <= 14),
  breakfast_enabled boolean NOT NULL DEFAULT true,
  lunch_enabled boolean NOT NULL DEFAULT false,
  dinner_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT households_owner_sub_unique UNIQUE (owner_sub)
);

CREATE TABLE IF NOT EXISTS pantry_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL,
  quantity numeric(14, 3) NOT NULL CHECK (quantity >= 0),
  unit text NOT NULL CHECK (unit IN ('pcs', 'g', 'ml', 'pack')),
  expiry_date date NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pantry_items_household_ingredient_unique UNIQUE (household_id, ingredient_id)
);

CREATE INDEX IF NOT EXISTS pantry_items_household_id_idx ON pantry_items (household_id);

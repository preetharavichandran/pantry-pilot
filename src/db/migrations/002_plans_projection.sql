-- Week 2: recipe projection + meal plans + shopping lists

CREATE TABLE IF NOT EXISTS recipe_projections (
  recipe_id uuid PRIMARY KEY,
  title text NOT NULL,
  author text NULL,
  creator_id text NULL,
  meal_slots text[] NOT NULL DEFAULT '{}',
  ingredients jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_updated_at timestamptz NOT NULL,
  deleted_at timestamptz NULL,
  projected_at timestamptz NOT NULL DEFAULT now(),
  last_event_id text NULL,
  last_event_type text NULL
);

CREATE INDEX IF NOT EXISTS recipe_projections_active_idx
  ON recipe_projections (recipe_id)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS processed_cloud_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  recipe_id uuid NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meal_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  horizon_start date NOT NULL,
  horizon_end date NOT NULL,
  objective text NOT NULL DEFAULT 'normal'
    CHECK (objective IN ('normal', 'use_stock')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'superseded')),
  projection_stale boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meal_plans_horizon_ok CHECK (horizon_end >= horizon_start)
);

CREATE UNIQUE INDEX IF NOT EXISTS meal_plans_one_active_per_household
  ON meal_plans (household_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS planned_meals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES meal_plans (id) ON DELETE CASCADE,
  meal_date date NOT NULL,
  slot text NOT NULL CHECK (slot IN ('breakfast', 'lunch', 'dinner')),
  recipe_id uuid NOT NULL,
  recipe_title text NOT NULL,
  portions numeric(8, 2) NOT NULL CHECK (portions > 0),
  score numeric(10, 4) NOT NULL,
  score_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT planned_meals_plan_date_slot UNIQUE (plan_id, meal_date, slot)
);

CREATE INDEX IF NOT EXISTS planned_meals_plan_id_idx ON planned_meals (plan_id);

CREATE TABLE IF NOT EXISTS shopping_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES meal_plans (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'superseded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shopping_lists_plan_unique UNIQUE (plan_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS shopping_lists_one_active_per_household
  ON shopping_lists (household_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS shopping_list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopping_list_id uuid NOT NULL REFERENCES shopping_lists (id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL,
  ingredient_name text NOT NULL,
  quantity numeric(14, 3) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL CHECK (unit IN ('pcs', 'g', 'ml', 'pack')),
  checked boolean NOT NULL DEFAULT false,
  CONSTRAINT shopping_list_items_unique UNIQUE (shopping_list_id, ingredient_id, unit)
);

CREATE INDEX IF NOT EXISTS shopping_list_items_list_id_idx ON shopping_list_items (shopping_list_id);

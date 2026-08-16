-- Week 3: confirmations + inventory audit helpers

ALTER TABLE meal_plans DROP CONSTRAINT IF EXISTS meal_plans_status_check;
ALTER TABLE meal_plans
  ADD CONSTRAINT meal_plans_status_check
  CHECK (status IN ('active', 'superseded', 'confirmed'));

CREATE TABLE IF NOT EXISTS plan_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES meal_plans (id) ON DELETE CASCADE,
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  outcome text NOT NULL CHECK (outcome IN ('all', 'mostly', 'no')),
  skipped_meal_ids uuid[] NOT NULL DEFAULT '{}',
  leftovers jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_confirmations_plan_unique UNIQUE (plan_id)
);

CREATE INDEX IF NOT EXISTS plan_confirmations_household_id_idx
  ON plan_confirmations (household_id);

ALTER TABLE shopping_list_items
  ADD COLUMN IF NOT EXISTS checked_at timestamptz NULL;

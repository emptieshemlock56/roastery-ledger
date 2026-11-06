-- Initial schema.
-- Rule of thumb: never edit a migration after it has run in staging or prod.
-- Add a new numbered file instead (002_..., 003_...).

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Everything that can be counted: green coffee, roasted coffee, blends,
-- packaging materials, finished (packed) products, anything else.
CREATE TABLE items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code           TEXT UNIQUE NOT NULL,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('green', 'roasted', 'blend', 'packaging', 'finished', 'other')),
  unit           TEXT NOT NULL DEFAULT 'lb',
  pack_size_oz   NUMERIC,          -- finished goods: net weight per unit
  units_per_case INTEGER,          -- finished goods: units in a case
  supplier       TEXT,
  sage_item_code TEXT,             -- for a future Sage integration
  reorder_point  NUMERIC,
  notes          TEXT,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Recipes / bills of materials. Amount of component used per 1 unit of parent:
--   roasted  <- green     e.g. 1.19 lb green per lb roasted
--   blend    <- roasted   e.g. 0.40 lb Brazil per lb of House Blend
--   finished <- blend/bag e.g. 0.75 lb blend + 1 bag + 1 label per 12oz unit
CREATE TABLE components (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_item_id    UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  component_item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  qty_per_unit      NUMERIC NOT NULL CHECK (qty_per_unit > 0),
  UNIQUE (parent_item_id, component_item_id),
  CHECK (parent_item_id <> component_item_id)
);

CREATE TABLE machines (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT UNIQUE NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'packer' CHECK (kind IN ('roaster', 'packer', 'other')),
  notes      TEXT,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The ledger. Stock is never edited directly: every change is a movement.
-- Mistakes are voided (kept for history), never deleted.
CREATE TABLE movements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        TEXT NOT NULL CHECK (kind IN ('receive', 'roast', 'blend', 'pack', 'ship', 'adjust')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  machine_id  UUID REFERENCES machines(id) ON DELETE RESTRICT,
  reference   TEXT,
  notes       TEXT,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  voided_at   TIMESTAMPTZ,
  voided_by   UUID REFERENCES users(id),
  void_reason TEXT
);
CREATE INDEX movements_occurred_at_idx ON movements (occurred_at DESC);

-- qty > 0 adds stock (received / produced), qty < 0 removes it (used / shipped).
CREATE TABLE movement_lines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_id UUID NOT NULL REFERENCES movements(id) ON DELETE CASCADE,
  item_id     UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  lot_code    TEXT,
  qty         NUMERIC(14, 4) NOT NULL CHECK (qty <> 0)
);
CREATE INDEX movement_lines_item_idx ON movement_lines (item_id);
CREATE INDEX movement_lines_movement_idx ON movement_lines (movement_id);

CREATE TABLE audit_log (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID REFERENCES users(id),
  action    TEXT NOT NULL,
  entity    TEXT NOT NULL,
  entity_id TEXT,
  details   JSONB,
  at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);

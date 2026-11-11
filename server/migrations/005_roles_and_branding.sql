-- Custom roles: an admin decides what each kind of staff member may change.
-- Everyone can always LOOK at everything; a role only lists what its people may WRITE.
-- Admins (users.role = 'admin') can do everything and have no row here.
CREATE TABLE roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT UNIQUE NOT NULL,
  description TEXT,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only added, never removed: users.role stays 'admin' or 'member'; a member's
-- permissions come from the role they point at.
ALTER TABLE users ADD COLUMN role_id UUID REFERENCES roles(id) ON DELETE RESTRICT;

-- Starting roles (all of them can be renamed, changed or deleted by an admin).
INSERT INTO roles (name, description, permissions) VALUES
  ('Staff (full access)', 'Can record everything and edit the catalog. Same as the old "member".',
   '["receive","roast","blend","pack","ship","adjust","void","catalog","import"]'::jsonb),
  ('Roast manager', 'Records roasts and blends.', '["roast","blend","void"]'::jsonb),
  ('Packing manager', 'Records packing runs.', '["pack","void"]'::jsonb),
  ('Shipping manager', 'Records deliveries received and orders shipped.', '["receive","ship","void"]'::jsonb),
  ('View only', 'Can look at stock, activity and reports but not change anything.', '[]'::jsonb);

-- Existing members keep exactly the access they had.
UPDATE users SET role_id = (SELECT id FROM roles WHERE name = 'Staff (full access)')
 WHERE role = 'member' AND role_id IS NULL;

-- The company logo (one row at most).
CREATE TABLE branding (
  id         BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  logo       BYTEA,
  logo_mime  TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

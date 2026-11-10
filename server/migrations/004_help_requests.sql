-- "Need help signing in?" requests from the sign-in page, for admins to handle.

CREATE TABLE help_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL,                      -- as typed; may not match any account
  kind        TEXT NOT NULL CHECK (kind IN ('password', 'two_factor')),
  note        TEXT,
  user_id     UUID REFERENCES users(id),          -- the matching account, if any
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id)
);
CREATE INDEX help_requests_open_idx ON help_requests (created_at DESC) WHERE resolved_at IS NULL;

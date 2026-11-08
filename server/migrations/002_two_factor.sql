-- Two-factor sign-in (authenticator app codes) and "sign out everywhere".

ALTER TABLE users ADD COLUMN totp_secret TEXT;            -- base32; set once 2FA is turned on
ALTER TABLE users ADD COLUMN totp_pending_secret TEXT;    -- during setup, before the first code is confirmed
ALTER TABLE users ADD COLUMN totp_enabled_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN totp_last_step BIGINT;       -- last 30-second step accepted (stops code reuse)
-- Bumped to sign the user out of every browser (password change, 2FA reset, "sign out everywhere").
ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;

-- Single-use recovery codes for a lost phone. Only a hash is stored.
CREATE TABLE backup_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX backup_codes_user_idx ON backup_codes (user_id);

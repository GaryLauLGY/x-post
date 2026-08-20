CREATE TABLE IF NOT EXISTS admin_credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  username citext UNIQUE NOT NULL,
  password_salt bytea NOT NULL,
  password_hash bytea NOT NULL,
  scrypt_n integer NOT NULL DEFAULT 32768 CHECK (scrypt_n >= 16384),
  scrypt_r integer NOT NULL DEFAULT 8 CHECK (scrypt_r > 0),
  scrypt_p integer NOT NULL DEFAULT 1 CHECK (scrypt_p > 0),
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea UNIQUE NOT NULL,
  csrf_hash bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS admin_sessions_user_active_idx
  ON admin_sessions(user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS admin_sessions_expiry_idx
  ON admin_sessions(expires_at);

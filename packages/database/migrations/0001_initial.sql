CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$ BEGIN CREATE TYPE user_role AS ENUM ('admin', 'editor', 'viewer'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE user_status AS ENUM ('active', 'disabled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE material_status AS ENUM ('pending', 'approved', 'rejected', 'archived'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE content_type AS ENUM ('pure_text', 'image_text', 'video', 'link', 'other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE crawl_status AS ENUM ('planned', 'running', 'partial', 'succeeded', 'failed', 'cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE audit_actor_type AS ENUM ('user', 'service'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  sha256 text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext UNIQUE NOT NULL,
  display_name text,
  role user_role NOT NULL DEFAULT 'viewer',
  status user_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE IF NOT EXISTS auth_identities (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_subject text NOT NULL,
  PRIMARY KEY (provider, provider_subject)
);

CREATE TABLE IF NOT EXISTS publishing_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  handle citext UNIQUE NOT NULL,
  avatar_object_key text,
  verified boolean NOT NULL DEFAULT false,
  name_tag text,
  accent text,
  enabled boolean NOT NULL DEFAULT true,
  source_profile_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_account_permissions (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  publishing_account_id uuid NOT NULL REFERENCES publishing_accounts(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, publishing_account_id)
);

CREATE TABLE IF NOT EXISTS source_authors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL DEFAULT 'x' CHECK (platform = 'x'),
  handle citext NOT NULL,
  display_name text NOT NULL,
  profile_url text NOT NULL,
  avatar_object_key text,
  enabled boolean NOT NULL DEFAULT true,
  minimum_impressions bigint NOT NULL DEFAULT 5000 CHECK (minimum_impressions >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, handle)
);

CREATE TABLE IF NOT EXISTS crawl_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_author_id uuid REFERENCES source_authors(id),
  requested_since timestamptz,
  requested_until timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  status crawl_status NOT NULL DEFAULT 'planned',
  coverage_complete boolean NOT NULL DEFAULT false,
  profile_fallback_used boolean NOT NULL DEFAULT false,
  partial_search_error boolean NOT NULL DEFAULT false,
  strict_verification_complete boolean NOT NULL DEFAULT false,
  raw_count integer NOT NULL DEFAULT 0 CHECK (raw_count >= 0),
  verified_count integer NOT NULL DEFAULT 0 CHECK (verified_count >= 0),
  pure_text_count integer NOT NULL DEFAULT 0 CHECK (pure_text_count >= 0),
  imported_count integer NOT NULL DEFAULT 0 CHECK (imported_count >= 0),
  updated_count integer NOT NULL DEFAULT 0 CHECK (updated_count >= 0),
  quarantined_count integer NOT NULL DEFAULT 0 CHECK (quarantined_count >= 0),
  error_summary text,
  artifact_manifest_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL DEFAULT 'x' CHECK (platform = 'x'),
  platform_post_id text NOT NULL,
  source_author_id uuid NOT NULL REFERENCES source_authors(id),
  source_url text NOT NULL CHECK (source_url ~ '^https://(x\\.com|twitter\\.com)/[^/]+/status/[0-9]+'),
  original_text text NOT NULL,
  edited_text text,
  published_at timestamptz NOT NULL,
  content_type content_type NOT NULL,
  category text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  admin_note text,
  status material_status NOT NULL DEFAULT 'pending',
  rejection_reason text,
  verified_original boolean NOT NULL DEFAULT false,
  content_hash text NOT NULL,
  first_seen_run_id uuid REFERENCES crawl_runs(id),
  last_seen_run_id uuid REFERENCES crawl_runs(id),
  migration_source_commit text,
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (platform, platform_post_id)
);

CREATE TABLE IF NOT EXISTS material_metrics (
  material_id uuid NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  views bigint CHECK (views IS NULL OR views >= 0),
  replies bigint CHECK (replies IS NULL OR replies >= 0),
  reposts bigint CHECK (reposts IS NULL OR reposts >= 0),
  likes bigint CHECK (likes IS NULL OR likes >= 0),
  bookmarks bigint CHECK (bookmarks IS NULL OR bookmarks >= 0),
  observed_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (material_id, observed_at)
);

CREATE TABLE IF NOT EXISTS material_raw_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id uuid NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  schema_version text NOT NULL,
  payload_hash text NOT NULL,
  public_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (material_id, schema_version, payload_hash)
);

CREATE TABLE IF NOT EXISTS backgrounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  object_key text UNIQUE NOT NULL,
  mime_type text NOT NULL,
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  sha256 text NOT NULL,
  source_url text,
  license_note text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS card_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  material_id uuid REFERENCES materials(id),
  publishing_account_id uuid REFERENCES publishing_accounts(id),
  background_id uuid REFERENCES backgrounds(id),
  body text NOT NULL,
  metrics_override jsonb NOT NULL DEFAULT '{}',
  settings_json jsonb NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  material_id uuid REFERENCES materials(id),
  publishing_account_id uuid REFERENCES publishing_accounts(id),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crawl_watermarks (
  source_author_id uuid PRIMARY KEY REFERENCES source_authors(id) ON DELETE CASCADE,
  continuous_through timestamptz,
  last_success_run_id uuid REFERENCES crawl_runs(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crawl_quarantine (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crawl_run_id uuid NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
  platform_post_id text,
  source_url text,
  reason text NOT NULL,
  public_metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type audit_actor_type NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS import_batches (
  id uuid PRIMARY KEY,
  source_commit text NOT NULL,
  source_manifest_sha256 text NOT NULL,
  imported_at timestamptz NOT NULL,
  material_count integer NOT NULL CHECK (material_count >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS materials_status_published_idx ON materials(status, published_at DESC);
CREATE INDEX IF NOT EXISTS materials_author_status_published_idx ON materials(source_author_id, status, published_at DESC);
CREATE INDEX IF NOT EXISTS materials_category_status_published_idx ON materials(category, status, published_at DESC);
CREATE INDEX IF NOT EXISTS materials_text_trgm_idx ON materials USING gin(original_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS material_metrics_latest_idx ON material_metrics(material_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS crawl_runs_author_created_idx ON crawl_runs(source_author_id, created_at DESC);

CREATE OR REPLACE VIEW material_current_metrics AS
SELECT DISTINCT ON (material_id)
  material_id, views, replies, reposts, likes, bookmarks, observed_at
FROM material_metrics
ORDER BY material_id, observed_at DESC;

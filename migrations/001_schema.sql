-- =============================================
-- CrackDetectX PostgreSQL Schema
-- =============================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- =============================================
-- ENUM TYPES
-- =============================================
DO $$ BEGIN
  CREATE TYPE user_type      AS ENUM ('owner', 'engineer', 'company', 'admin');
  CREATE TYPE scan_status    AS ENUM ('draft', 'queued', 'analyzing', 'detecting', 'evaluating', 'reporting', 'completed', 'failed', 'cancelled');
  CREATE TYPE risk_level     AS ENUM ('low', 'medium', 'high', 'critical');
  CREATE TYPE request_status AS ENUM ('open', 'in_review', 'awarded', 'closed', 'cancelled');
  CREATE TYPE bid_status     AS ENUM ('pending', 'accepted', 'rejected', 'withdrawn');
  CREATE TYPE contract_status AS ENUM ('active', 'completed', 'disputed', 'cancelled');
  CREATE TYPE notification_type AS ENUM ('scan_complete', 'bid_received', 'bid_accepted', 'bid_rejected', 'contract_created', 'system', 'report_ready');
  CREATE TYPE ticket_status  AS ENUM ('open', 'in_progress', 'resolved', 'closed');
  CREATE TYPE sync_status    AS ENUM ('pending', 'synced', 'failed');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- =============================================
-- USERS
-- =============================================
CREATE TABLE IF NOT EXISTS users (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name         VARCHAR(255) NOT NULL,
  email             VARCHAR(255) UNIQUE NOT NULL,
  phone             VARCHAR(30),
  phone_country_code VARCHAR(10),
  password_hash     TEXT NOT NULL,
  user_type         user_type NOT NULL DEFAULT 'owner',
  avatar_url        TEXT,
  avatar_public_id  TEXT,
  bio               TEXT,
  is_verified       BOOLEAN DEFAULT FALSE,
  is_active         BOOLEAN DEFAULT TRUE,
  email_verified    BOOLEAN DEFAULT FALSE,
  phone_verified    BOOLEAN DEFAULT FALSE,
  two_factor_enabled BOOLEAN DEFAULT FALSE,
  two_factor_secret  TEXT,
  verification_token TEXT,
  reset_token        TEXT,
  reset_token_expires TIMESTAMPTZ,
  language          VARCHAR(10) DEFAULT 'en',
  theme             VARCHAR(10) DEFAULT 'light',
  currency          VARCHAR(10) DEFAULT 'USD',
  notification_push  BOOLEAN DEFAULT TRUE,
  notification_email BOOLEAN DEFAULT TRUE,
  notification_in_app BOOLEAN DEFAULT TRUE,
  last_login        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email    ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_type     ON users(user_type);
CREATE INDEX IF NOT EXISTS idx_users_verified ON users(is_verified);

-- =============================================
-- REFRESH TOKENS
-- =============================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  device_info TEXT,
  ip_address  VARCHAR(45),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);

-- =============================================
-- AUDIT LOGS
-- =============================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  action     VARCHAR(100) NOT NULL,
  entity     VARCHAR(100),
  entity_id  UUID,
  details    JSONB,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user      ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action    ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_created   ON audit_logs(created_at);

-- =============================================
-- BUILDINGS
-- =============================================
CREATE TABLE IF NOT EXISTS buildings (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          VARCHAR(255) NOT NULL,
  address       TEXT,
  city          VARCHAR(100),
  country       VARCHAR(100),
  latitude      DECIMAL(10, 8),
  longitude     DECIMAL(11, 8),
  building_type VARCHAR(100),
  year_built    INTEGER,
  floors        INTEGER,
  area_sqm      DECIMAL(10,2),
  notes         TEXT,
  tags          TEXT[],
  images        JSONB DEFAULT '[]',
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_buildings_owner ON buildings(owner_id);
CREATE INDEX IF NOT EXISTS idx_buildings_type  ON buildings(building_type);
CREATE INDEX IF NOT EXISTS idx_buildings_loc   ON buildings(latitude, longitude);

-- =============================================
-- PROJECTS
-- =============================================
CREATE TABLE IF NOT EXISTS projects (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  building_id UUID REFERENCES buildings(id) ON DELETE SET NULL,
  start_date  DATE,
  end_date    DATE,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);

-- =============================================
-- SCANS
-- =============================================
CREATE TABLE IF NOT EXISTS scans (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  building_id       UUID REFERENCES buildings(id) ON DELETE SET NULL,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id        UUID REFERENCES projects(id) ON DELETE SET NULL,
  status            scan_status DEFAULT 'queued',
  images            JSONB DEFAULT '[]',
  location          JSONB,
  notes             TEXT,
  job_id            VARCHAR(255),
  processing_started_at TIMESTAMPTZ,
  processing_ended_at   TIMESTAMPTZ,
  ai_results        JSONB,
  health_score      DECIMAL(5,2),
  risk_level        risk_level,
  total_damages     INTEGER DEFAULT 0,
  error_message     TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scans_user      ON scans(user_id);
CREATE INDEX IF NOT EXISTS idx_scans_building  ON scans(building_id);
CREATE INDEX IF NOT EXISTS idx_scans_status    ON scans(status);
CREATE INDEX IF NOT EXISTS idx_scans_project   ON scans(project_id);

-- =============================================
-- ANNOTATIONS
-- =============================================
CREATE TABLE IF NOT EXISTS annotations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scan_id     UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  image_url   TEXT NOT NULL,
  tool_type   VARCHAR(50),
  coordinates JSONB NOT NULL,
  severity    INTEGER CHECK (severity BETWEEN 1 AND 5),
  label       VARCHAR(100),
  color       VARCHAR(20),
  notes       TEXT,
  is_ai       BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_annotations_scan ON annotations(scan_id);

-- =============================================
-- REPORTS
-- =============================================
CREATE TABLE IF NOT EXISTS reports (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scan_id         UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           VARCHAR(255),
  summary         TEXT,
  content         JSONB,
  pdf_url         TEXT,
  pdf_public_id   TEXT,
  share_token     VARCHAR(255) UNIQUE,
  share_expires_at TIMESTAMPTZ,
  is_shared       BOOLEAN DEFAULT FALSE,
  views           INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_scan      ON reports(scan_id);
CREATE INDEX IF NOT EXISTS idx_reports_user      ON reports(user_id);
CREATE INDEX IF NOT EXISTS idx_reports_token     ON reports(share_token);

-- =============================================
-- REQUESTS (Marketplace)
-- =============================================
CREATE TABLE IF NOT EXISTS requests (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  building_id UUID REFERENCES buildings(id) ON DELETE SET NULL,
  scan_id     UUID REFERENCES scans(id) ON DELETE SET NULL,
  title       VARCHAR(255) NOT NULL,
  description TEXT,
  budget_min  DECIMAL(12,2),
  budget_max  DECIMAL(12,2),
  currency    VARCHAR(10) DEFAULT 'USD',
  deadline    DATE,
  specialty   VARCHAR(100),
  location    JSONB,
  status      request_status DEFAULT 'open',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_requests_owner  ON requests(owner_id);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);

-- =============================================
-- BIDS
-- =============================================
CREATE TABLE IF NOT EXISTS bids (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id  UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  company_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  price       DECIMAL(12,2) NOT NULL,
  currency    VARCHAR(10) DEFAULT 'USD',
  timeline    INTEGER,
  proposal    TEXT,
  attachments JSONB DEFAULT '[]',
  status      bid_status DEFAULT 'pending',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(request_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_bids_request ON bids(request_id);
CREATE INDEX IF NOT EXISTS idx_bids_company ON bids(company_id);
CREATE INDEX IF NOT EXISTS idx_bids_status  ON bids(status);

-- =============================================
-- CONTRACTS
-- =============================================
CREATE TABLE IF NOT EXISTS contracts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id  UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  bid_id      UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  price       DECIMAL(12,2) NOT NULL,
  currency    VARCHAR(10) DEFAULT 'USD',
  start_date  DATE,
  end_date    DATE,
  status      contract_status DEFAULT 'active',
  terms       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contracts_owner   ON contracts(owner_id);
CREATE INDEX IF NOT EXISTS idx_contracts_company ON contracts(company_id);

-- =============================================
-- ENGINEER PROFILES (for marketplace)
-- =============================================
CREATE TABLE IF NOT EXISTS engineer_profiles (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  specialties  TEXT[],
  certifications TEXT[],
  years_exp    INTEGER,
  rating       DECIMAL(3,2) DEFAULT 0,
  total_reviews INTEGER DEFAULT 0,
  is_verified  BOOLEAN DEFAULT FALSE,
  portfolio_url TEXT,
  linkedin_url  TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- REVIEWS
-- =============================================
CREATE TABLE IF NOT EXISTS reviews (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reviewer_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewee_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contract_id  UUID REFERENCES contracts(id) ON DELETE SET NULL,
  rating       INTEGER CHECK (rating BETWEEN 1 AND 5),
  comment      TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- NOTIFICATIONS
-- =============================================
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        notification_type NOT NULL,
  title       VARCHAR(255) NOT NULL,
  body        TEXT,
  data        JSONB,
  is_read     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user   ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, is_read);

-- =============================================
-- SUPPORT TICKETS
-- =============================================
CREATE TABLE IF NOT EXISTS support_tickets (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject     VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  status      ticket_status DEFAULT 'open',
  priority    VARCHAR(20) DEFAULT 'medium',
  admin_notes TEXT,
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- OFFLINE DRAFTS
-- =============================================
CREATE TABLE IF NOT EXISTS drafts (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  building_data JSONB,
  images        JSONB DEFAULT '[]',
  notes         TEXT,
  location      JSONB,
  project_id    UUID REFERENCES projects(id) ON DELETE SET NULL,
  sync_status   sync_status DEFAULT 'pending',
  synced_scan_id UUID REFERENCES scans(id) ON DELETE SET NULL,
  error_message TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drafts_user   ON drafts(user_id);
CREATE INDEX IF NOT EXISTS idx_drafts_sync   ON drafts(sync_status);

-- =============================================
-- PUSH TOKENS
-- =============================================
CREATE TABLE IF NOT EXISTS push_tokens (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  platform   VARCHAR(20),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- UPDATED_AT TRIGGER FUNCTION
-- =============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','buildings','projects','scans','annotations','reports','requests','bids','contracts','support_tickets','drafts','engineer_profiles'] LOOP
    EXECUTE format('
      DROP TRIGGER IF EXISTS trg_updated_at_%1$s ON %1$s;
      CREATE TRIGGER trg_updated_at_%1$s
      BEFORE UPDATE ON %1$s
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    ', t);
  END LOOP;
END $$;
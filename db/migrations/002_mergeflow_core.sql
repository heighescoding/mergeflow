-- Enums
CREATE TYPE project_status AS ENUM ('setup', 'analyzing', 'reviewing', 'complete');
CREATE TYPE source_file_status AS ENUM ('processing', 'complete', 'error');
CREATE TYPE field_type AS ENUM ('text', 'number', 'email', 'date', 'boolean', 'enum_type', 'currency', 'identifier');
CREATE TYPE field_status AS ENUM ('mapped', 'missing', 'review_needed', 'confirmed');
CREATE TYPE record_status AS ENUM ('pending', 'approved', 'excluded', 'discussing', 'consolidated');
CREATE TYPE rule_type AS ENUM ('required', 'unique', 'email_format', 'allowed_values', 'data_type', 'regex', 'min_length', 'max_length');

-- Migration Projects
CREATE TABLE IF NOT EXISTS migration_projects (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  source_org TEXT NOT NULL,
  destination_org TEXT NOT NULL,
  description TEXT,
  status project_status NOT NULL DEFAULT 'setup',
  created_by_id INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Source Files
CREATE TABLE IF NOT EXISTS source_files (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES migration_projects(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  columns TEXT[] NOT NULL DEFAULT '{}',
  status source_file_status NOT NULL DEFAULT 'processing',
  uploaded_by_id INTEGER NOT NULL,
  uploaded_at TIMESTAMP DEFAULT NOW()
);

-- Destination Fields (Schema)
CREATE TABLE IF NOT EXISTS destination_fields (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES migration_projects(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  field_type field_type NOT NULL DEFAULT 'text',
  required BOOLEAN NOT NULL DEFAULT false,
  source_mapping TEXT,
  allowed_values TEXT[],
  description TEXT,
  status field_status NOT NULL DEFAULT 'missing',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Validation Rules
CREATE TABLE IF NOT EXISTS validation_rules (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES migration_projects(id) ON DELETE CASCADE,
  field_id INTEGER REFERENCES destination_fields(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  rule_type rule_type NOT NULL,
  rule_config JSONB,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Migration Records
CREATE TABLE IF NOT EXISTS migration_records (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES migration_projects(id) ON DELETE CASCADE,
  source_file_id INTEGER NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  data JSONB NOT NULL,
  status record_status NOT NULL DEFAULT 'pending',
  ai_confidence REAL,
  ai_reasoning TEXT,
  ai_issue_type TEXT,
  ai_issue_summary TEXT,
  validation_errors JSONB,
  reviewed_by_id INTEGER,
  reviewed_at TIMESTAMP,
  review_note TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Record Discussions
CREATE TABLE IF NOT EXISTS record_discussions (
  id SERIAL PRIMARY KEY,
  record_id INTEGER NOT NULL REFERENCES migration_records(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES migration_projects(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_by_id INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Audit Log
CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES migration_projects(id) ON DELETE CASCADE,
  record_id INTEGER REFERENCES migration_records(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details TEXT,
  performed_by_id INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

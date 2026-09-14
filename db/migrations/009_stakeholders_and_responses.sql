-- Migration stakeholders directory
CREATE TABLE IF NOT EXISTS migration_stakeholders (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  organization TEXT NOT NULL DEFAULT 'source',
  role TEXT NOT NULL DEFAULT 'Other',
  is_app_user BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_by_id INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Link discussions to stakeholder records
ALTER TABLE record_discussions ADD COLUMN IF NOT EXISTS stakeholder_id INTEGER;

-- Discussion responses for back-and-forth
CREATE TABLE IF NOT EXISTS discussion_responses (
  id SERIAL PRIMARY KEY,
  discussion_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  is_internal BOOLEAN NOT NULL DEFAULT false,
  created_by_id INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

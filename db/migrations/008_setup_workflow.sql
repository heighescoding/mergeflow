-- Add guided setup tracking to migration_projects
-- DEFAULT TRUE so existing projects are treated as already set up
ALTER TABLE migration_projects ADD COLUMN IF NOT EXISTS setup_step INTEGER NOT NULL DEFAULT 6;
ALTER TABLE migration_projects ADD COLUMN IF NOT EXISTS setup_complete BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE migration_projects ADD COLUMN IF NOT EXISTS reference_data_skipped BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE migration_projects ADD COLUMN IF NOT EXISTS stakeholders TEXT;

-- Reference files: destination system existing records for cross-system duplicate detection
CREATE TABLE IF NOT EXISTS reference_files (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  columns TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'complete',
  uploaded_by_id INTEGER NOT NULL,
  uploaded_at TIMESTAMP DEFAULT NOW()
);

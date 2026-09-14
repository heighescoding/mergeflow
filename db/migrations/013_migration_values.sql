-- Migration values: stores overrides from the original source value to what will actually be migrated.
-- Original source data is never modified; overrides live here.
CREATE TABLE IF NOT EXISTS migration_values (
  id SERIAL PRIMARY KEY,
  record_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  field_name TEXT NOT NULL,
  original_source_value TEXT,
  migration_value TEXT,
  previous_migration_value TEXT,
  changed_by_id INTEGER NOT NULL,
  changed_at TIMESTAMP DEFAULT NOW(),
  reason TEXT,
  discussion_id INTEGER,
  UNIQUE(record_id, field_name)
);

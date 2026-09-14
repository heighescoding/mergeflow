-- Store actual reference data rows for cross-system duplicate detection
ALTER TABLE reference_files ADD COLUMN IF NOT EXISTS data jsonb DEFAULT '[]'::jsonb;

-- Store per-project source-column policies (keep/ignore/review)
ALTER TABLE migration_projects ADD COLUMN IF NOT EXISTS source_column_policies jsonb DEFAULT '{}'::jsonb;

-- Add requirement source tracking to destination_fields
CREATE TYPE requirement_source AS ENUM ('manual', 'ai_suggested');

ALTER TABLE destination_fields
  ADD COLUMN requirement_source requirement_source NOT NULL DEFAULT 'manual',
  ADD COLUMN is_confirmed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN is_unique BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN confirmed_by_id INTEGER,
  ADD COLUMN confirmed_at TIMESTAMP;

-- Treat all existing manually-added fields as confirmed
UPDATE destination_fields SET is_confirmed = true WHERE requirement_source = 'manual';

-- Add analysis state tracking to migration_projects
ALTER TABLE migration_projects
  ADD COLUMN analysis_outdated BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN requirements_confirmed_at TIMESTAMP,
  ADD COLUMN requirements_confirmed_by_id INTEGER;

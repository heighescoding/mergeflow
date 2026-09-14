-- Add 'finalized' status to project_status enum
ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'finalized';

-- Add finalization columns to migration_projects
ALTER TABLE migration_projects ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMP;
ALTER TABLE migration_projects ADD COLUMN IF NOT EXISTS finalized_by_id INTEGER;
ALTER TABLE migration_projects ADD COLUMN IF NOT EXISTS finalization_snapshot JSONB;

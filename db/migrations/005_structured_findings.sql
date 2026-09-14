-- Add structured finding columns to migration_records
ALTER TABLE migration_records
  ADD COLUMN IF NOT EXISTS destination_rule_findings jsonb,
  ADD COLUMN IF NOT EXISTS ai_analysis_findings jsonb;

ALTER TABLE migration_records
  ADD COLUMN IF NOT EXISTS recommended_disposition TEXT,
  ADD COLUMN IF NOT EXISTS recommended_disposition_reason TEXT,
  ADD COLUMN IF NOT EXISTS duplicate_record_ids JSONB,
  ADD COLUMN IF NOT EXISTS duplicate_confidence REAL,
  ADD COLUMN IF NOT EXISTS duplicate_evidence JSONB,
  ADD COLUMN IF NOT EXISTS suggested_question TEXT;

-- Enhance audit_log with richer context fields
ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS previous_state TEXT,
  ADD COLUMN IF NOT EXISTS new_state TEXT,
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS linked_record_ids JSONB,
  ADD COLUMN IF NOT EXISTS action_context JSONB;

-- Consolidations table to track merge decisions
CREATE TABLE IF NOT EXISTS consolidations (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL,
  surviving_record_id INTEGER NOT NULL,
  merged_record_ids JSONB NOT NULL DEFAULT '[]',
  field_selections JSONB NOT NULL DEFAULT '{}',
  reason TEXT,
  performed_by_id INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Expand record_discussions to be a proper discussion/question item
ALTER TABLE record_discussions
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS stakeholder TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS discussion_status TEXT NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS resolution TEXT,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS resolved_by_id INTEGER,
  ADD COLUMN IF NOT EXISTS finding_ref TEXT;

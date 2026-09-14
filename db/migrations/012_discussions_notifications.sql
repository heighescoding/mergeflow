-- Add multi-record, participants, and email-opt-in fields to record_discussions
ALTER TABLE record_discussions ADD COLUMN IF NOT EXISTS linked_record_ids JSONB DEFAULT '[]';
ALTER TABLE record_discussions ADD COLUMN IF NOT EXISTS participants JSONB DEFAULT '[]';
ALTER TABLE record_discussions ADD COLUMN IF NOT EXISTS notify_by_email BOOLEAN NOT NULL DEFAULT false;

-- In-app notifications
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  discussion_id INTEGER,
  record_id INTEGER,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read) WHERE is_read = false;

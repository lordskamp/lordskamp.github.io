CREATE TABLE IF NOT EXISTS photo_processing (
  batch_id TEXT PRIMARY KEY REFERENCES photo_batches(id),
  status TEXT NOT NULL DEFAULT 'collecting',
  telegram_message_id INTEGER,
  completed INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  rows_json TEXT,
  completion_notified_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS photo_processing_status ON photo_processing(status, updated_at);
INSERT INTO photo_processing(batch_id, status, updated_at) SELECT id, 'collecting', created_at FROM photo_batches WHERE EXISTS (SELECT 1 FROM photo_batch_items WHERE batch_id = photo_batches.id) ON CONFLICT(batch_id) DO NOTHING;

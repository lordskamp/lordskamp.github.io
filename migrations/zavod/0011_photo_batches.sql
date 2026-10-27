CREATE TABLE IF NOT EXISTS photo_batches (
  id TEXT PRIMARY KEY,
  telegram_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  closed_at TEXT,
  notified_at TEXT,
  notify_claimed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS photo_batches_open_user ON photo_batches(telegram_id) WHERE closed_at IS NULL;
CREATE TABLE IF NOT EXISTS photo_batch_items (
  update_id INTEGER PRIMARY KEY REFERENCES photo_inbox(update_id),
  batch_id TEXT NOT NULL REFERENCES photo_batches(id)
);
CREATE INDEX IF NOT EXISTS photo_batch_items_batch ON photo_batch_items(batch_id, update_id);

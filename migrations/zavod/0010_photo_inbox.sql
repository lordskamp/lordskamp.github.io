CREATE TABLE IF NOT EXISTS photo_inbox (
  update_id INTEGER PRIMARY KEY,
  telegram_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  received_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS photo_inbox_user ON photo_inbox(telegram_id, received_at DESC);

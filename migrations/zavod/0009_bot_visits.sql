CREATE TABLE IF NOT EXISTS bot_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  username TEXT,
  first_name TEXT,
  visited_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bot_visits_time ON bot_visits(visited_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS shyfr_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER
);

CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  base_id TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'all',
  data TEXT NOT NULL CHECK (json_valid(data)),
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  UNIQUE (base_id, color)
);
CREATE TABLE IF NOT EXISTS measurements (
  id TEXT PRIMARY KEY,
  base_id TEXT NOT NULL,
  color TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS measurements_created ON measurements(created_at DESC, id);
CREATE TABLE IF NOT EXISTS recipe_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  data TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS recipe_before_update BEFORE UPDATE ON recipes
BEGIN
  INSERT INTO recipe_history(recipe_id, revision, data, recorded_at)
  VALUES(OLD.id, OLD.revision, OLD.data, OLD.updated_at);
END;
CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value TEXT NOT NULL);

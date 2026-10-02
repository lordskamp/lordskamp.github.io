ALTER TABLE measurements ADD COLUMN deleted_at TEXT;
ALTER TABLE measurements ADD COLUMN deleted_by TEXT;
ALTER TABLE measurements ADD COLUMN withdrawn_at TEXT;
CREATE INDEX measurements_visible_created ON measurements(deleted_at, created_at DESC, id DESC);

-- Each marketing variant can keep its own calibration, even when it shares
-- an original handwritten base with another name.
DROP TRIGGER IF EXISTS recipe_before_update;
ALTER TABLE recipes RENAME TO recipes_legacy;
CREATE TABLE recipes (
  id TEXT PRIMARY KEY,
  base_id TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'all',
  data TEXT NOT NULL CHECK (json_valid(data)),
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  retired_at TEXT
);
INSERT INTO recipes(id, base_id, color, data, revision, updated_at)
SELECT
  CASE WHEN json_extract(data, '$.optionId') IS NOT NULL
    THEN json_extract(data, '$.optionId') || '::' || id ELSE id END,
  base_id, color,
  CASE WHEN json_extract(data, '$.optionId') IS NOT NULL
    THEN json_set(data, '$.id', json_extract(data, '$.optionId') || '::' || id) ELSE data END,
  revision, updated_at
FROM recipes_legacy;
UPDATE recipe_history
SET recipe_id = CASE WHEN json_extract(data, '$.optionId') IS NOT NULL THEN
    json_extract(data, '$.optionId') || '::' ||
    COALESCE(json_extract(data, '$.baseId') || CASE WHEN json_extract(data, '$.color') <> 'all' THEN '~' || json_extract(data, '$.color') ELSE '' END, recipe_id)
  ELSE COALESCE((
    SELECT CASE WHEN json_extract(legacy.data, '$.optionId') IS NOT NULL
      THEN json_extract(legacy.data, '$.optionId') || '::' || legacy.id ELSE legacy.id END
    FROM recipes_legacy legacy WHERE legacy.id = recipe_history.recipe_id
  ), recipe_id) END;
UPDATE recipe_history SET data = json_set(data, '$.id', recipe_id);
-- Older variants may have been overwritten in the shared base/color slot.
-- Recover their most recent published calibration from the retained history.
INSERT INTO recipes(id, base_id, color, data, revision, updated_at)
SELECT recipe_id, json_extract(data, '$.baseId'), json_extract(data, '$.color'), data, revision, recorded_at
FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY recipe_id ORDER BY revision DESC, id DESC) AS position
  FROM recipe_history
  WHERE json_extract(data, '$.origin') = 'measurement' AND json_extract(data, '$.optionId') IS NOT NULL
)
WHERE position = 1
ON CONFLICT(id) DO NOTHING;
DROP TABLE recipes_legacy;
CREATE INDEX recipes_base_color ON recipes(base_id, color);
CREATE TRIGGER recipe_before_update BEFORE UPDATE ON recipes
BEGIN
  INSERT INTO recipe_history(recipe_id, revision, data, recorded_at)
  VALUES(OLD.id, OLD.revision, OLD.data, OLD.updated_at);
END;

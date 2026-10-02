-- Operating settings depend on the number of active extruders. Preserve the
-- original journal colours while combining published settings by mode.
CREATE TABLE recipe_aliases (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL
);
CREATE TABLE recipe_mode_migration AS
WITH classified AS (
  SELECT r.*,
    CASE WHEN json_extract(r.data, '$.origin') = 'measurement' THEN json_extract(r.data, '$.mode')
      ELSE COALESCE((SELECT json_extract(h.data, '$.mode') FROM recipe_history h
        WHERE h.recipe_id = r.id AND json_extract(h.data, '$.origin') = 'measurement'
        ORDER BY h.recorded_at DESC, h.revision DESC, h.id DESC LIMIT 1), json_extract(r.data, '$.mode')) END AS operating_mode,
    CASE WHEN json_extract(r.data, '$.origin') = 'measurement' OR json_extract(r.data, '$.optionId') IS NOT NULL
      OR EXISTS(SELECT 1 FROM recipe_history h WHERE h.recipe_id = r.id AND json_extract(h.data, '$.origin') = 'measurement')
      THEN 1 ELSE 0 END AS calibrated
  FROM recipes r
)
SELECT id AS old_id,
  CASE WHEN calibrated = 1 AND operating_mode IN ('single', 'dual') THEN
    CASE WHEN json_extract(data, '$.optionId') IS NOT NULL THEN json_extract(data, '$.optionId') || '::' ELSE '' END
      || base_id || '~' || operating_mode
    ELSE id END AS new_id
FROM classified;
INSERT INTO recipe_aliases(id, recipe_id)
SELECT old_id, new_id FROM recipe_mode_migration WHERE old_id <> new_id;

-- Current rows of older colour slots become previous published values when a
-- newer colour slot of the same mode is selected below.
INSERT INTO recipe_history(recipe_id, revision, data, recorded_at)
SELECT ranked.id, ranked.revision, ranked.data, ranked.updated_at FROM (
  SELECT r.*, ROW_NUMBER() OVER (PARTITION BY mapping.new_id ORDER BY
    CASE WHEN r.retired_at IS NULL AND json_extract(r.data, '$.origin') = 'measurement' THEN 0 WHEN r.retired_at IS NULL THEN 1 ELSE 2 END,
    r.updated_at DESC, r.revision DESC, r.id DESC) AS position
  FROM recipes r JOIN recipe_mode_migration mapping ON mapping.old_id = r.id
) ranked
WHERE ranked.position > 1 AND json_extract(ranked.data, '$.origin') = 'measurement'
  AND NOT EXISTS(SELECT 1 FROM recipe_history h WHERE json_extract(h.data, '$.measurementId') = json_extract(ranked.data, '$.measurementId'));
UPDATE recipe_history SET recipe_id = COALESCE((SELECT new_id FROM recipe_mode_migration WHERE old_id = recipe_history.recipe_id), recipe_id);
UPDATE recipe_history SET data = json_set(data, '$.id', recipe_id);

CREATE TABLE recipes_by_mode (
  id TEXT PRIMARY KEY,
  base_id TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'all',
  data TEXT NOT NULL CHECK (json_valid(data)),
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  retired_at TEXT
);
INSERT INTO recipes_by_mode(id, base_id, color, data, revision, updated_at, retired_at)
SELECT new_id, base_id,
  CASE WHEN new_id <> id THEN 'all' ELSE color END,
  CASE WHEN new_id <> id THEN json_set(data, '$.id', new_id, '$.color', 'all') ELSE data END,
  revision, updated_at, retired_at
FROM (
  SELECT r.*, mapping.new_id,
    ROW_NUMBER() OVER (PARTITION BY mapping.new_id ORDER BY
      CASE WHEN r.retired_at IS NULL AND json_extract(r.data, '$.origin') = 'measurement' THEN 0 WHEN r.retired_at IS NULL THEN 1 ELSE 2 END,
      r.updated_at DESC, r.revision DESC, r.id DESC) AS position
  FROM recipes r JOIN recipe_mode_migration mapping ON mapping.old_id = r.id
)
WHERE position = 1;
DROP TRIGGER recipe_before_update;
DROP TABLE recipes;
ALTER TABLE recipes_by_mode RENAME TO recipes;
CREATE INDEX recipes_base_color ON recipes(base_id, color);
CREATE TRIGGER recipe_before_update BEFORE UPDATE ON recipes
BEGIN
  INSERT INTO recipe_history(recipe_id, revision, data, recorded_at)
  VALUES(OLD.id, OLD.revision, OLD.data, OLD.updated_at);
END;
DROP TABLE recipe_mode_migration;

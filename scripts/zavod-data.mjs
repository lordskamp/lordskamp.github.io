import { writeFile } from 'node:fs/promises';
import { CABLES, RECIPES } from '../Zavod/data.js';

const updatedAt = '2026-09-29T00:00:00.000Z';
const recipes = RECIPES.map(row => ({ ...row, baseId: row.id, color: 'all', origin: 'handwritten', revision: 1, updatedAt }));
const catalog = { cables: CABLES, recipes, updatedAt, source: 'snapshot' };
await writeFile(new URL('../Zavod/catalog.json', import.meta.url), JSON.stringify(catalog, null, 2) + '\n');
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const sql = recipes.map(row => `INSERT INTO recipes(id,base_id,color,data,revision,updated_at) VALUES(${quote(row.id)},${quote(row.id)},'all',${quote(JSON.stringify(row))},1,${quote(updatedAt)}) ON CONFLICT(id) DO NOTHING;`).join('\n');
await writeFile(new URL('../migrations/zavod/0002_seed.sql', import.meta.url), '-- Initial handwritten records. Never overwrite subsequent measurements.\n' + sql + '\n');
console.log(`Prepared ${recipes.length} rows.`);

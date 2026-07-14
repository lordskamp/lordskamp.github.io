import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { automaticLevelId, normalizeShyfrText, parseSource } from '../api/shyfr-content.js';

export { automaticLevelId, normalizeShyfrText, parseSource } from '../api/shyfr-content.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT_ROOT = path.join(ROOT, 'content', 'shyfr');
const PRIVATE_KV_OUTPUT = path.join(ROOT, 'outputs', 'shyfr-private-kv.json');
const UKRAINIAN_LETTER_RE = /[А-ЩЬЮЯЄІЇҐ]/giu;
const DISALLOWED_LETTER_RE = /[ЁЪЫЭёъыэ]/u;

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function readJsonOrEmpty(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

export async function loadShyfrContent(root = CONTENT_ROOT, { privateMode = false } = {}) {
  const categories = await readJson(path.join(CONTENT_ROOT, 'categories.json'));
  const publicCounts = new Map();
  if (privateMode) {
    for (const category of categories) {
      const publicItems = await readJsonOrEmpty(path.join(CONTENT_ROOT, `${category.id}.json`));
      publicCounts.set(category.id, publicItems.length);
    }
  }

  const levels = [];
  for (const category of categories) {
    const items = await readJsonOrEmpty(path.join(root, `${category.id}.json`));
    if (!Array.isArray(items)) throw new Error(`${category.id}.json має містити масив.`);
    items.forEach((item, index) => {
      const order = (privateMode ? publicCounts.get(category.id) || 0 : 0) + index + 1;
      levels.push({
        id: automaticLevelId(category.id, item?.text),
        categoryId: category.id,
        order,
        text: item?.text,
        source: parseSource(item?.source),
        free: category.free || (!privateMode && index < Number(category.previewLevels || 0)),
        __raw: item,
        __file: `${category.id}.json`,
        __index: index
      });
    });
  }
  return { categories, levels };
}

export async function validateShyfrContent({ root = CONTENT_ROOT, privateMode = false } = {}) {
  const result = await loadShyfrContent(root, { privateMode });
  const errors = [];
  const warnings = [];
  const ids = new Set();
  const normalized = new Map();
  const colors = new Set();
  const accents = new Set();
  const categoriesById = new Map(result.categories.map(category => [category.id, category]));

  for (const category of result.categories) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(category.id)) errors.push(`Некоректний ID категорії ${category.id}.`);
    const color = String(category.color || '').toLowerCase();
    const accent = String(category.accent || '').toLowerCase();
    if (!/^#[0-9a-f]{6}$/u.test(color)) errors.push(`Колір категорії ${category.id} має бути у форматі #RRGGBB.`);
    if (!/^#[0-9a-f]{6}$/u.test(accent)) errors.push(`Акцент категорії ${category.id} має бути у форматі #RRGGBB.`);
    if (colors.has(color)) errors.push(`Колір категорії ${category.id} не унікальний.`);
    if (accents.has(accent)) errors.push(`Акцент категорії ${category.id} не унікальний.`);
    if (color === accent) errors.push(`Колір і акцент категорії ${category.id} мають відрізнятися.`);
    colors.add(color);
    accents.add(accent);
  }

  if (privateMode) {
    const publicContent = await loadShyfrContent();
    for (const level of publicContent.levels) normalized.set(normalizeShyfrText(level.text), level.id);
  }

  for (const level of result.levels) {
    const location = `${level.__file}:${level.__index + 1}`;
    const rawKeys = level.__raw && typeof level.__raw === 'object' && !Array.isArray(level.__raw)
      ? Object.keys(level.__raw).sort()
      : [];
    if (rawKeys.join(',') !== 'source,text') errors.push(`${location}: дозволені лише поля text і source.`);
    if (typeof level.text !== 'string' || !level.text.trim()) errors.push(`${location}: text має бути непорожнім рядком.`);
    if (typeof level.__raw?.source !== 'string' || !level.__raw.source.trim()) errors.push(`${location}: source має бути непорожнім рядком.`);
    if (!level.source.label) errors.push(`${location}: перед посиланням має бути назва джерела.`);
    if (level.source.url) {
      try {
        const url = new URL(level.source.url);
        if (url.protocol !== 'https:') throw new Error('HTTPS required');
      } catch (_error) {
        errors.push(`${location}: некоректне HTTPS-посилання у source.`);
      }
    }
    const category = categoriesById.get(level.categoryId);
    if (!category) errors.push(`${location}: невідома категорія.`);
    if (!privateMode && !category?.free && level.__index >= Number(category?.previewLevels || 0)) {
      errors.push(`${location}: платний текст не можна зберігати в публічному репозиторії.`);
    }
    if (privateMode && category?.free) errors.push(`${location}: безкоштовні категорії мають залишатися у публічному наборі.`);
    const letters = new Set((String(level.text).match(UKRAINIAN_LETTER_RE) || []).map(letter => letter.toLocaleUpperCase('uk-UA')));
    if (letters.size < 4) errors.push(`${location}: потрібно щонайменше чотири різні українські літери.`);
    if (DISALLOWED_LETTER_RE.test(String(level.text))) errors.push(`${location}: знайдено непідтримувану літеру.`);
    if (/\r|\n|\t/u.test(String(level.text))) errors.push(`${location}: переноси й табуляції слід замінити пробілами.`);
    if (String(level.text).length < 24) warnings.push(`${location}: фраза може бути надто короткою.`);
    if (String(level.text).length > 300) warnings.push(`${location}: фраза може бути незручною на телефоні.`);
    if (ids.has(level.id)) errors.push(`${location}: колізія автоматичного ID ${level.id}.`);
    ids.add(level.id);
    const key = normalizeShyfrText(level.text);
    if (normalized.has(key)) errors.push(`${location}: дублікат рівня ${normalized.get(key)}.`);
    else normalized.set(key, level.id);
  }

  return { ...result, errors, warnings };
}

function cleanLevels(levels) {
  return levels.map(({ __raw, __file, __index, ...level }) => level);
}

export async function buildPrivateKv({ root, output = PRIVATE_KV_OUTPUT } = {}) {
  if (!root) throw new Error('Задайте SHYFR_PRIVATE_CONTENT_ROOT поза публічним репозиторієм.');
  const resolved = path.resolve(root);
  if (resolved.startsWith(`${ROOT}${path.sep}`) || resolved === ROOT) throw new Error('Приватний контент має бути поза репозиторієм.');
  const result = await validateShyfrContent({ root: resolved, privateMode: true });
  if (result.errors.length) throw new Error(result.errors.join('\n'));
  const payload = [{ key: 'shyfr:content:catalog', value: JSON.stringify(cleanLevels(result.levels)) }];
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(payload, null, 2), 'utf8');
  return { levels: result.levels.length, output, warnings: result.warnings };
}

async function main() {
  const command = process.argv[2] || 'validate';
  if (command === 'private-kv') {
    const result = await buildPrivateKv({
      root: process.env.SHYFR_PRIVATE_CONTENT_ROOT,
      output: process.env.SHYFR_PRIVATE_KV_OUTPUT ? path.resolve(process.env.SHYFR_PRIVATE_KV_OUTPUT) : undefined
    });
    result.warnings.forEach(warning => console.warn(`WARN ${warning}`));
    console.log(`Шифр: підготовлено ${result.levels} приватних рівнів для KV.`);
    return;
  }
  const result = await validateShyfrContent();
  result.warnings.forEach(warning => console.warn(`WARN ${warning}`));
  if (result.errors.length) {
    result.errors.forEach(error => console.error(`ERROR ${error}`));
    process.exitCode = 1;
    return;
  }
  console.log(command === 'duplicates'
    ? `Шифр: дублікатів серед ${result.levels.length} рівнів не знайдено.`
    : `Шифр: контент валідний — ${result.categories.length} категорій, ${result.levels.length} рівнів.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

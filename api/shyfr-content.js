const DEFAULT_CONTENT_BASE_URL = 'https://lordskamp.github.io/content/shyfr';
const DEFAULT_CACHE_SECONDS = 60;

let cachedPublicContent = null;

export function normalizeShyfrText(value) {
  return String(value || '')
    .normalize('NFC')
    .toLocaleLowerCase('uk-UA')
    .replace(/[ʼ'`]/g, '’')
    .replace(/[\p{P}\p{S}\s]+/gu, ' ')
    .trim();
}

function shortHash(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

export function automaticLevelId(categoryId, text) {
  return `shyfr-${categoryId}-${shortHash(normalizeShyfrText(text))}`;
}

export function parseSource(value) {
  const source = String(value || '').trim();
  const separator = source.lastIndexOf(' | ');
  if (separator < 0) return { label: source, url: null };
  return { label: source.slice(0, separator).trim(), url: source.slice(separator + 3).trim() || null };
}

export function levelsFromJson(categories, itemsByCategory) {
  return categories.flatMap(category => {
    const items = itemsByCategory[category.id] || [];
    if (!Array.isArray(items)) throw new Error(`${category.id}.json має містити масив.`);
    return items.map((item, index) => ({
      id: automaticLevelId(category.id, item?.text),
      categoryId: category.id,
      order: index + 1,
      text: item?.text,
      source: parseSource(item?.source),
      free: category.free || index < Number(category.previewLevels || 0)
    }));
  });
}

function cacheSeconds(env) {
  const value = Number(env.SHYFR_CONTENT_CACHE_SECONDS);
  return Number.isSafeInteger(value) && value >= 0 ? value : DEFAULT_CACHE_SECONDS;
}

function contentBaseUrl(env) {
  return String(env.SHYFR_CONTENT_BASE_URL || DEFAULT_CONTENT_BASE_URL).replace(/\/+$/u, '');
}

async function fetchJson(url, ttl, { optional = false } = {}) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    cf: { cacheEverything: true, cacheTtl: ttl }
  });
  if (optional && response.status === 404) return [];
  if (!response.ok) throw new Error(`SHYFR_CONTENT_FETCH_FAILED:${response.status}:${url}`);
  return response.json();
}

export async function loadPublicShyfrContent(env = {}) {
  if (env.SHYFR_PUBLIC_CONTENT) return env.SHYFR_PUBLIC_CONTENT;
  const baseUrl = contentBaseUrl(env);
  const ttl = cacheSeconds(env);
  const now = Date.now();
  if (cachedPublicContent?.baseUrl === baseUrl && cachedPublicContent.expiresAt > now) return cachedPublicContent.value;
  try {
    const categories = await fetchJson(`${baseUrl}/categories.json`, ttl);
    if (!Array.isArray(categories)) throw new Error('SHYFR_CATEGORIES_INVALID');
    const entries = await Promise.all(categories.map(async category => [
      category.id,
      await fetchJson(`${baseUrl}/${category.id}.json`, ttl, { optional: true })
    ]));
    const value = { categories, levels: levelsFromJson(categories, Object.fromEntries(entries)) };
    cachedPublicContent = { baseUrl, expiresAt: now + ttl * 1000, value };
    return value;
  } catch (error) {
    if (cachedPublicContent?.baseUrl === baseUrl) return cachedPublicContent.value;
    throw error;
  }
}

export function clearPublicShyfrContentCache() {
  cachedPublicContent = null;
}

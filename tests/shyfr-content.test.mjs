import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { clearPublicShyfrContentCache, loadPublicShyfrContent } from '../api/shyfr-content.js';
import {
  automaticLevelId,
  buildPrivateKv,
  loadShyfrContent,
  normalizeShyfrText,
  parseSource,
  validateShyfrContent
} from '../scripts/shyfr-content.mjs';

test('Worker читає категорії та рівні безпосередньо з публічних JSON', async t => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const categories = [{ id: 'tutorial', title: 'Навчання', color: '#58d6c7', accent: '#167a70', free: true, previewLevels: 0 }];
  const items = [{ text: 'Це достатньо довгий тестовий рівень для перевірки читання', source: 'Тест' }];
  globalThis.fetch = async url => {
    calls.push(String(url));
    const body = String(url).endsWith('/categories.json') ? categories : items;
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  };
  t.after(() => { globalThis.fetch = originalFetch; clearPublicShyfrContentCache(); });
  clearPublicShyfrContentCache();
  const env = { SHYFR_CONTENT_BASE_URL: 'https://content.test/shyfr', SHYFR_CONTENT_CACHE_SECONDS: '60' };
  const first = await loadPublicShyfrContent(env);
  const second = await loadPublicShyfrContent(env);
  assert.equal(first.categories[0].title, 'Навчання');
  assert.equal(first.levels[0].text, items[0].text);
  assert.equal(first.levels[0].categoryId, 'tutorial');
  assert.equal(second, first);
  assert.deepEqual(calls, [
    'https://content.test/shyfr/categories.json',
    'https://content.test/shyfr/tutorial.json'
  ]);
});

test('публічний каталог зберігає у рядку лише text і source', async () => {
  const result = await validateShyfrContent();
  assert.deepEqual(result.errors, []);
  assert.ok(result.levels.length > 0);
  for (const level of result.levels) assert.deepEqual(Object.keys(level.__raw).sort(), ['source', 'text']);
});

test('кожна категорія має власну пару кольорів теми', async () => {
  const result = await validateShyfrContent();
  const colors = result.categories.map(category => category.color.toLowerCase());
  const accents = result.categories.map(category => category.accent.toLowerCase());
  assert.equal(new Set(colors).size, result.categories.length);
  assert.equal(new Set(accents).size, result.categories.length);
  result.categories.forEach(category => assert.notEqual(category.color.toLowerCase(), category.accent.toLowerCase()));
});

test('ID створюється автоматично зі стабільного нормалізованого тексту', () => {
  assert.equal(normalizeShyfrText('  Слава, Україні! '), 'слава україні');
  assert.equal(automaticLevelId('poetry', 'Той самий текст'), automaticLevelId('poetry', 'Той   самий текст!'));
  assert.deepEqual(parseSource('Автор | https://example.com/source'), { label: 'Автор', url: 'https://example.com/source' });
  assert.deepEqual(parseSource('https://open.spotify.com/track/29IxfhWiWURtUiEOWOhO9W'), { label: 'open.spotify.com', url: 'https://open.spotify.com/track/29IxfhWiWURtUiEOWOhO9W' });
});

test('валідатор відхиляє зайві поля у рівні', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shyfr-public-'));
  try {
    await writeFile(path.join(root, 'poetry.json'), JSON.stringify([{ text: 'Достатньо довгий тестовий текст українською мовою', source: 'Тест', difficulty: 1 }]), 'utf8');
    const result = await validateShyfrContent({ root });
    assert.ok(result.errors.some(error => error.includes('лише поля text і source')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('приватний платний каталог готується як Cloudflare KV bulk-файл', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shyfr-private-'));
  const output = path.join(root, 'bulk.json');
  try {
    await writeFile(path.join(root, 'memes.json'), JSON.stringify([{ text: 'Це достатньо довгий приватний тестовий рівень для гри', source: 'Власний тест' }]), 'utf8');
    const built = await buildPrivateKv({ root, output });
    assert.equal(built.levels, 1);
    const bulk = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(bulk[0].key, 'shyfr:content:catalog');
    const levels = JSON.parse(bulk[0].value);
    assert.deepEqual(Object.keys(levels[0]).sort(), ['categoryId', 'free', 'id', 'order', 'source', 'text']);
    assert.equal((await loadShyfrContent(root, { privateMode: true })).levels.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

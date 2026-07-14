import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  automaticLevelId,
  buildPrivateKv,
  loadShyfrContent,
  normalizeShyfrText,
  parseSource,
  validateShyfrContent
} from '../scripts/shyfr-content.mjs';

test('публічний каталог зберігає у рядку лише text і source', async () => {
  const result = await validateShyfrContent();
  assert.deepEqual(result.errors, []);
  assert.ok(result.levels.length > 0);
  for (const level of result.levels) assert.deepEqual(Object.keys(level.__raw).sort(), ['source', 'text']);
});

test('ID створюється автоматично зі стабільного нормалізованого тексту', () => {
  assert.equal(normalizeShyfrText('  Слава, Україні! '), 'слава україні');
  assert.equal(automaticLevelId('poetry', 'Той самий текст'), automaticLevelId('poetry', 'Той   самий текст!'));
  assert.deepEqual(parseSource('Автор | https://example.com/source'), { label: 'Автор', url: 'https://example.com/source' });
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

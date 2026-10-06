import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { COMMUNITY_SPECTRA } from '../content/hvylia/community-spectra.js';
import { PACKS, getPack } from '../content/hvylia/packs.js';
import { SPECTRA } from '../content/hvylia/spectra.js';

const axis = card => [card.left, card.right].map(pole => pole.normalize('NFC').toLocaleLowerCase('uk-UA')).sort().join('|');

test('catalogue offers only the free community deck with a computed count', () => {
  assert.deepEqual(PACKS.map(pack => pack.id), ['standard']);
  assert.equal(PACKS[0].count, SPECTRA.length);
  assert.equal(PACKS[0].priceStars, 0);
  assert.equal(PACKS[0].free, true);
  assert.ok(PACKS[0].title && PACKS[0].description);
  assert.ok(Object.isFrozen(PACKS) && Object.isFrozen(PACKS[0]));
  assert.equal(getPack('standard'), PACKS[0]);
  for (const id of ['anime', 'games', 'unknown']) assert.equal(getPack(id), null);
});

test('playable cards use only the editor list, preserving wording and first-occurrence row IDs', () => {
  const expected = [];
  const seen = new Set();
  for (const card of COMMUNITY_SPECTRA) {
    if (!seen.has(axis(card))) { expected.push(card); seen.add(axis(card)); }
  }
  assert.deepEqual(SPECTRA, expected);
  assert.equal(SPECTRA.length, 678);
  assert.equal(COMMUNITY_SPECTRA.length, 687);
  assert.ok(Object.isFrozen(SPECTRA));
  assert.equal(new Set(SPECTRA.map(card => card.id)).size, SPECTRA.length);
  for (const card of SPECTRA) {
    assert.match(card.id, /^community-\d{2,3}$/u);
    assert.ok(Object.isFrozen(card));
    assert.equal(card.category, 'community');
    for (const pole of [card.left, card.right]) {
      assert.equal(pole, pole.trim(), card.id);
      assert.ok(pole.length >= 3 && pole.length <= 72, card.id);
      assert.match(pole, /[А-Яа-яІіЇїЄєҐґ]/u);
      assert.doesNotMatch(pole, /[<>]/u);
      assert.ok([...pole].every(character => character.codePointAt(0) >= 32), card.id);
    }
    assert.notEqual(card.left.toLocaleLowerCase('uk-UA'), card.right.toLocaleLowerCase('uk-UA'), card.id);
  }
});

test('community localization retains its source license attribution', async () => {
  assert.ok(COMMUNITY_SPECTRA.every(card => card.source === 'sejoslaw-mit'));
  const notice = await readFile(new URL('../content/hvylia/SEJOSLAW-LICENSE.txt', import.meta.url), 'utf8');
  assert.match(notice, /Copyright \(c\) 2025 Krzysztof Dobrzyński/u);
  assert.match(notice, /MIT License/u);
});

test('browser, practice and server module graph have one card source', async () => {
  const seen = new Set();
  async function visit(url) {
    if (seen.has(url.href)) return;
    seen.add(url.href);
    assert.ok(!fileURLToPath(url).endsWith('hvylia-premium-cards.js'));
    const source = await readFile(url, 'utf8');
    for (const match of source.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gu)) {
      if (match[1].startsWith('.')) await visit(new URL(match[1], url));
    }
  }
  await visit(new URL('../hvylia/app.js', import.meta.url));
  await visit(new URL('../api/hvylia-worker.js', import.meta.url));
  assert.ok(seen.has(new URL('../content/hvylia/community-spectra.js', import.meta.url).href));
});

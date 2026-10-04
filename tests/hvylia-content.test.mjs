import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ANIME_SPECTRA, GAMES_SPECTRA, getPremiumSpectra } from '../api/hvylia-premium-cards.js';
import { COMMUNITY_SPECTRA } from '../content/hvylia/community-spectra.js';
import { PACKS, getPack } from '../content/hvylia/packs.js';
import { SPECTRA } from '../content/hvylia/spectra.js';

const decks = { standard: SPECTRA, anime: ANIME_SPECTRA, games: GAMES_SPECTRA };

test('pack catalogue counts and Stars prices match playable content', () => {
  assert.deepEqual(PACKS.map(pack => pack.id), ['standard', 'anime', 'games']);
  for (const pack of PACKS) {
    assert.equal(pack.count, decks[pack.id].length);
    assert.equal(pack.priceStars, pack.free ? 0 : 150);
    assert.ok(pack.title && pack.description);
    assert.ok(Object.isFrozen(pack));
    assert.equal(getPack(pack.id), pack);
  }
  assert.ok(SPECTRA.length >= 200);
  assert.ok(ANIME_SPECTRA.length >= 100);
  assert.ok(GAMES_SPECTRA.length >= 100);
  assert.equal(getPack('unknown'), null);
  assert.equal(getPremiumSpectra('anime'), ANIME_SPECTRA);
  assert.equal(getPremiumSpectra('games'), GAMES_SPECTRA);
  assert.equal(getPremiumSpectra('standard'), null);
  assert.equal(getPremiumSpectra('unknown'), null);
});

test('all packs contain unique stable IDs and distinct readable Ukrainian axes', () => {
  const ids = new Set();
  const axes = new Set();
  for (const [packId, deck] of Object.entries(decks)) {
    assert.ok(Object.isFrozen(deck), packId);
    for (const card of deck) {
      assert.match(card.id, /^[a-z]+(?:-[a-z]+)*-\d{2}$/u);
      assert.ok(!ids.has(card.id), `Duplicate ID: ${card.id}`);
      ids.add(card.id);
      assert.ok(Object.isFrozen(card));
      assert.ok(card.category);
      for (const pole of [card.left, card.right]) {
        assert.equal(pole, pole.trim(), card.id);
        assert.ok(pole.length >= 3 && pole.length <= 72, card.id);
        assert.match(pole, /[А-Яа-яІіЇїЄєҐґ]/u);
        assert.doesNotMatch(pole, /[<>]/u);
        assert.ok([...pole].every(character => character.codePointAt(0) >= 32), card.id);
      }
      const normalized = [card.left, card.right].map(pole => pole.toLocaleLowerCase('uk-UA'));
      assert.notEqual(normalized[0], normalized[1], card.id);
      const axis = normalized.sort().join('|');
      assert.ok(!axes.has(axis), `Duplicate axis: ${card.id}`);
      axes.add(axis);
    }
  }
});

test('community localization retains attribution and existing original stable IDs', async () => {
  assert.equal(COMMUNITY_SPECTRA.length, 40);
  assert.ok(COMMUNITY_SPECTRA.every(card => card.source === 'sejoslaw-mit'));
  assert.ok(COMMUNITY_SPECTRA.every(card => SPECTRA.includes(card)));
  for (const category of ['everyday', 'culture', 'absurd', 'debate', 'relationships']) {
    const original = SPECTRA.filter(card => card.category === category);
    assert.equal(original.length, 32);
    assert.equal(original[0].id, `${category}-01`);
    assert.equal(original.at(-1).id, `${category}-32`);
  }
  const notice = await readFile(new URL('../content/hvylia/SEJOSLAW-LICENSE.txt', import.meta.url), 'utf8');
  assert.match(notice, /Copyright \(c\) 2025 Krzysztof Dobrzyński/u);
  assert.match(notice, /MIT License/u);
});

test('browser and practice module graph cannot import the premium deck', async () => {
  const seen = new Set();
  async function visit(url) {
    if (seen.has(url.href)) return;
    seen.add(url.href);
    assert.ok(!fileURLToPath(url).endsWith('hvylia-premium-cards.js'), `Premium deck in browser graph: ${url.href}`);
    const source = await readFile(url, 'utf8');
    for (const match of source.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gu)) {
      if (match[1].startsWith('.')) await visit(new URL(match[1], url));
    }
  }
  await visit(new URL('../hvylia/app.js', import.meta.url));
  await visit(new URL('../api/hvylia-core.js', import.meta.url));
  assert.ok(seen.has(new URL('../content/hvylia/spectra.js', import.meta.url).href));
});

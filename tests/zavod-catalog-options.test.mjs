import assert from 'node:assert/strict';
import test from 'node:test';
import { CATALOG_OPTIONS, catalogOption } from '../Zavod/catalog-options.js';
import { REFERENCE_CARDS } from '../Zavod/reference-data.js';

test('каталог містить усі довідкові карти й рядки, навіть без практичних записів', () => {
  assert.equal(CATALOG_OPTIONS.length, 70);
  assert.equal(new Set(CATALOG_OPTIONS.map(option => option.id)).size, 70);
  assert.equal(new Set(CATALOG_OPTIONS.map(option => option.cardId)).size, 22);
  const covered = new Set(CATALOG_OPTIONS.flatMap(option => option.sections.map(section => `${option.cardId}:${section}`)));
  assert.equal(covered.size, 122);
  for (const card of REFERENCE_CARDS) {
    for (const row of card.rows) assert(covered.has(`${card.id}:${row.section}`), `${card.label}: ${row.section}`);
  }
  assert(CATALOG_OPTIONS.every(option => /^[a-z0-9-]+--[a-z0-9-]+$/.test(option.id)));
  assert.equal(catalogOption('missing-option'), null);
});

test('H05 і H07 мають окремі перерізи за довідковою картою', () => {
  for (const suffix of ['u', 'r', 'k']) {
    assert.deepEqual(catalogOption(`h07v-${suffix}--h05v-${suffix}`).sections, [.5, .75, 1]);
    assert.deepEqual(catalogOption(`h07v-${suffix}--h07v-${suffix}`).sections, [1.5, 2.5, 4, 6]);
  }
  assert.equal(catalogOption('h07v-u--h07v-u').practicalCableId, 'pv1');
  assert.equal(catalogOption('h07v-u--h05v-u').practicalCableId, null);
  assert.equal(catalogOption('h07v-r--h07v-r').practicalCableId, null);
  assert.equal(catalogOption('h07v-k--h07v-k').practicalCableId, null);
});

test('практичні рецепти не переносяться на непідтверджені марки й специфікації', () => {
  const expected = {
    'pvs-380--pvs': 'pvs-shvvp',
    'pvs-380--shvvp': 'pvs-shvvp',
    'vvg-066--vvg': 'vvg',
    'vvg-p-066--vvgng-p': 'vvgng-p',
    'pv1--pv1': 'pv1',
    'pv3--pv3': 'pv3',
    'h07v-u--h07v-u': 'pv1',
    'ysly-shared--ysly': 'ysly',
    'ysly-shared--h-05vv-f': 'h05vv-f',
    'ysly-shared--h05vv-f': 'h05vv-f',
  };
  for (const option of CATALOG_OPTIONS) assert.equal(option.practicalCableId, expected[option.id] ?? null, option.label);
  for (const option of CATALOG_OPTIONS.filter(item => item.cardId === 'pv5')) {
    assert.equal(option.practicalCableId, null);
    assert.equal(option.mode, 'unknown');
  }
  assert.equal(catalogOption('h05-en--h05vv-f').practicalCableId, null);
  assert.equal(catalogOption('ysly-1000--ysly-jz').practicalCableId, null);
});

test('український підпис зберігає точну марку для зіставлення джерел', () => {
  const acoustic = catalogOption('speaker--speaker');
  assert.equal(acoustic.brand, 'Speaker cable');
  assert.equal(acoustic.label, 'Акустичний кабель');
  assert.equal(catalogOption('ysly-shared--h-05vv-f').brand, '(H)05VV-F');
  assert.equal(catalogOption('ysly-shared--h05vv-f').brand, 'H05VV-F');
});

test('режим ПВ3 не прирівнює непідтверджені негорючі марки до базової', () => {
  assert.equal(catalogOption('pv3--pv3').mode, 'single');
  assert.equal(catalogOption('pv3--pv3ng').mode, 'unknown');
  assert.equal(catalogOption('pv3--pv3ngd').mode, 'unknown');
});

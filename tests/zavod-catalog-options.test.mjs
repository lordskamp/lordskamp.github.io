import assert from 'node:assert/strict';
import test from 'node:test';
import { CATALOG_OPTIONS, catalogOption } from '../Zavod/catalog-options.js';
import { REFERENCE_CARDS, VIRTUAL_CARDS } from '../Zavod/reference-data.js';
import { baseFor, referenceCard } from '../Zavod/catalog-base.js';

test('каталог містить усі довідкові карти й рядки, навіть без практичних записів', () => {
  const printed = CATALOG_OPTIONS.filter(option => option.coreKind !== 'thread');
  assert.equal(printed.length, 70);
  assert.equal(new Set(CATALOG_OPTIONS.map(option => option.id)).size, 71);
  assert.equal(new Set(printed.map(option => option.cardId)).size, 22);
  const covered = new Set(printed.flatMap(option => option.sections.map(section => `${option.cardId}:${section}`)));
  assert.equal(covered.size, 122);
  for (const card of REFERENCE_CARDS) {
    for (const row of card.rows) assert(covered.has(`${card.id}:${row.section}`), `${card.label}: ${row.section}`);
  }
  assert(printed.every(option => /^[a-z0-9-]+--[a-z0-9-]+$/.test(option.id)));
  assert.equal(catalogOption('missing-option'), null);
});

test('Джгути are last and retain a separate thread recipe without invented source or dimensions', () => {
  const thread = catalogOption('thread-bundle');
  assert.equal(CATALOG_OPTIONS.at(-1), thread);
  assert.equal(thread.label, 'Джгути');
  assert.equal(thread.coreKind, 'thread');
  assert.equal(thread.mode, 'unknown');
  assert.equal(thread.practicalCableId, null);
  assert.deepEqual(referenceCard(thread), VIRTUAL_CARDS[0]);
  assert.equal(referenceCard(thread).source, null);
  assert.equal(REFERENCE_CARDS.flatMap(card => card.rows).length, 122);
  const base = baseFor(thread.id, thread.sections[0]);
  assert(base, 'the shared API catalog can validate a thread measurement');
  for (const key of ['dorn', 'matrix', 'sikoraWire', 'sikoraOuter', 'extruder1', 'extruder2', 'maxSpeed']) assert.equal(base[key], null);
  assert.equal(baseFor(thread.id, 2.5), null);
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
    assert.equal(option.mode, 'single');
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

test('режим кольорів спільний для ПВ3, але практичні записи не переносяться між марками', () => {
  assert.equal(catalogOption('pv3--pv3').mode, 'single');
  assert.equal(catalogOption('pv3--pv3ng').mode, 'single');
  assert.equal(catalogOption('pv3--pv3ngd').mode, 'single');
  assert.equal(catalogOption('pv3--pv3ng').practicalCableId, null);
  assert.equal(catalogOption('pv3--pv3ngd').practicalCableId, null);
});

test('H and ПВ families allow one extruder while preserving the original reference mode', () => {
  for (const option of CATALOG_OPTIONS.filter(item => /^(?:H|\(H\)|ПВ)/iu.test(item.brand))) {
    assert.equal(option.mode, 'single', option.brand);
    assert.match(option.modeHint, /Синій і жовто-зелений/);
  }
  assert.equal(catalogOption('h05-en--h05vv-f').referenceMode, 'dual');
  assert.equal(catalogOption('pv1--pv1').referenceMode, 'single');
  assert.equal(catalogOption('ysly-1000--ysly-jz').mode, 'dual');
});

test('назви не містять напругу, але початкові специфікації та ідентифікатори збережені', () => {
  assert(CATALOG_OPTIONS.every(option => !/\d\s*(?:кВ|В|кВт|Вт)\b/u.test(option.label)));
  assert.equal(catalogOption('pvs-380--pvs').label,'ПВС');
  assert.equal(catalogOption('pvs-380--pvs').specification,'380 В');
  assert.equal(catalogOption('vvg-p-066--vvgng-p').label,'ВВГнг-П');
  assert.equal(catalogOption('vvg3--vvgz').label,'ВВГз · клас 3');
  assert.equal(catalogOption('ysly-1000--ysly-jz').specification,'600/1000 В');
});

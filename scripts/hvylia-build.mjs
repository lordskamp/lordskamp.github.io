import { cp, mkdir, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SPECTRA } from '../content/hvylia/spectra.js';

if (SPECTRA.length < 150 || new Set(SPECTRA.map(item => item.id)).size !== SPECTRA.length) {
  throw new Error('Потрібні щонайменше 150 спектрів з унікальними ідентифікаторами.');
}
for (const item of SPECTRA) {
  if (!item.left?.trim() || !item.right?.trim() || !item.category) throw new Error(`Некоректний спектр: ${item.id}`);
}
const output = resolve('outputs/hvylia-site');
await mkdir(output, { recursive: true });
await cp(resolve('hvylia'), resolve(output, 'hvylia'), { recursive: true });
await cp(resolve('fav'), resolve(output, 'fav'), { recursive: true });
// Publish only the game and favicon assets; repository files and credentials never enter this directory.
const html = await readFile(resolve(output, 'hvylia/index.html'), 'utf8');
for (const match of html.matchAll(/(?:src|href)="\.\/([^"?#]+)(?:[?#][^"]*)?"/gu)) {
  await readFile(resolve(output, 'hvylia', match[1]));
}
const assets = await readdir(resolve(output, 'hvylia'));
console.log(`Довжина хвилі: ${SPECTRA.length} спектрів, ${assets.length} файлів сторінки. Збірка готова.`);

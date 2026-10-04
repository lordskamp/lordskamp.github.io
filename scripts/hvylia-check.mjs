import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const files = ['api/hvylia-core.js', 'api/hvylia-worker.js', 'content/hvylia/spectra.js'];
for (const name of await readdir('hvylia')) if (name.endsWith('.js')) files.push(`hvylia/${name}`);
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Перевірено синтаксис ${files.length} JavaScript-модулів гри.`);

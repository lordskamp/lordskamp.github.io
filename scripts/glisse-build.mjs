import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Use the bundler already supplied by the pinned Wrangler dependency.
const require = createRequire(import.meta.url);
const { buildSync } = createRequire(require.resolve('wrangler/package.json'))('esbuild');
buildSync({
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  entryPoints: ['assets/glisse/site-glass.ts', 'assets/glisse/glass-worker.ts'],
  outdir: 'assets/glisse',
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
  legalComments: 'none',
  banner: { js: '/* Glisse 0.5.0, MIT (c) 2026 Kelvin Zhang. Adapted for this site; see LICENSE. */' },
});

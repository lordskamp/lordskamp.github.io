import js from '@eslint/js';

const sharedGlobals = {
  console: 'readonly',
  crypto: 'readonly',
  fetch: 'readonly',
  Headers: 'readonly',
  Request: 'readonly',
  Response: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  AbortSignal: 'readonly',
  Blob: 'readonly',
  structuredClone: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly'
};

export default [
  {
    ignores: ['node_modules/**', 'portfolio/**', 'outputs/**', 'api/shyfr-content.generated.js']
  },
  js.configs.recommended,
  {
    files: ['home.js', 'site-ui.js', 'portfolio-app.js', 'unwordle.js', 'telegram-mini-app.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...sharedGlobals, window: 'readonly', document: 'readonly', navigator: 'readonly',
        localStorage: 'readonly', sessionStorage: 'readonly', history: 'readonly', location: 'readonly',
        Element: 'readonly', Image: 'readonly', CSS: 'readonly', caches: 'readonly', performance: 'readonly',
        innerWidth: 'readonly', innerHeight: 'readonly', getComputedStyle: 'readonly',
        requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly', CustomEvent: 'readonly',
        IntersectionObserver: 'readonly', ResizeObserver: 'readonly', MutationObserver: 'readonly',
        lottie: 'readonly', fetch: 'readonly', btoa: 'readonly', atob: 'readonly'
      }
    },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }] }
  },
  {
    files: ['Zavod/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...sharedGlobals, window: 'readonly', document: 'readonly', navigator: 'readonly', localStorage: 'readonly', FormData: 'readonly' }
    }
  },
  {
    files: ['api/*.js', 'scripts/*.mjs', 'tests/**/*.mjs', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...sharedGlobals,
        process: 'readonly',
        Buffer: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }]
    }
  },
  {
    files: ['api/hvylia-worker.js'],
    languageOptions: { globals: { WebSocketPair: 'readonly' } }
  },
  {
    files: ['hvylia/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...sharedGlobals,
        window: 'readonly', document: 'readonly', navigator: 'readonly',
        localStorage: 'readonly', sessionStorage: 'readonly', history: 'readonly',
        location: 'readonly', WebSocket: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly',
        requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
        performance: 'readonly', matchMedia: 'readonly',
        AudioContext: 'readonly', FormData: 'readonly', CustomEvent: 'readonly'
      }
    }
  },
  {
    files: ['shyfr/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        ...sharedGlobals,
        window: 'readonly',
        history: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        CustomEvent: 'readonly',
        HTMLElement: 'readonly'
      }
    }
  }
];

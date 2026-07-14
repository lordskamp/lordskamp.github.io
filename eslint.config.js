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
    files: ['api/*.js', 'scripts/*.mjs', 'tests/*.mjs', 'eslint.config.js'],
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

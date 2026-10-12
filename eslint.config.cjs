// @ts-check
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const reactHooks = require('eslint-plugin-react-hooks');

module.exports = tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': ['warn', {
        allowExpressions: true,
        allowTypedFunctionExpressions: true,
      }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    files: ['client/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    // The React Compiler checks in v7 flag existing patterns; surface them without failing lint.
    rules: {
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    files: ['shared/src/**/*.ts', 'server/**/*.ts', 'client/src/**/*.{ts,tsx}', 'scripts/**/*.ts', 'client/vite.config.ts'],
    languageOptions: {
      parserOptions: {
        project: [
          './shared/tsconfig.json',
          './server/tsconfig.test.json',
          './client/tsconfig.app.json',
          './client/tsconfig.node.json',
        ],
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': ['error', {
        // Declarative-mode React Router navigation never returns a pending promise.
        allowForKnownSafeCalls: [{ from: 'package', name: 'NavigateFunction', package: 'react-router' }],
      }],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { Buffer: 'readonly', console: 'readonly', process: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly' } },
  },
  {
    files: ['server/tests/**/*.ts', 'server/benchmarks/**/*.ts'],
    rules: { '@typescript-eslint/explicit-function-return-type': 'off' },
  },
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.js', '**/*.cjs'],
  },
);

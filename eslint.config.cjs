// @ts-check
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const reactHooks = require('eslint-plugin-react-hooks');

// Runtime dispatch belongs to game modules. Comparing variables (including registry keys) is fine;
// `all` is the history filter sentinel rather than a game type.
/** @param {string} side */
const gameTypeOperands = (side) => [
  `[${side}.type="Identifier"][${side}.name="gameType"]`,
  `[${side}.type="MemberExpression"][${side}.computed=false][${side}.property.name="gameType"]`,
  `[${side}.type="MemberExpression"][${side}.computed=true][${side}.property.value="gameType"]`,
];
const literalGameTypeComparisons = ['left', 'right'].flatMap((side) => {
  const literal = side === 'left' ? 'right' : 'left';
  const operands = [
    ...gameTypeOperands(side),
    // Optional chaining and TypeScript assertions must not hide a discriminator comparison.
    ...gameTypeOperands(`${side}.expression`).map((operand) =>
      `[${side}.type=/^(ChainExpression|TSAsExpression|TSTypeAssertion|TSNonNullExpression|TSSatisfiesExpression)$/]${operand}`),
  ];
  const strings = [
    `[${literal}.type="Literal"][${literal}.raw=/^['"]/][${literal}.value!="all"]`,
    `[${literal}.type="TemplateLiteral"][${literal}.expressions.length=0][${literal}.quasis.0.value.cooked!="all"]`,
  ];
  return operands.flatMap((operand) => strings.map((string) => ({
    selector: `BinaryExpression[operator=/^(===|!==|==|!=)$/]${operand}${string}`,
    message: 'Move literal gameType comparisons into a per-game module or registry.',
  })));
});

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
    files: ['shared/src/**/*.ts', 'server/src/**/*.ts', 'client/src/**/*.{ts,tsx}'],
    ignores: [
      'shared/src/games/**', 'client/src/games/**', 'server/src/managers/games/**',
      'server/src/database/games/**',
      // Existing pure per-game rules, facts, and strategies are game modules too.
      'shared/src/rules/{bridge,bigtwo,redpoints,ninetynine,sevens,chinesepoker,liarsdeck,blackjack,holdem,napoleon}.ts',
      'shared/src/stats/{bridge,bigtwo,redpoints,ninetynine,sevens,chinesepoker,liarsdeck,blackjack,holdem,napoleon}.ts',
      'server/src/bots/*-bot.ts',
      '**/*registry.ts',
    ],
    rules: { 'no-restricted-syntax': ['error', ...literalGameTypeComparisons] },
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

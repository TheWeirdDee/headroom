import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

const TRUTH_PATH = {
  selector: 'Literal[value=/_truth/]',
  message: 'Ground truth (_truth/) may only be read by scripts/eval.ts and tests.',
};
const TRUTH_TEMPLATE = {
  selector: 'TemplateElement[value.raw=/_truth/]',
  message: TRUTH_PATH.message,
};
const MOZAIK_MESSAGE =
  'Rules, parsing, exports and the claims package stay independent of the agent runtime.';
const MOZAIK_DYNAMIC = [
  { selector: 'ImportExpression[source.value=/^@(mozaik-ai|jigjoy)\\//]', message: MOZAIK_MESSAGE },
  {
    selector: "CallExpression[callee.name='require'][arguments.0.value=/^@(mozaik-ai|jigjoy)\\//]",
    message: MOZAIK_MESSAGE,
  },
];
const BASE = [TRUTH_PATH, TRUTH_TEMPLATE];
/** Where importing the agent runtime is a mistake. */
const WITHOUT_MOZAIK = [
  'src/domain/**',
  'src/inputs/**',
  'src/exporters/**',
  'src/integrations/**',
  'packages/claims/src/**',
  'web/src/**',
];
const NO_FLOAT_PARSE = [
  {
    selector: "CallExpression[callee.name='Number']",
    message: 'No Number() in domain code: use money.ts or int.ts.',
  },
  {
    selector: "CallExpression[callee.name='parseFloat']",
    message: 'No parseFloat() in domain code: use money.ts.',
  },
  {
    selector: "CallExpression[callee.name='parseInt']",
    message: 'No parseInt() in domain code: use int.ts.',
  },
  {
    selector:
      'CallExpression[callee.object.name=/^(Number|globalThis)$/][callee.property.name=/^(parseFloat|parseInt|Number)$/]',
    message: 'No Number parsing in domain code: use money.ts or int.ts.',
  },
  {
    selector: "UnaryExpression[operator='+']",
    message: 'No unary + in domain code: use money.ts or int.ts.',
  },
];
const SYNC_ONLY = [
  {
    selector: 'AwaitExpression',
    message: 'Claim store methods are synchronous so board mutations are atomic.',
  },
  {
    selector:
      'FunctionDeclaration[async=true], FunctionExpression[async=true], ArrowFunctionExpression[async=true]',
    message: 'No async functions in packages/claims/src.',
  },
  {
    selector: "MemberExpression[property.name='then']",
    message: 'No promise chains in packages/claims/src.',
  },
];

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'web/dist/**',
      'web/node_modules/**',
      'web/vite.config.ts',
      'coverage/**',
      'runs/**',
      'data/**',
      'test/fixtures/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'error',
      'no-debugger': 'error',
      'no-restricted-syntax': ['error', ...BASE],
    },
  },
  {
    // The browser app: browser globals; it computes nothing, so the domain rules do not apply.
    files: ['web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: WITHOUT_MOZAIK,
    rules: {
      'no-restricted-syntax': ['error', ...BASE, ...MOZAIK_DYNAMIC],
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@mozaik-ai/*', '@jigjoy/*'], message: MOZAIK_MESSAGE }] },
      ],
    },
  },
  {
    files: ['src/domain/**'],
    rules: { 'no-restricted-syntax': ['error', ...BASE, ...MOZAIK_DYNAMIC, ...NO_FLOAT_PARSE] },
  },
  {
    files: ['packages/claims/src/**'],
    rules: { 'no-restricted-syntax': ['error', ...BASE, ...MOZAIK_DYNAMIC, ...SYNC_ONLY] },
  },
  {
    // eval.ts and tests read ground truth; the generator files only write it.
    files: [
      'scripts/eval.ts',
      'scripts/generate-profiles.ts',
      'scripts/lib/write-profile.ts',
      'test/**',
      'eslint.config.js',
    ],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
);

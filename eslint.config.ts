import js from '@eslint/js';
import type { Linter } from 'eslint';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** House style for every file. */
const houseStyle: Linter.RulesRecord = {
  // Names say what a value is. Property names are exempt, e.g. point.x.
  'id-length': ['error', { min: 2, properties: 'never' }],
  'no-restricted-syntax': [
    'error',
    {
      selector: 'BreakStatement',
      message: 'Use sequential control flow (return, conditions, find) instead of break.',
    },
    {
      selector: 'ContinueStatement',
      message: 'Use sequential control flow (filter, conditions) instead of continue.',
    },
    {
      selector:
        'Literal[raw=/[^\\u0000-\\u007F]/], TemplateElement[value.raw=/[^\\u0000-\\u007F]/]',
      message: 'Keep source files ASCII. Use an escape sequence such as \\u00d7.',
    },
  ],
};

export default defineConfig(
  { ignores: ['dist/', 'out/'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser, chrome: 'readonly' },
    },
    rules: {
      ...houseStyle,
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['scripts/**', 'test/**', '*.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
);

// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { coreKanbanBoundaryPlugin } from '../../eslint-rules/core-kanban-boundary.mjs';

const MAX_FILE_LINES = 500;
const MAX_FUNCTION_LINES = 120;
const MAX_FUNCTION_COMPLEXITY = 14;

export default tseslint.config(
  {
    ignores: [
      'eslint.config.mjs',
      '*.config.ts',
      'scripts/**',
      'dist/**',
      'coverage/**',
      'logs/**',
      'storage/**',
      'node_modules/**',
      '.pi-lens/**',
      '.beads/**',
      'tmp/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  eslintPluginPrettierRecommended,
  {
    files: ['src/**/*.ts'],
    plugins: {
      'nexus-boundaries': coreKanbanBoundaryPlugin,
    },
    rules: {
      'nexus-boundaries/no-core-kanban-residue': 'error',
    },
  },
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
        ...globals.vitest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      'max-lines': [
        'error',
        {
          max: MAX_FILE_LINES,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
      'max-lines-per-function': [
        'error',
        {
          max: MAX_FUNCTION_LINES,
          skipBlankLines: true,
          skipComments: true,
          IIFEs: true,
        },
      ],
      complexity: ['error', { max: MAX_FUNCTION_COMPLEXITY }],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportNamedDeclaration > TSInterfaceDeclaration',
          message: 'Move exported interfaces into a dedicated *.types.ts file.',
        },
        {
          selector: 'ExportNamedDeclaration > TSTypeAliasDeclaration',
          message:
            'Move exported type aliases into a dedicated *.types.ts file.',
        },
        {
          selector: 'ExportNamedDeclaration > TSEnumDeclaration',
          message: 'Move exported enums into a dedicated *.types.ts file.',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/unbound-method': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-extraneous-class': [
        'error',
        { allowWithDecorator: true },
      ],
      '@typescript-eslint/no-deprecated': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
  {
    files: ['**/*.types.ts', '**/types.ts', '**/interfaces/**/*.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    files: [
      '**/*.spec.ts',
      '**/*.e2e-spec.ts',
      '**/__tests__/**/*.ts',
      'test/**/*.ts',
      'src/**/__tests__/**/*.ts',
    ],
    rules: {
      'max-lines-per-function': 'off',
      complexity: 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-misused-spread': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/await-thenable': 'off',
      '@typescript-eslint/no-unnecessary-type-conversion': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-restricted-syntax': 'off',
      'max-lines': 'off',
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@nexus/kanban-contracts',
              message:
                'API core collaboration paths must stay independent of @nexus/kanban-contracts.',
            },
          ],
          patterns: ['@nexus/kanban-contracts/*'],
        },
      ],
    },
  },
);

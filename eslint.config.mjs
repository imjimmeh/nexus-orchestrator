// @ts-check
import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { coreKanbanBoundaryPlugin } from "./eslint-rules/core-kanban-boundary.mjs";

const MAX_FILE_LINES = 500;
const MAX_FUNCTION_LINES = 120;
const MAX_FUNCTION_COMPLEXITY = 14;

export default tseslint.config(
  {
    ignores: [
      "eslint.config.mjs",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/*.d.ts",
      "**/*.config.ts",
      "**/node_modules/**",
      "**/.worktrees/**",
      "**/data/**",
      "**/logs/**",
      "**/tmp/**",
      "**/storage/**",
      "**/scratch/**",
      "scripts/**",
      "patches/**",
      "**/.agents/**",
      "**/.beads/**",
      "**/.claude/**",
      "**/.crew/**",
      "**/.debug/**",
      "**/.pi/**",
      "**/.pi-lens/**",
      "**/.rpiv/**",
      "**/.ruff_cache/**",
      "**/*-*-*-*-*/**",
    ],
  },
  {
    files: ["packages/**/*.{ts,tsx,mts,cts}"],
    ignores: ["**/*.config.ts"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    files: ["packages/core/src/**/*.ts", "apps/api/src/**/*.ts"],
    plugins: {
      "nexus-boundaries": coreKanbanBoundaryPlugin,
    },
    rules: {
      "nexus-boundaries/no-core-kanban-residue": "error",
    },
  },
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "max-lines": [
        "error",
        {
          max: MAX_FILE_LINES,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
      "max-lines-per-function": [
        "error",
        {
          max: MAX_FUNCTION_LINES,
          skipBlankLines: true,
          skipComments: true,
          IIFEs: true,
        },
      ],
      complexity: ["error", { max: MAX_FUNCTION_COMPLEXITY }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ExportNamedDeclaration > TSInterfaceDeclaration",
          message: "Move exported interfaces into a dedicated *.types.ts file.",
        },
        {
          selector: "ExportNamedDeclaration > TSTypeAliasDeclaration",
          message:
            "Move exported type aliases into a dedicated *.types.ts file.",
        },
        {
          selector: "ExportNamedDeclaration > TSEnumDeclaration",
          message: "Move exported enums into a dedicated *.types.ts file.",
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: [
      "packages/**/*.types.ts",
      "**/*.types.ts",
      "**/types.ts",
      "**/interfaces/**/*.ts",
    ],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    files: ["**/schemas/**/*.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    files: [
      "packages/**/*.{spec,test}.{ts,tsx}",
      "packages/**/vitest.config.ts",
      "**/*.{spec,test}.{ts,tsx}",
      "**/vitest.config.ts",
    ],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.vitest,
      },
    },
    rules: {
      "max-lines": "off",
      "max-lines-per-function": "off",
      complexity: "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/require-await": "off",
      "no-restricted-syntax": "off",
    },
  },
  {
    files: [
      "src/browser/browser-handlers.ts",
      "src/session/session-factory.spec.ts",
      "src/tools/nexus-bridge-tools.spec.ts",
      "packages/pi-runner/src/browser/browser-handlers.ts",
      "packages/pi-runner/src/nexus-bridge-tools.ts",
      "packages/pi-runner/src/session/session-factory.spec.ts",
      "packages/pi-runner/src/tools/nexus-bridge-tools.spec.ts",
      "packages/e2e-tests/src/frontend-quality-analysis.ts",
      "packages/e2e-tests/src/kanban-lifecycle/kanban-lifecycle-runner.ts",
    ],
    rules: {
      "max-lines": "off",
      "max-lines-per-function": "off",
      complexity: "off",
    },
  },
  {
    files: [
      "packages/e2e-tests/src/kanban-lifecycle/kanban-lifecycle-runner.ts",
    ],
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
);

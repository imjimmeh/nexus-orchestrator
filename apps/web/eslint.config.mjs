// @ts-check
import eslint from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import globals from "globals";
import tseslint from "typescript-eslint";

const MAX_FILE_LINES = 500;
const MAX_NON_REACT_FUNCTION_LINES = 120;
const MAX_REACT_FUNCTION_LINES = 200;
const MAX_FUNCTION_COMPLEXITY = 14;

export default tseslint.config(
  {
    ignores: [
      "eslint.config.mjs",
      "**/eslint.config.mjs",
      "*.config.js",
      "**/*.config.js",
      "*.config.mjs",
      "**/*.config.mjs",
      "*.config.ts",
      "**/*.config.ts",
      "e2e/**",
      "**/e2e/**",
      "dist/**",
      "**/dist/**",
      "coverage/**",
      "**/coverage/**",
      "playwright-report/**",
      "**/playwright-report/**",
      "test-results/**",
      "**/test-results/**",
      "node_modules/**",
      "**/node_modules/**",
      ".next/**",
      "**/.next/**",
      ".pi-lens/**",
      "**/.pi-lens/**",
      ".beads/**",
      "**/.beads/**",
      "tmp/**",
      "**/tmp/**",
    ],
  },
  eslint.configs.recommended,
  {
    plugins: {
      "@next/next": nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },
  ...tseslint.configs.strictTypeChecked,
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      globals: {
        ...globals.browser,
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
      complexity: ["error", { max: MAX_FUNCTION_COMPLEXITY }],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/prefer-promise-reject-errors": "off",
      "@typescript-eslint/no-invalid-void-type": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-unnecessary-type-arguments": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "off",
      "@typescript-eslint/return-await": "off",
      "@typescript-eslint/no-unnecessary-template-expression": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/no-dynamic-delete": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "no-regex-spaces": "off",
      "no-alert": "error",
      eqeqeq: ["error", "always"],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "@next/next/no-html-link-for-pages": "off",
      "@next/next/no-img-element": "off",
    },
  },
  {
    files: ["**/*.{ts,mts,cts}"],
    rules: {
      "max-lines-per-function": [
        "error",
        {
          max: MAX_NON_REACT_FUNCTION_LINES,
          skipBlankLines: true,
          skipComments: true,
          IIFEs: true,
        },
      ],
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
    },
  },
  {
    files: ["**/*.types.ts", "**/types.ts", "**/interfaces/**/*.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    files: ["**/*.tsx"],
    rules: {
      complexity: ["warn", { max: MAX_FUNCTION_COMPLEXITY }],
      "max-lines-per-function": [
        "warn",
        {
          max: MAX_REACT_FUNCTION_LINES,
          skipBlankLines: true,
          skipComments: true,
          IIFEs: true,
        },
      ],
    },
  },
  {
    files: ["**/*.{test,spec}.{ts,tsx}", "e2e/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.vitest,
        ...globals.node,
      },
    },
    rules: {
      "max-lines-per-function": "off",
      complexity: "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-restricted-syntax": "off",
      "max-lines": "off",
    },
  },
  {
    files: [
      "**/src/pages/Settings.tsx",
      "**/src/pages/active-session/active-session.chat-builder.ts",
      "**/src/pages/memory/MemoryExplorer.tsx",
      "**/src/lib/api/client.projects.types.ts",
      "**/src/pages/project-workspace/SettingsTab.tsx",
      // `lucide-react.types.ts` enumerates ~1.5k icon exports as a fallback
      // shim when the package's bundled `dist/lucide-react.d.ts` is absent
      // from the CI gate's `node_modules`. The declarations are mechanically
      // generated and intentionally exhaustive, so a one-off file length
      // exemption is the only practical option.
      "**/src/types/lucide-react.types.ts",
    ],
    rules: {
      "max-lines": "off",
    },
  },
);

// @ts-check
import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const MAX_FILE_LINES = 500;
const MAX_FUNCTION_LINES = 120;
const MAX_FUNCTION_COMPLEXITY = 14;

export default tseslint.config(
  {
    ignores: [
      "eslint.config.mjs",
      "*.config.ts",
      "dist/**",
      "coverage/**",
      "logs/**",
      "node_modules/**",
      ".pi-lens/**",
      ".beads/**",
      "tmp/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.vitest,
      },
      sourceType: "commonjs",
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
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
      "@typescript-eslint/no-extraneous-class": [
        "error",
        { allowWithDecorator: true },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: ["**/*.types.ts", "**/types.ts", "**/interfaces/**/*.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    files: [
      "**/*.{spec,test}.ts",
      "**/*.e2e-spec.ts",
      "**/__tests__/**/*.ts",
      "test/**/*.ts",
    ],
    rules: {
      "max-lines-per-function": "off",
      complexity: "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-restricted-syntax": "off",
      "max-lines": "off",
    },
  },
);

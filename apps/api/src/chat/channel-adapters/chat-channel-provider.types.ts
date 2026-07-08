/**
 * Type-safe discriminant for chat channel providers known to the chat module.
 *
 * The curated set (`'telegram'`, `'email'`) is what TypeScript surfaces in IDE
 * autocomplete and in `switch` exhaustiveness checks. The trailing
 * `(string & {})` is the standard TypeScript "open extension" trick: it
 * assigns to / from any `string` literal, so adapters added later (e.g.
 * `'slack'`, `'discord'`) compile at every existing call site without forcing
 * a churn of `as` casts across the codebase.
 *
 * Keeping the discriminant in a single `.types.ts` file is required by the
 * `no-restricted-syntax` rule in `apps/api/eslint.config.mjs` — exported types
 * must live in `*.types.ts` files.
 */
export type ChatChannelProvider = 'telegram' | 'email' | (string & {});

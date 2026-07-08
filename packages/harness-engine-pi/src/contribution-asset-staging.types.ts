/**
 * Type exports for contribution-asset-staging.ts.
 * Extracted into a dedicated *.types.ts file per the project's lint rules.
 */

/**
 * Key identifying a staged hook script: `"<event>:<index>"` (zero-based index
 * of the hook in the original hook array). Unique within a session's hook list.
 */
export type StagedHookKey = string;

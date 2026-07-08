/**
 * TypeScript type for the `skill_scope_confirmation_mode` system setting
 * (EPIC-212 Phase 4, Task 7). Kept in a companion `.types.ts` file so the
 * API lint rule (`no-restricted-syntax` for exported type aliases) is satisfied
 * without weakening the constants/types file split.
 */

/** Allowed values for the `skill_scope_confirmation_mode` system setting. */
export type SkillScopeConfirmationMode = 'manual' | 'staged' | 'auto';

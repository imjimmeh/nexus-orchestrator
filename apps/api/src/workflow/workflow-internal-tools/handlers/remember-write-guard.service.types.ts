/**
 * Result discriminant returned by RememberWriteGuardService.
 * Exported to *.types.ts to comply with the no-restricted-syntax
 * "exported type aliases must live in *.types.ts" lint rule.
 */
export type WriteGuardResult =
  | { action: 'proceed' }
  | { action: 'budget_exhausted' }
  | { action: 'reinforced'; candidateId: string };

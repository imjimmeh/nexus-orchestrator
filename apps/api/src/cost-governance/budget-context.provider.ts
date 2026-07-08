/**
 * Re-export shim. The canonical `BudgetContextProvider` implementation
 * lives in `apps/api/src/memory/built-in-context-providers/budget-context.provider.ts`
 * so it can be wired into `BuiltInMemoryContextProvidersModule` and registered
 * automatically at `MemoryModule` bootstrap.
 *
 * The class is re-exported here to preserve the previous import path
 * (`'../../cost-governance/budget-context.provider'`) and class identity
 * for the existing `budget-context.provider.spec.ts` and any external
 * callers. Do not add new code in this file.
 */
export { BudgetContextProvider } from '../memory/built-in-context-providers/budget-context.provider';

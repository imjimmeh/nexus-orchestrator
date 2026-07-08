import { Module, forwardRef } from '@nestjs/common';
import { CostGovernanceModule } from '../../cost-governance/cost-governance.module';
import { DatabaseModule } from '../../database/database.module';
import { MemoryModule } from '../memory.module';
import { SessionModule } from '../../session/session.module';
import { BudgetContextProvider } from './budget-context.provider';
import { RecentTaskSummaryProvider } from './recent-task-summary.provider';
import { ProjectStateDigestProvider } from './project-state-digest.provider';
import { LastFailurePostmortemProvider } from './last-failure-postmortem.provider';
import { UserPreferenceEchoProvider } from './user-preference-echo.provider';
import { BuiltInContextProviderRegistrar } from './built-in-context-provider.registrar';

/**
 * Auto-registers the five canonical `IChatContextProvider` implementations
 * on `ChatSessionContextService` at application bootstrap. Imported by
 * `MemoryModule` so the registration is automatic — no runtime call is
 * required.
 *
 * Provider load order in this `providers` array is the contractually
 * pinned load order asserted by the spec at
 * `built-in-memory-context-providers.module.spec.ts`. Re-order requires
 * updating the constructor injection list and the iteration order in
 * `BuiltInContextProviderRegistrar.providersInLoadOrder` in lockstep.
 *
 * Module-graph wiring uses `forwardRef` on both edges of a genuine
 * cycle:
 *
 * - `SessionModule` (via forwardRef) provides `ChatSessionContextService`
 *   to the providers registered here.
 * - `MemoryModule` (via forwardRef) provides `MemoryListingService` and
 *   `MemoryManagerService` to the stub providers, once those providers
 *   are rewired in milestones M3–M6 (see
 *   `docs/architecture/decisions/ADR-built-in-context-provider-stub-wiring.md`).
 *
 * The bidirectional `forwardRef` between `BuiltInMemoryContextProvidersModule`
 * and `MemoryModule` is the precedent described in
 * `ADR-0001 — API Module Dependency Inversion & forwardRef Policy` for
 * genuine, tightly-coupled cycles. The `SessionModule` <-> `TelemetryModule`
 * `forwardRef` precedent (now removed in favour of lazy `ModuleRef`
 * resolution per ADR-0001) applied the same `forwardRef` pattern as its
 * first-step mitigation; we are at that same first step here.
 *
 * `CostGovernanceModule` IS imported because `BudgetContextProvider`
 * depends on `BudgetPolicyService` and `BudgetUsageEventRepository`,
 * which are not exported by any global module.
 */
@Module({
  imports: [
    CostGovernanceModule,
    DatabaseModule,
    forwardRef(() => MemoryModule),
    forwardRef(() => SessionModule),
  ],
  providers: [
    BudgetContextProvider,
    RecentTaskSummaryProvider,
    ProjectStateDigestProvider,
    LastFailurePostmortemProvider,
    UserPreferenceEchoProvider,
    BuiltInContextProviderRegistrar,
  ],
  exports: [
    BudgetContextProvider,
    RecentTaskSummaryProvider,
    ProjectStateDigestProvider,
    LastFailurePostmortemProvider,
    UserPreferenceEchoProvider,
    BuiltInContextProviderRegistrar,
  ],
})
export class BuiltInMemoryContextProvidersModule {
  /** Auto-registration module for built-in chat context providers. */
  protected readonly _moduleName = 'BuiltInMemoryContextProvidersModule';
}

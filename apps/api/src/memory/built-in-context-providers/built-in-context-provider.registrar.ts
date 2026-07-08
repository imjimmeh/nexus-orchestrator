import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ChatSessionContextService } from '../../session/chat-session-context.service';
import type { IChatContextProvider } from '../../session/chat-context-providers/chat-context.provider.interface';
import { BudgetContextProvider } from './budget-context.provider';
import { RecentTaskSummaryProvider } from './recent-task-summary.provider';
import { ProjectStateDigestProvider } from './project-state-digest.provider';
import { LastFailurePostmortemProvider } from './last-failure-postmortem.provider';
import { UserPreferenceEchoProvider } from './user-preference-echo.provider';

/**
 * Registers the five canonical built-in `IChatContextProvider`
 * implementations on `ChatSessionContextService` at application bootstrap.
 *
 * Why `OnApplicationBootstrap` and not `OnModuleInit`:
 *   - `MemoryModule` (which imports this module) and `SessionModule` (which
 *     owns `ChatSessionContextService`) are wired across module boundaries.
 *     The order of `onModuleInit` between modules is not strictly guaranteed
 *     by Nest, so registering providers in `onModuleInit` could fire before
 *     the registry is fully ready. `OnApplicationBootstrap` runs after every
 *     module's `onModuleInit` has finished, which is the safe phase for
 *     cross-module wiring.
 *
 * Determinism:
 *   - The constructor injection list and the registration loop iterate
 *     the providers in a fixed, documented order. The contract test in
 *     `built-in-memory-context-providers.module.spec.ts` pins that order.
 */
@Injectable()
export class BuiltInContextProviderRegistrar implements OnApplicationBootstrap {
  private readonly logger = new Logger(BuiltInContextProviderRegistrar.name);

  constructor(
    private readonly chatSessionContextService: ChatSessionContextService,
    private readonly budgetProvider: BudgetContextProvider,
    private readonly recentTaskSummaryProvider: RecentTaskSummaryProvider,
    private readonly projectStateDigestProvider: ProjectStateDigestProvider,
    private readonly lastFailurePostmortemProvider: LastFailurePostmortemProvider,
    private readonly userPreferenceEchoProvider: UserPreferenceEchoProvider,
  ) {}

  /**
   * The list MUST stay in sync with the order they are injected above and
   * the order asserted in the contract test. Re-ordering requires updating
   * both the constructor and this list, and the contract test will fail
   * loudly if they diverge.
   */
  private get providersInLoadOrder(): IChatContextProvider[] {
    return [
      this.budgetProvider,
      this.recentTaskSummaryProvider,
      this.projectStateDigestProvider,
      this.lastFailurePostmortemProvider,
      this.userPreferenceEchoProvider,
    ];
  }

  onApplicationBootstrap(): void {
    for (const provider of this.providersInLoadOrder) {
      this.chatSessionContextService.registerProvider(provider.name, provider);
      this.logger.log(
        `Registered built-in context provider '${provider.name}' (priority=${provider.priority ?? 'unset'}, ttl=${provider.cacheTtlSeconds ?? 'none'})`,
      );
    }

    this.assertRegistryHealthy();
    this.logger.log(
      `Built-in context provider registration complete: ${this.getRegisteredNames().length} provider(s) registered`,
    );
  }

  /**
   * Public re-entrancy guard: re-running `onApplicationBootstrap` (e.g.
   * in tests) MUST be a no-op for registry size — registration is keyed
   * by provider name and overwrites, so calling it twice yields the same
   * count and the same load order.
   */
  reRunForTesting(): void {
    this.onApplicationBootstrap();
  }

  /**
   * Public accessor — delegated to `ChatSessionContextService` to avoid
   * reaching into its private field. Returns the names in insertion order.
   */
  getRegisteredNames(): string[] {
    return this.chatSessionContextService.getRegisteredProviderNames();
  }

  private assertRegistryHealthy(): void {
    this.chatSessionContextService.assertRegistryNonEmpty(
      'BuiltInContextProviderRegistrar.onApplicationBootstrap',
    );
  }
}

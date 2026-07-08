import { Injectable, Logger } from '@nestjs/common';
import { BudgetPolicyService } from '../../cost-governance/budget-policy.service';
import { BudgetUsageEventRepository } from '../../cost-governance/database/repositories/budget-usage-event.repository';
import type {
  ChatContextBlock,
  IChatContextProvider,
} from '../../session/chat-context-providers/chat-context.provider.interface';
import type { ChatSession } from '../../chat/database/entities/chat-session.entity';

/**
 * Canonical budget context provider — registers as the `'budget'` provider
 * with `ChatSessionContextService` at `MemoryModule` bootstrap.
 *
 * Backwards compatibility:
 *   - The pre-EPIC-202 public surface was a single
 *     `build(contextId: string): Promise<string>` method, consumed by
 *     `budget-context.provider.spec.ts`. That method is preserved here as
 *     a thin shim that calls the new `getContext` method. New consumers
 *     should depend on the `IChatContextProvider` interface instead.
 *   - This file is re-exported from `apps/api/src/cost-governance/budget-context.provider.ts`
 *     so legacy imports keep resolving to the same class identity.
 */
@Injectable()
export class BudgetContextProvider implements IChatContextProvider {
  private readonly logger = new Logger(BudgetContextProvider.name);

  readonly name = 'budget';
  readonly priority = 100;
  readonly cacheTtlSeconds = 60;

  constructor(
    private readonly policyService: BudgetPolicyService,
    private readonly usageRepo: BudgetUsageEventRepository,
  ) {}

  /**
   * `contextId` is currently derived from the chat session id. The session
   * is the unit of context for budget usage tracking (see
   * `BudgetUsageEventRepository.getSpendInWindow`).
   */
  canProvide(session: ChatSession): Promise<boolean> {
    return Promise.resolve(
      typeof session?.id === 'string' && session.id.length > 0,
    );
  }

  async getContext(session: ChatSession): Promise<ChatContextBlock> {
    const content = await this.build(session.id);
    return {
      title: 'Budget',
      content,
      priority: this.priority,
      metadata: {
        source: 'budget',
        provider: this.name,
        cacheTtlSeconds: this.cacheTtlSeconds,
      },
    };
  }

  /**
   * Legacy API — kept for backwards compatibility with the original
   * `budget-context.provider.spec.ts` test suite and any external callers
   * that imported `BudgetContextProvider` directly. New code should use
   * `getContext` / `canProvide` via `IChatContextProvider`.
   */
  async build(contextId: string): Promise<string> {
    const policies = await this.policyService.listAll();

    if (policies.length === 0) {
      return '## Budget\n\nNo active budget policies. Spending is unrestricted.';
    }

    const today = new Date();
    const windowStart = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    );
    const spend = await this.usageRepo.getSpendInWindow(
      null,
      contextId,
      windowStart,
    );

    let block = '## Budget\n\n';
    block += `Current spend this period: ${spend.totalCents ?? 0} cents (${spend.totalTokens ?? 0} tokens)\n\n`;

    for (const p of policies) {
      block += `- **${p.name}**: ${p.enforcement_mode} | `;
      if (p.hard_limit_cents !== null)
        block += `hard: ${p.hard_limit_cents}c | `;
      if (p.soft_limit_cents !== null)
        block += `soft: ${p.soft_limit_cents}c | `;
      if (p.token_limit !== null) block += `token: ${p.token_limit} | `;
      block += `window: ${p.window}\n`;
    }

    block +=
      '\nIf your action exceeds a limit, you may need to request approval or reduce scope.';
    return block;
  }
}

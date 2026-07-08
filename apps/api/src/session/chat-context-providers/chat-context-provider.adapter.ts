import type {
  ISystemPromptContributor,
  PromptAssemblyContext,
  PromptContributionBlock,
} from '../../system-prompt/system-prompt-contributor.types';
import type { IChatContextProvider } from './chat-context.provider.interface';
import type { ChatPromptAssemblyContext } from './chat-context.types';

/**
 * Adapts a chat-scoped {@link IChatContextProvider} to the harness-neutral
 * {@link ISystemPromptContributor} seam. Only fires for chat contexts; returns
 * null for any other run type.
 *
 * Error handling mirrors the original `safeGetContext` behaviour: a `getContext`
 * failure is caught and returned as a degraded error block so the session
 * context message still surfaces the failure rather than silently dropping it.
 * A `canProvide` failure returns `null` (provider is skipped) to maintain
 * the same semantics as the original `safeCanProvide`.
 */
export class ChatContextProviderAdapter implements ISystemPromptContributor {
  constructor(private readonly provider: IChatContextProvider) {}

  get name(): string {
    return this.provider.name;
  }

  get priority(): number | undefined {
    return this.provider.priority;
  }

  async contribute(
    ctx: PromptAssemblyContext,
  ): Promise<PromptContributionBlock | null> {
    if (ctx.runType !== 'chat') {
      return null;
    }
    const { session } = ctx as ChatPromptAssemblyContext;

    try {
      if (!(await this.provider.canProvide(session))) {
        return null;
      }
    } catch {
      // canProvide failure: skip the provider (matches safeCanProvide behaviour)
      return null;
    }

    try {
      return await this.provider.getContext(session);
    } catch (error) {
      // getContext failure: surface a degraded error block (matches safeGetContext behaviour)
      return {
        title: `${this.provider.name} (Error)`,
        content: `*Error loading context: ${(error as Error).message}*`,
        priority: this.provider.priority ?? 100,
        metadata: {
          provider: this.provider.name,
          error: (error as Error).message,
        },
      };
    }
  }
}

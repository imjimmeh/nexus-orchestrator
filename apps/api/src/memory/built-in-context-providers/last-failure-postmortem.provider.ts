import { Injectable, Logger } from '@nestjs/common';
import type {
  ChatContextBlock,
  IChatContextProvider,
} from '../../session/chat-context-providers/chat-context.provider.interface';
import type { ChatSession } from '../../chat/database/entities/chat-session.entity';
import { WorkflowEventRepository } from '../../workflow/database/repositories/workflow-event.repository';
import type { WorkflowEvent } from '../../workflow/database/entities/workflow-event.entity';

/**
 * Last-failure postmortem provider.
 *
 * `cacheTtlSeconds = null` means the orchestrator will not cache the
 * result; the block is re-fetched on every context assembly. This matches
 * the "always fresh" expectation for failure postmortems — the operator
 * who retries a workflow should see the latest failure, not a stale one.
 *
 * Wiring notes:
 *   - The provider reads the canonical failure events out of
 *     `WorkflowEventRepository` — the same repository that
 *     `WorkflowEventLogService.getPagedHistory` and the workflow-repair
 *     subsystem (see `apps/api/src/workflow/workflow-repair/`) read
 *     from. The repository is registered globally by `DatabaseModule`,
 *     which `BuiltInMemoryContextProvidersModule` already imports, so
 *     no additional module edge is required and no new
 *     `BuiltInMemoryContextProvidersModule` ↔ `WorkflowModule`
 *     `forwardRef` cycle is introduced (per the architecture decision in
 *     `ADR-built-in-context-provider-stub-wiring.md`).
 *   - `canProvide` is the adapter's "drop the contribution" gate (see
 *     `ChatContextProviderAdapter.contribute`). Returning `false` here
 *     causes the orchestrator to skip the block entirely, so a session
 *     without a `scopeId` or without any failure events does not surface
 *     an empty "Last Failure Postmortem" header to the model.
 *   - `getContext` always returns a `ChatContextBlock` per the
 *     `IChatContextProvider` contract. The block is rendered as a
 *     `## Last Failure Postmortem` markdown section with the latest
 *     failure's timestamp, `event_type`, run identity, and a short
 *     payload excerpt (the full payload is rarely useful in the chat
 *     preamble and would blow past the provider's cache/budget bounds).
 *
 * Load-order contract (pinned by
 * `built-in-memory-context-providers.module.spec.ts`):
 *   - `name`: `last-failure-postmortem`
 *   - `priority`: `170` (lower than digest/strategy/recent-task-summary
 *     so the broader project state lands before the narrow failure
 *     signal; higher than `user-preference-echo` so the failure context
 *     precedes the long-lived preference echo)
 *   - `cacheTtlSeconds`: `null` (always fresh — failure postmortems
 *     must reflect the latest failure, never a cached older one).
 */
@Injectable()
export class LastFailurePostmortemProvider implements IChatContextProvider {
  private readonly logger = new Logger(LastFailurePostmortemProvider.name);

  /**
   * Canonical `event_type` strings (as written by
   * `WorkflowAuditListener` in
   * `apps/api/src/workflow/listeners/workflow-audit.listener.ts`) that
   * classify a `WorkflowEvent` as a failure. `workflow.failed` covers
   * terminal run failures; `job.failed` covers per-job failures that
   * the workflow engine may later retry or escalate.
   */
  static readonly FAILURE_EVENT_TYPES: readonly string[] = [
    'workflow.failed',
    'job.failed',
  ] as const;

  /** Maximum payload excerpt length surfaced in the markdown block. */
  static readonly MAX_PAYLOAD_EXCERPT_CHARS = 320;

  /** Page size for the failure-event lookup (newest first). */
  static readonly LOOKUP_LIMIT = 1;

  readonly name = 'last-failure-postmortem';
  readonly priority = 170;
  readonly cacheTtlSeconds: number | null = null;

  constructor(
    private readonly workflowEventRepository: WorkflowEventRepository,
  ) {}

  async canProvide(session: ChatSession): Promise<boolean> {
    const scopeId = session?.scopeId;
    if (typeof scopeId !== 'string' || scopeId.length === 0) {
      return false;
    }

    const [, total] = await this.workflowEventRepository.findPaged(
      {
        limit: LastFailurePostmortemProvider.LOOKUP_LIMIT,
        offset: 0,
      },
      {
        scopeId,
        eventTypes: LastFailurePostmortemProvider.FAILURE_EVENT_TYPES,
      },
    );

    return total > 0;
  }

  async getContext(session: ChatSession): Promise<ChatContextBlock> {
    const scopeId = session?.scopeId;
    if (typeof scopeId !== 'string' || scopeId.length === 0) {
      // Defensive: `canProvide` gates this, but a direct caller that
      // bypasses the adapter (e.g. a unit test) should still receive a
      // well-formed block rather than a crash.
      return this.buildEmptyBlock();
    }

    const [events, total] = await this.workflowEventRepository.findPaged(
      {
        limit: LastFailurePostmortemProvider.LOOKUP_LIMIT,
        offset: 0,
      },
      {
        scopeId,
        eventTypes: LastFailurePostmortemProvider.FAILURE_EVENT_TYPES,
      },
    );

    if (total === 0 || events.length === 0) {
      return this.buildEmptyBlock();
    }

    const latest = events[0];
    if (latest === undefined) {
      // Defensive: `findPaged` returned `total > 0` but the items
      // array is empty. Treat as "no failure event" and return the
      // empty block rather than throwing on the index access below.
      return this.buildEmptyBlock();
    }
    return {
      title: 'Last Failure Postmortem',
      content: this.renderMarkdownBlock(latest),
      priority: this.priority,
      metadata: {
        source: 'last-failure-postmortem',
        provider: this.name,
        cacheTtlSeconds: this.cacheTtlSeconds,
        scopeId,
        eventType: latest.event_type,
        workflowRunId: latest.workflow_run_id,
        jobId: latest.job_id ?? null,
        occurredAt: latest.timestamp.toISOString(),
      },
    };
  }

  /**
   * Render a single `WorkflowEvent` row as the markdown block surfaced
   * to the chat preamble. Pure function — easy to unit test without
   * touching the repository mock. The timestamp is rendered as the raw
   * ISO-8601 string so the model can correlate it with log lines
   * without doing timezone math; the payload excerpt is truncated to
   * `MAX_PAYLOAD_EXCERPT_CHARS` so a pathological payload cannot blow
   * the provider's cache / budget bounds.
   */
  private renderMarkdownBlock(event: WorkflowEvent): string {
    const lines: string[] = ['## Last Failure Postmortem', ''];

    lines.push(`- **Occurred at**: ${event.timestamp.toISOString()}`);
    lines.push(`- **Event type**: ${event.event_type}`);
    lines.push(`- **Workflow run**: ${event.workflow_run_id}`);

    if (typeof event.job_id === 'string' && event.job_id.length > 0) {
      lines.push(`- **Job**: ${event.job_id}`);
    }
    if (typeof event.step_id === 'string' && event.step_id.length > 0) {
      lines.push(`- **Step**: ${event.step_id}`);
    }
    if (
      typeof event.correlation_id === 'string' &&
      event.correlation_id.length > 0
    ) {
      lines.push(`- **Correlation**: ${event.correlation_id}`);
    }

    const excerpt = this.summarizePayload(event.payload);
    if (excerpt.length > 0) {
      lines.push('', '**Payload excerpt:**', '', '```json', excerpt, '```');
    }

    return lines.join('\n');
  }

  /**
   * Render the event's `payload` as a compact, JSON-formatted excerpt
   * truncated to `MAX_PAYLOAD_EXCERPT_CHARS` characters. Returns the
   * empty string when the payload is missing or empty so the caller can
   * skip the `**Payload excerpt:**` block.
   */
  private summarizePayload(payload: WorkflowEvent['payload']): string {
    if (payload === undefined || payload === null) {
      return '';
    }
    const serialized = safeStringify(payload);
    if (serialized.length === 0) {
      return '';
    }
    if (
      serialized.length <=
      LastFailurePostmortemProvider.MAX_PAYLOAD_EXCERPT_CHARS
    ) {
      return serialized;
    }
    return `${serialized.slice(0, LastFailurePostmortemProvider.MAX_PAYLOAD_EXCERPT_CHARS)}…`;
  }

  private buildEmptyBlock(): ChatContextBlock {
    return {
      title: 'Last Failure Postmortem',
      content:
        '## Last Failure Postmortem\n\n_No recorded failure events for this scope._',
      priority: this.priority,
      metadata: {
        source: 'last-failure-postmortem',
        provider: this.name,
        cacheTtlSeconds: this.cacheTtlSeconds,
        failureEventCount: 0,
      },
    };
  }
}

/**
 * `JSON.stringify` shim with a circular-reference guard and an
 * exception-swallow fallback. The event payload is a jsonb column and
 * is therefore expected to be JSON-safe in practice, but a malformed
 * row should not crash the chat context assembly path — returning the
 * empty string lets the renderer skip the payload excerpt cleanly.
 */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

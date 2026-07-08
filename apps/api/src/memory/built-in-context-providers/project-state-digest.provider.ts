import { Injectable, Logger } from '@nestjs/common';
import type {
  ChatContextBlock,
  IChatContextProvider,
} from '../../session/chat-context-providers/chat-context.provider.interface';
import type { ChatSession } from '../../chat/database/entities/chat-session.entity';
import { MemoryManagerService } from '../memory-manager.service';

/**
 * Project state digest provider.
 *
 * Surfaces the singleton `strategic_intent` memory segment
 * (introduced in EPIC-208) for the chat session's scope (a neutral
 * platform identifier — typically the project id bound to the session
 * via `ChatSession.scopeId`). The strategic_intent record is the CEO
 * long-term planning digest persisted across orchestration cycles;
 * surfacing it in the chat context gives the assistant a working
 * memory of the project's planning horizon, priority themes, focus
 * areas, constraints, and rationale without re-reading the full
 * chat history.
 *
 * Wiring notes:
 *   - `MemoryManagerService` lives in `MemoryModule`, which is imported
 *     via `forwardRef` on both edges of the cycle with
 *     `BuiltInMemoryContextProvidersModule` (see M2). The module graph
 *     wiring handles the cycle resolution; constructor injection of the
 *     service is plain and does not need a `forwardRef` of its own.
 *   - `canProvide` is the adapter's "drop the contribution" gate (see
 *     `ChatContextProviderAdapter.contribute`). Returning `false` here
 *     causes the orchestrator to skip the block entirely, so a session
 *     without a scope or without a recorded strategic_intent does not
 *     surface an empty "Project State Digest" header to the model.
 *   - `getContext` always returns a `ChatContextBlock` per the
 *     `IChatContextProvider` contract. When `canProvide` would return
 *     false (no scopeId or no strategic_intent segment), a degraded
 *     empty block is returned so a direct caller that bypasses the
 *     adapter (e.g. a unit test) still receives a well-formed block
 *     rather than a crash.
 *   - The strategic_intent segment is cached for `cacheTtlSeconds`
 *     (300s) — long enough to keep the block stable across a single
 *     conversation but short enough that a freshly recorded intent
 *     becomes visible within a few minutes.
 *
 * Load-order contract (pinned by
 * `built-in-memory-context-providers.module.spec.ts`):
 *   - `name`: `project-state-digest`
 *   - `priority`: `200` (higher than recent-task-summary so the
 *     long-lived project plan anchors the chat context above the
 *     short-lived task history)
 *   - `cacheTtlSeconds`: `300` (5 minutes — strategic intent is
 *     upsert-mostly, so a short TTL keeps the block fresh without
 *     re-reading on every prompt)
 */
@Injectable()
export class ProjectStateDigestProvider implements IChatContextProvider {
  private readonly logger = new Logger(ProjectStateDigestProvider.name);

  /** Neutral platform identifier used for the strategic_intent scope. */
  static readonly ENTITY_TYPE = 'Project';

  readonly name = 'project-state-digest';
  readonly priority = 200;
  readonly cacheTtlSeconds = 300;

  constructor(private readonly memoryManager: MemoryManagerService) {}

  async canProvide(session: ChatSession): Promise<boolean> {
    const scopeId = session?.scopeId;
    if (typeof scopeId !== 'string' || scopeId.length === 0) {
      return false;
    }

    const segment = await this.memoryManager.getStrategicIntentSegment(
      ProjectStateDigestProvider.ENTITY_TYPE,
      scopeId,
    );

    return segment !== null;
  }

  async getContext(session: ChatSession): Promise<ChatContextBlock> {
    const scopeId = session?.scopeId;
    if (typeof scopeId !== 'string' || scopeId.length === 0) {
      // Defensive: `canProvide` gates this, but a direct caller that
      // bypasses the adapter (e.g. a unit test) should still receive a
      // well-formed block rather than a crash.
      return this.buildEmptyBlock();
    }

    const segment = await this.memoryManager.getStrategicIntentSegment(
      ProjectStateDigestProvider.ENTITY_TYPE,
      scopeId,
    );

    if (segment === null) {
      return this.buildEmptyBlock();
    }

    const payload = ProjectStateDigestProvider.parseMetadata(
      segment.metadata_json,
    );

    const lines: string[] = ['## Project State Digest', ''];

    if (typeof payload.horizon === 'string' && payload.horizon.length > 0) {
      lines.push(`- **Horizon**: ${payload.horizon}`);
    }
    const themes = this.renderStringList(payload.priority_themes);
    if (themes !== null) {
      lines.push(`- **Priority themes**: ${themes}`);
    }
    const focusAreas = this.renderStringList(payload.focus_areas);
    if (focusAreas !== null) {
      lines.push(`- **Focus areas**: ${focusAreas}`);
    }
    const constraints = this.renderStringList(payload.constraints);
    if (constraints !== null) {
      lines.push(`- **Constraints**: ${constraints}`);
    }
    if (typeof payload.rationale === 'string' && payload.rationale.length > 0) {
      lines.push(`- **Rationale**: ${payload.rationale}`);
    }

    // Every field was missing/empty — fall back to the empty block so
    // the rendered markdown is still informative ("no strategic intent
    // recorded") rather than a bare header with no body.
    if (lines.length === 2) {
      return this.buildEmptyBlock();
    }

    return {
      title: 'Project State Digest',
      content: lines.join('\n'),
      priority: this.priority,
      metadata: {
        source: 'project-state-digest',
        provider: this.name,
        cacheTtlSeconds: this.cacheTtlSeconds,
        segmentId: segment.id,
      },
    };
  }

  /**
   * Parse `metadata_json` into the strategic_intent payload shape. The
   * entity stores `metadata_json` as a jsonb column (already-parsed
   * object), but we accept a JSON-encoded string defensively in case a
   * future backend (e.g. Honcho) returns the raw encoded form. Unknown
   * fields are tolerated; missing fields fall back to `undefined` so
   * the renderer can decide to omit them.
   */
  private static parseMetadata(
    raw: Record<string, unknown> | null | undefined,
  ): {
    horizon: unknown;
    priority_themes: unknown;
    focus_areas: unknown;
    constraints: unknown;
    rationale: unknown;
  } {
    let payload: Record<string, unknown> | null | undefined = raw;
    if (typeof payload === 'string') {
      try {
        const parsed = JSON.parse(payload) as unknown;
        payload =
          parsed !== null && typeof parsed === 'object'
            ? (parsed as Record<string, unknown>)
            : null;
      } catch {
        payload = null;
      }
    }
    if (payload === null || payload === undefined) {
      payload = {};
    }

    return {
      horizon: payload['horizon'],
      priority_themes: payload['priority_themes'],
      focus_areas: payload['focus_areas'],
      constraints: payload['constraints'],
      rationale: payload['rationale'],
    };
  }

  /**
   * Render a `string[]` as a comma-joined list. Returns `null` when the
   * field is missing or all entries are empty so the caller can omit
   * the rendered line entirely.
   */
  private renderStringList(raw: unknown): string | null {
    if (!Array.isArray(raw)) {
      return null;
    }
    const entries = raw
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (entries.length === 0) {
      return null;
    }
    return entries.join(', ');
  }

  private buildEmptyBlock(): ChatContextBlock {
    return {
      title: 'Project State Digest',
      content:
        '## Project State Digest\n\n_No strategic intent recorded for this scope yet._',
      priority: this.priority,
      metadata: {
        source: 'project-state-digest',
        provider: this.name,
        cacheTtlSeconds: this.cacheTtlSeconds,
      },
    };
  }
}

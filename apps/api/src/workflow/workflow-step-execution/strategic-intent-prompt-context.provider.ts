import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { asRecord, isRecord, type StrategicIntentBody } from '@nexus/core';
import { MemoryManagerService } from '../../memory/memory-manager.service';
import {
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowRunRepository,
} from '../kernel/interfaces/workflow-kernel.ports';

/**
 * EPIC-208 (Milestone 2) — builds the "Strategic Intent" block that is
 * injected into the CEO cycle prompt context (the modern replacement for
 * the legacy `decide.md` prompt) on every cycle. The block is only
 * rendered for runs of the CEO cycle workflow
 * (`project_orchestration_cycle_ceo`) so unrelated workflows are
 * unaffected.
 *
 * Behaviour:
 *  - Detects a CEO cycle run by looking up `workflow_id` on the run
 *    record (cheap, single DB hit).
 *  - Resolves the project scope id from the trigger state variables so
 *    the lookup matches the scope the cycle is acting on.
 *  - Reads the singleton `strategic_intent` memory segment for that
 *    scope via `MemoryManagerService.getStrategicIntentSegment`.
 *  - When no segment is recorded yet, the section is omitted entirely
 *    so an empty CEO cycle is not polluted with a "no intent" stub.
 *  - When a segment IS recorded, all four required fields are rendered:
 *    `horizon`, `priority_themes`, `focus_areas`, `constraints`. The
 *    optional `rationale` and `updated_at` fields are rendered when
 *    present so the CEO can see the freshness of the recorded intent.
 *    `updated_by` is always rendered, defaulting to `"ceo"` when the
 *    metadata omits it, so the originator of the intent is always
 *    attributable.
 *
 * Failures (DB outage, malformed metadata, …) are logged at WARN and
 * degrade to an empty string — the strategic-intent context is
 * advisory and must never block the agent's first turn.
 */
@Injectable()
export class StrategicIntentPromptContextProvider {
  private readonly logger = new Logger(
    StrategicIntentPromptContextProvider.name,
  );

  static readonly CEO_CYCLE_WORKFLOW_ID = 'project_orchestration_cycle_ceo';

  static readonly STRATEGIC_INTENT_ENTITY_TYPE = 'ceo_cycle';

  private static readonly DEFAULT_STRATEGIC_INTENT_UPDATED_BY = 'ceo';

  constructor(
    @Optional()
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepo?: IWorkflowRunRepository,
    @Optional()
    private readonly memoryManager?: MemoryManagerService,
  ) {}

  /**
   * Returns a markdown "Strategic Intent" block to inject into the CEO
   * cycle prompt context, or an empty string when no block should be
   * rendered.
   */
  async buildContext(params: {
    workflowRunId: string;
    stateVariables: Record<string, unknown>;
  }): Promise<string> {
    try {
      const run = await this.resolveRun(params.workflowRunId);
      if (
        !run ||
        run.workflow_id !==
          StrategicIntentPromptContextProvider.CEO_CYCLE_WORKFLOW_ID
      ) {
        return '';
      }

      const scopeId = this.resolveScopeId(params.stateVariables);
      if (!scopeId) {
        return '';
      }

      const segment = await this.readStrategicIntent(scopeId);
      if (!segment) {
        return '';
      }

      const intent = this.parseIntent(segment.metadata_json);
      if (!intent) {
        return '';
      }

      return this.renderStrategicIntentBlock({
        scopeId,
        segmentId: segment.id,
        version: segment.version,
        updatedAt: segment.updated_at,
        intent,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to build strategic-intent prompt context for run ${params.workflowRunId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return '';
    }
  }

  private async resolveRun(workflowRunId: string) {
    if (!this.runRepo) {
      return null;
    }
    return this.runRepo.findById(workflowRunId);
  }

  private resolveScopeId(
    stateVariables: Record<string, unknown>,
  ): string | undefined {
    const trigger = asRecord(stateVariables.trigger);
    const topLevel =
      readTrimmedString(trigger, 'scopeId') ??
      readTrimmedString(trigger, 'scope_id');
    if (topLevel) {
      return topLevel;
    }
    const context = asRecord(trigger?.context);
    return (
      readTrimmedString(context, 'scopeId') ??
      readTrimmedString(context, 'scope_id') ??
      undefined
    );
  }

  private async readStrategicIntent(scopeId: string) {
    if (!this.memoryManager) {
      return null;
    }
    return this.memoryManager.getStrategicIntentSegment(
      StrategicIntentPromptContextProvider.STRATEGIC_INTENT_ENTITY_TYPE,
      scopeId,
    );
  }

  private parseIntent(metadata: unknown): StrategicIntentBody | null {
    if (!isRecord(metadata)) {
      return null;
    }
    const horizon = readTrimmedString(metadata, 'horizon');
    if (!horizon) {
      return null;
    }
    const priorityThemes = readStringArray(metadata.priority_themes);
    const focusAreas = readStringArray(metadata.focus_areas);
    const constraints = readStringArray(metadata.constraints);
    const rationale = readTrimmedString(metadata, 'rationale');
    const updatedAt = readTrimmedString(metadata, 'updated_at');
    const updatedBy =
      readTrimmedString(metadata, 'updated_by') ??
      StrategicIntentPromptContextProvider.DEFAULT_STRATEGIC_INTENT_UPDATED_BY;
    return {
      horizon,
      priority_themes: priorityThemes,
      focus_areas: focusAreas,
      constraints,
      ...(rationale ? { rationale } : {}),
      ...(updatedAt ? { updated_at: updatedAt } : {}),
      updated_by: updatedBy,
    };
  }

  private renderStrategicIntentBlock(params: {
    scopeId: string;
    segmentId: string;
    version: number;
    updatedAt: Date;
    intent: StrategicIntentBody;
  }): string {
    const lines: string[] = [
      '## Strategic Intent (Recorded by Previous CEO Cycle)',
      '',
      'The most recent strategic intent recorded by the previous CEO cycle is available below. This block is loaded fresh once per cycle from the `strategic_intent` memory segment for this scope and reflects what the prior CEO intended to focus on. Use it to decide whether to continue, refine, or pivot this cycle.',
      '',
      `- Scope: \`${params.scopeId}\``,
      `- Segment: \`${params.segmentId}\` (version ${params.version})`,
      `- Updated: \`${params.updatedAt.toISOString()}\``,
    ];

    lines.push('', '### Fields', '', `- **horizon:** ${params.intent.horizon}`);

    lines.push(
      `- **priority_themes:** ${
        params.intent.priority_themes.length > 0
          ? params.intent.priority_themes
              .map((theme) => `\`${theme}\``)
              .join(', ')
          : '_none recorded_'
      }`,
    );
    lines.push(
      `- **focus_areas:** ${
        params.intent.focus_areas.length > 0
          ? params.intent.focus_areas.map((area) => `\`${area}\``).join(', ')
          : '_none recorded_'
      }`,
    );
    lines.push(
      `- **constraints:** ${
        params.intent.constraints.length > 0
          ? params.intent.constraints.map((c) => `\`${c}\``).join(', ')
          : '_none recorded_'
      }`,
    );

    if (params.intent.rationale) {
      lines.push('', `**Rationale:** ${params.intent.rationale}`);
    }
    if (params.intent.updated_by) {
      lines.push(`**Recorded by:** \`${params.intent.updated_by}\``);
    }

    return lines.join('\n');
  }
}

function readTrimmedString(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  if (!record) {
    return undefined;
  }
  const value = record[key];
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is string =>
      typeof entry === 'string' && entry.trim().length > 0,
  );
}

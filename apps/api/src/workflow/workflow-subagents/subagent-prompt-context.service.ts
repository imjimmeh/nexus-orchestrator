import { Injectable, Logger } from '@nestjs/common';
import { SystemPromptAssemblyService } from '../../system-prompt/system-prompt-assembly.service';
import type { PromptAssemblyContext } from '../../system-prompt/system-prompt-contributor.types';
import type { PromptContextSupportLike } from '../agent-prompt/universal-prompt-context.types';
import { MemoryManagerService } from '../../memory/memory-manager.service';
import { MemoryRetrievalService } from '../../memory/signals/memory-retrieval.service';
import { SystemSettingsService } from '../../settings/system-settings.service';
import {
  buildRecallIdentity,
  formatPromotedLearningSection,
  resolveEntityScopeFromState,
  resolvePromotedLessonsForInjection,
} from '../workflow-step-execution/step-support-promoted-learning.helpers';

/**
 * Adapter that satisfies the `PromptContextSupportLike` interface for the
 * subagent provisioning path — the subagent-side counterpart of
 * `StepSupportService`.
 *
 * Provides the two capabilities needed by `buildUniversalPromptLayers`:
 *
 * 1. `assembleAgentSystemPrompt` — delegates to `SystemPromptAssemblyService`
 *    so registered contributors (e.g. `TodoPromptContributor`) can augment
 *    subagent prompts in the same pipeline used by workflow steps.
 *
 * 2. `buildPromotedLearningContext` — resolves promoted lessons via the
 *    exact same shared helper the step path calls
 *    (`resolvePromotedLessonsForInjection` in
 *    `step-support-promoted-learning.helpers.ts`), so subagents receive
 *    real memory/learning injection rather than a stubbed empty string
 *    (FU-8). Unlike `StepSupportService`, this service has no run/workflow
 *    repositories of its own — `agentProfileName` and `workflowName` are
 *    resolved upstream (by the subagent ctx-builder, which has the
 *    already-available `workflowRepo` + spawn-resolved workflow id) and
 *    passed straight through to `buildRecallIdentity`.
 */
@Injectable()
export class SubagentPromptContextService implements PromptContextSupportLike {
  private readonly logger = new Logger(SubagentPromptContextService.name);

  constructor(
    private readonly systemPromptAssembly: SystemPromptAssemblyService,
    private readonly memoryManager: MemoryManagerService,
    private readonly memoryRetrieval: MemoryRetrievalService,
    private readonly systemSettings: SystemSettingsService,
  ) {}

  async buildPromotedLearningContext(params: {
    workflowRunId: string;
    stateVariables?: Record<string, unknown>;
    query?: string;
    limit?: number;
    agentProfileName?: string;
    workflowName?: string;
  }): Promise<string> {
    const scope = resolveEntityScopeFromState(
      params.stateVariables,
      params.workflowRunId,
    );
    if (!scope) {
      return '';
    }
    try {
      const lessons = await resolvePromotedLessonsForInjection(
        {
          systemSettings: this.systemSettings,
          memoryRetrieval: this.memoryRetrieval,
          memoryManager: this.memoryManager,
        },
        scope,
        params.query?.trim() ?? '',
        params.limit,
        buildRecallIdentity(params.agentProfileName, params.workflowName),
      );
      if (lessons.length === 0) {
        return '';
      }
      return formatPromotedLearningSection(lessons);
    } catch (error) {
      this.logger.warn(
        `Failed to build promoted-learning context for ${scope.entityType}:${scope.entityId}: ${error}`,
      );
      return '';
    }
  }

  async assembleAgentSystemPrompt(ctx: PromptAssemblyContext): Promise<string> {
    const result = await this.systemPromptAssembly.assemble(ctx);
    return result.prompt;
  }
}

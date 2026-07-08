import { HarnessId, SkillDiscoveryMode } from '@nexus/core';
import type { PromptAssemblyContext } from '../../system-prompt/system-prompt-contributor.types';

/**
 * Minimal structural interface for the support object passed into universal
 * prompt layer building.  Both `StepSupportService` (workflow path) and the
 * lightweight subagent prompt-context adapter satisfy this interface via
 * structural typing — no concrete import is required here.
 */
export interface PromptContextSupportLike {
  buildPromotedLearningContext(params: {
    workflowRunId: string;
    stateVariables?: Record<string, unknown>;
    query?: string;
    limit?: number;
    agentProfileName?: string;
    /**
     * Run-resolved workflow definition name, threaded into the shared
     * `resolvePromotedLessonsForInjection` recall identity (Epic C /
     * FU-8) so workflow-scoped memories surface for both the step and
     * subagent execution paths.
     */
    workflowName?: string;
  }): Promise<string>;
  assembleAgentSystemPrompt(ctx: PromptAssemblyContext): Promise<string>;
}

/**
 * Minimal skill shape required by the universal prompt layer builder.
 * Only `id`, `name`, `description`, and `skillMarkdown` are accessed by
 * `buildSkillSection`; the full `SkillLibraryRecord` satisfies this as a
 * structural supertype.
 */
export interface SkillLike {
  id: string;
  name: string;
  description: string;
  skillMarkdown: string;
}

/**
 * Shared context for building agent prompts (step or subagent execution paths).
 * Consolidates workflow metadata, skill configuration, and memory settings used
 * by both step execution and subagent provisioning to ensure consistent prompt
 * assembly and memory capture behavior.
 */
export interface UniversalPromptContext {
  support: PromptContextSupportLike;
  harnessId?: HarnessId;
  workflowRunId: string;
  jobId: string;
  stepId: string;
  scopeId?: string;
  contextId?: string;
  contextType?: string;
  entityType?: string;
  entityId?: string;
  resolvedSystemPrompt: string; // profile/system base prompt (resolveStepSettings)
  assignedSkills?: SkillLike[];
  availableCategories?: string[];
  skillDiscoveryMode: SkillDiscoveryMode;
  taskPrompt?: string; // step.prompt OR subagent task — used as the memory-recall query
  suppressMemoryCapture: boolean; // shouldSuppressMemoryCapture(workflowId) || sweep/CEO
  agentProfile?: string;
  /**
   * Run-resolved workflow definition name (FU-8). Optional: the step path
   * leaves this unset and relies on `StepSupportService.buildPromotedLearningContext`'s
   * own internal run→workflow resolution (pre-existing, unchanged); the
   * subagent path resolves it eagerly here (via the already-available
   * `workflowRepo` + spawn-resolved workflow id) since its support
   * implementation has no equivalent internal fallback. Either way the
   * value flows into the same shared `buildRecallIdentity` /
   * `resolvePromotedLessonsForInjection` helpers.
   */
  workflowName?: string;
  runType: 'workflow' | 'subagent';
}

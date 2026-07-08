import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  ContainerTier,
  IToolPermissionPolicy,
  IToolRegistry,
  IWorkflowStep,
  IJob,
  WorkflowStatus,
  ToolPolicyStrategy,
  ToolPolicyEffect,
  isToolPolicyDocument,
  type ToolPolicyDocument,
  getScopeId,
  resolveSkillDiscoveryMode,
  type SkillDiscoveryMode,
} from '@nexus/core';
import { sleep } from '../../common/utils/async.utils';
import { AiConfigurationService } from '../../ai-config/ai-configuration.service';
import { ToolPolicyEvaluatorService } from '../../capability-governance/tool-policy-evaluator.service';
import type { SkillLibraryRecord } from '../../ai-config/services/agent-skill-library.service.types';
import {
  WORKFLOW_RUN_REPOSITORY_PORT,
  WORKFLOW_DEFINITION_REPOSITORY_PORT,
  type IWorkflowRunRepository,
  type IWorkflowDefinitionRepository,
} from '../kernel/interfaces/workflow-kernel.ports';
import { formatRunningWorkflowsSummary } from '@nexus/core';
import { mapRunningWorkflowSummaries } from '../workflow-runtime/running-workflows.helpers';
import { ToolMountingService } from '../../tool-runtime/tool-mounting.service';
import { StateManagerService } from '../state-manager.service';
import { GitWorktreeService } from '../../common/git/git-worktree.service';
import type { WorkflowLifecycleStage } from '../workflow-stage-skill-policy.service.types';
import { WorkflowStageSkillPolicyService } from '../workflow-stage-skill-policy.service';
import { MemoryManagerService } from '../../memory/memory-manager.service';
import { MemoryMetricsService } from '../../memory/memory-metrics.service';
import { MetricsService } from '../../observability/metrics.service';
import { MemoryRetrievalService } from '../../memory/signals/memory-retrieval.service';
import { extractLessonAnchor } from '../../memory/signals/lesson-anchor.helper';
import {
  resolveHoldoutArm,
  type HoldoutArm,
} from '../../memory/signals/holdout-bucket.helper';
import { SystemSettingsService } from '../../settings/system-settings.service';
import {
  LEARNING_HOLDOUT_FRACTION_DEFAULT,
  LEARNING_HOLDOUT_FRACTION_SETTING,
  coerceLearningHoldoutFraction,
} from '../../settings/learning-measurement.settings.constants';
import { SystemPromptAssemblyService } from '../../system-prompt/system-prompt-assembly.service';
import type { PromptAssemblyContext } from '../../system-prompt/system-prompt-contributor.types';
import { extractStructuredOutput } from './step-support.helpers';
import {
  resolveAgentProfileFromInputs,
  resolveTemplatedInputs,
} from './step-support-inputs.helpers';
import { buildUpstreamContextForJob as buildUpstreamContextForJobHelper } from './step-support-upstream.helpers';
import { resolveWorktreePathFromTrigger } from './step-support-worktree.helpers';
import { resolveTriggerContext } from '../../shared/agent-scope.utils';
import {
  resolveAllowedToolNamesForStep,
  applyPolicyToToolNames as applyToolPolicyToNames,
} from './step-support-tool-policy.helpers';
import * as promotedLearningHelpers from './step-support-promoted-learning.helpers';
import { selectToolsForJob as selectToolsForJobWithOutputContract } from './step-support-output-contract.helpers';
import {
  resolveWorkflowIdForRun,
  resolveWorkflowNameById,
} from '../workflow-run-id-resolver.helpers';

@Injectable()
export class StepSupportService {
  private readonly logger = new Logger(StepSupportService.name);

  private readonly STEP_MAX_RUNTIME_MS = Number(
    process.env.WORKFLOW_STEP_MAX_RUNTIME_MS || 3600000,
  );
  private readonly WORKFLOW_INVOCATION_POLL_INTERVAL_MS = Number(
    process.env.WORKFLOW_INVOCATION_POLL_INTERVAL_MS || 1000,
  );
  constructor(
    private readonly aiConfig: AiConfigurationService,
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepo: IWorkflowRunRepository,
    @Inject(WORKFLOW_DEFINITION_REPOSITORY_PORT)
    private readonly workflowRepo: IWorkflowDefinitionRepository,
    private readonly toolMounting: ToolMountingService,
    private readonly stateManager: StateManagerService,
    private readonly gitWorktreeService: GitWorktreeService,
    private readonly stageSkillPolicy: WorkflowStageSkillPolicyService,
    private readonly toolPolicyEvaluator: ToolPolicyEvaluatorService,
    private readonly memoryManager: MemoryManagerService,
    private readonly memoryMetrics: MemoryMetricsService,
    private readonly metrics: MetricsService,
    private readonly systemPromptAssembly: SystemPromptAssemblyService,
    private readonly memoryRetrieval: MemoryRetrievalService,
    private readonly systemSettings: SystemSettingsService,
  ) {}

  resolveInvokedWorkflowId(step: IWorkflowStep): string | undefined {
    if (typeof step.workflow_id === 'string' && step.workflow_id.length > 0) {
      return step.workflow_id;
    }
    if (typeof step.inputs?.workflow_id === 'string') {
      return step.inputs.workflow_id;
    }
    return undefined;
  }

  applyPolicyToToolNames(
    baseToolNames: Set<string>,
    candidateToolNames: Set<string>,
    policy: unknown,
  ): Set<string> {
    return applyToolPolicyToNames(baseToolNames, candidateToolNames, policy);
  }

  resolveAllowedToolNames(params: {
    tools: Array<{ name: string }>;
    job: IJob;
    workflowPermissions?: IToolPermissionPolicy;
    agentProfile?: string;
    policyStrategy?: ToolPolicyStrategy;
  }): Promise<Set<string>> {
    return Promise.resolve(
      resolveAllowedToolNamesForStep({
        ...params,
        canProfileUseTool: this.toolMounting.canProfileUseTool.bind(
          this.toolMounting,
        ),
        applyPolicyToToolNames: this.applyPolicyToToolNames.bind(this),
      }),
    );
  }

  async resolveApprovalRequiredToolNames(params: {
    tools: Array<{ name: string }>;
    agentProfile?: string;
  }): Promise<Set<string>> {
    const allCandidateNames = new Set<string>(params.tools.map((t) => t.name));
    const approvalRequired = new Set<string>();

    if (!params.agentProfile) {
      return approvalRequired;
    }

    const profile = await this.aiConfig.getAgentProfileByName(
      params.agentProfile,
    );

    if (profile?.tool_policy) {
      for (const toolName of allCandidateNames) {
        const decision = this.toolPolicyEvaluator.evaluate(
          toolName,
          {},
          profile.tool_policy,
        );
        if (decision.effect === ToolPolicyEffect.REQUIRE_APPROVAL) {
          approvalRequired.add(toolName);
        }
      }
    }

    return approvalRequired;
  }

  async resolveAgentToolPolicy(
    agentProfile?: string,
  ): Promise<ToolPolicyDocument | null> {
    if (!agentProfile) {
      return null;
    }

    const profile = await this.aiConfig.getAgentProfileByName(agentProfile);
    const policy = profile?.tool_policy;
    if (policy === null || policy === undefined) {
      return null;
    }

    if (!isToolPolicyDocument(policy)) {
      return { default: ToolPolicyEffect.DENY, rules: [] };
    }

    return policy;
  }

  async resolveAssignedSkillsForProfile(
    agentProfile?: string,
    stageContext?: {
      workflowStage?: WorkflowLifecycleStage | null;
      stateVariables?: Record<string, unknown>;
      workflowRunId?: string;
    },
  ): Promise<{
    skills: SkillLibraryRecord[];
    workflowId?: string;
    workflowName?: string;
  }> {
    const scopeId = this.resolveScopeIdFromState(stageContext?.stateVariables);
    const workflowId = await resolveWorkflowIdForRun(
      this.runRepo,
      stageContext?.workflowRunId,
      (message) => {
        this.logger.warn(message);
      },
    );
    const workflowName = await resolveWorkflowNameById(
      this.workflowRepo,
      workflowId,
      (message) => {
        this.logger.warn(message);
      },
    );

    const selection = await this.stageSkillPolicy.resolveAssignedSkills({
      agentProfile,
      workflowStage: stageContext?.workflowStage,
      stateVariables: stageContext?.stateVariables,
      scopeId,
      workflowId,
    });
    return { skills: selection.skills, workflowId, workflowName };
  }

  private resolveScopeIdFromState(
    stateVariables?: Record<string, unknown>,
  ): string | undefined {
    if (!stateVariables) {
      return undefined;
    }
    const context = resolveTriggerContext(stateVariables.trigger);
    return getScopeId(context) ?? undefined;
  }

  /**
   * Build a best-effort summary of workflows still running for this step's
   * scope, excluding the step's own run, for injection into the agent prompt.
   * Returns an empty string when there is no scope, nothing else is in flight,
   * or the lookup fails — it must never block step execution.
   */
  async buildRunningWorkflowsContext(params: {
    stateVariables?: Record<string, unknown>;
    excludeRunId?: string;
  }): Promise<string> {
    const scopeId = this.resolveScopeIdFromState(params.stateVariables);
    if (!scopeId) {
      return '';
    }

    try {
      const runs = await this.runRepo.findActiveByScopeId(scopeId);
      const workflowIds = Array.from(
        new Set(runs.map((run) => run.workflow_id).filter(Boolean)),
      );
      const namesById = new Map(
        (await this.workflowRepo.findByIds(workflowIds)).map((workflow) => [
          workflow.id,
          workflow.name,
        ]),
      );
      const summaries = mapRunningWorkflowSummaries(
        runs,
        namesById,
        Date.now(),
        { excludeRunId: params.excludeRunId },
      );
      return formatRunningWorkflowsSummary(summaries);
    } catch (error) {
      this.logger.warn(
        `Failed to build running-workflows context for scope ${scopeId}: ${error}`,
      );
      return '';
    }
  }

  /**
   * Build a best-effort promoted-lessons section for the step's scope.
   *
   * Side-effect: increments the
   * `nexus_learning_lesson_injected_total{lesson_id, scope}`
   * prom-client counter (and its in-memory mirror on
   * `MemoryMetricsService`) once per promoted lesson that
   * actually enters the planning context — work item
   * 88d7654e-ca93-4ffa-8ba5-7065db9506db. This is the
   * "did the downstream agent use this promoted lesson"
   * signal that closes the self-improvement feedback loop.
   * The metric fires ONLY for lessons that survived the search
   * and will be rendered into the context; candidate queries
   * that returned no rows, or a search that errored out, do
   * NOT increment the counter.
   *
   * Milestone 2: the in-memory side also records the
   * `(lesson_id, scope)` pair in the per-run set keyed by
   * `params.workflowRunId` so the terminal-event observer can
   * emit one outcome-after-lesson event per injected lesson.
   * `params.workflowRunId` is REQUIRED (no fallback) — the
   * per-run set cannot be populated for a run-less call
   * because the terminal-event observer has no run id to
   * look it up by.
   */
  async buildPromotedLearningContext(params: {
    workflowRunId: string;
    stateVariables?: Record<string, unknown>;
    query?: string;
    limit?: number;
    agentProfileName?: string;
    /**
     * When supplied, used directly — otherwise falls back to this
     * service's own run→workflowId→name lookup (pre-existing behavior).
     * See {@link resolveEffectiveWorkflowName} (FU-8).
     */
    workflowName?: string;
  }): Promise<string> {
    const scope = promotedLearningHelpers.resolveEntityScopeFromState(
      params.stateVariables,
      params.workflowRunId,
    );
    if (!scope) {
      return '';
    }
    try {
      const workflowName =
        await promotedLearningHelpers.resolveEffectiveWorkflowName(
          { runRepo: this.runRepo, workflowRepo: this.workflowRepo },
          params.workflowRunId,
          params.workflowName,
          (message) => {
            this.logger.warn(message);
          },
        );
      const lessons =
        await promotedLearningHelpers.resolvePromotedLessonsForInjection(
          {
            systemSettings: this.systemSettings,
            memoryRetrieval: this.memoryRetrieval,
            memoryManager: this.memoryManager,
          },
          scope,
          params.query?.trim() ?? '',
          params.limit,
          promotedLearningHelpers.buildRecallIdentity(
            params.agentProfileName,
            workflowName,
          ),
        );
      if (lessons.length === 0) {
        return '';
      }
      const { arm, holdoutActive } = await this.resolveHoldoutArmForScope(
        scope.entityId,
      );
      const suppressed = arm === 'holdout';
      for (const lesson of lessons) {
        if (typeof lesson.id !== 'string' || lesson.id.length === 0) {
          continue;
        }
        // In the holdout arm the lesson is computed but NOT injected, so the
        // "lesson injected" prom counter must NOT fire — only the in-memory
        // per-arm lift ring records the suppressed counterfactual.
        if (!suppressed) {
          this.metrics.recordLearningLessonInjected(lesson.id, scope.entityId);
        }
        const anchor = extractLessonAnchor(lesson.metadata_json);
        this.memoryMetrics.recordLearningLessonInjected(
          {
            lesson_id: lesson.id,
            scope: scope.entityId,
            ...(anchor.tool !== undefined
              ? { anchored_tool: anchor.tool }
              : {}),
            ...(anchor.path !== undefined
              ? { anchored_path: anchor.path }
              : {}),
            // Only stamp the arm when holdout measurement is active; with
            // fraction = 0 the record is byte-identical to the pre-Task-6
            // shape so the deterministic loop is unchanged.
            ...(holdoutActive ? { holdout_arm: arm } : {}),
          },
          { workflowRunId: params.workflowRunId },
        );
      }
      // Causal suppression: the holdout arm gets NO promoted-learning section
      // this run, so the lift measurement is a real counterfactual.
      return suppressed
        ? ''
        : promotedLearningHelpers.formatPromotedLearningSection(lessons);
    } catch (error) {
      this.logger.warn(
        `Failed to build promoted-learning context for ${scope.entityType}:${scope.entityId}: ${error}`,
      );
      return '';
    }
  }

  /**
   * Resolve the A/B holdout arm for a scope (EPIC-212 Phase 3, Task 6).
   * Reads `learning_holdout_fraction` (default 0 = OFF) and deterministically
   * buckets the scope. Fail-soft: a settings read error defaults to the
   * injected arm (no suppression). `holdoutActive` is `false` when the
   * fraction is 0 so the inject record stays byte-identical to pre-Task-6.
   */
  private async resolveHoldoutArmForScope(
    scopeId: string,
  ): Promise<{ arm: HoldoutArm; holdoutActive: boolean }> {
    let fraction: number;
    try {
      const raw = await this.systemSettings.get<unknown>(
        LEARNING_HOLDOUT_FRACTION_SETTING,
        LEARNING_HOLDOUT_FRACTION_DEFAULT,
      );
      fraction = coerceLearningHoldoutFraction(raw);
    } catch {
      fraction = LEARNING_HOLDOUT_FRACTION_DEFAULT;
    }
    return {
      arm: resolveHoldoutArm(scopeId, fraction),
      holdoutActive: fraction > 0,
    };
  }

  async assembleAgentSystemPrompt(ctx: PromptAssemblyContext): Promise<string> {
    const result = await this.systemPromptAssembly.assemble(ctx);
    if (result.skipped.length > 0) {
      this.logger.warn(
        `System prompt assembly skipped ${result.skipped.length} contributor(s): ` +
          result.skipped
            .map((s) => `${s.name}[${s.stage}]: ${s.reason}`)
            .join('; '),
      );
    }
    return result.prompt;
  }

  async waitForWorkflowRunCompletion(childRunId: string): Promise<{
    status: WorkflowStatus;
    stateVariables: Record<string, unknown>;
  }> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < this.STEP_MAX_RUNTIME_MS) {
      const childRun = await this.runRepo.findById(childRunId);

      if (!childRun) {
        throw new Error(
          `Invoked workflow run ${childRunId} was not found while waiting for completion`,
        );
      }
      if (childRun.status === WorkflowStatus.COMPLETED) {
        return {
          status: childRun.status,
          stateVariables: childRun.state_variables,
        };
      }

      if (
        childRun.status === WorkflowStatus.FAILED ||
        childRun.status === WorkflowStatus.CANCELLED
      ) {
        throw new Error(
          `Invoked workflow run ${childRunId} finished with status ${childRun.status}`,
        );
      }
      await sleep(this.WORKFLOW_INVOCATION_POLL_INTERVAL_MS);
    }

    throw new Error(
      `Invoked workflow run ${childRunId} exceeded timeout of ${this.STEP_MAX_RUNTIME_MS}ms`,
    );
  }

  async resolveWorktreePathFromTrigger(
    stateVariables: Record<string, unknown>,
  ): Promise<string | undefined> {
    return resolveWorktreePathFromTrigger(
      stateVariables,
      this.gitWorktreeService,
    );
  }

  extractStructuredOutput(response: string): Record<string, unknown> | null {
    return extractStructuredOutput(response);
  }

  resolveJobInputs(
    inputs: Record<string, unknown> | undefined,
    variables: Record<string, unknown>,
  ): Record<string, unknown> {
    return resolveTemplatedInputs(inputs, variables, (value) =>
      this.stateManager.substituteTemplate(value, variables),
    );
  }
  resolveAgentProfileFromJobInputs(
    resolvedJobInputs: Record<string, unknown>,
    job: IJob,
    stateVariables?: Record<string, unknown>,
  ): string | undefined {
    return resolveAgentProfileFromInputs({
      resolvedInputs: resolvedJobInputs,
      legacyAgentProfile: (job as unknown as { agent_profile?: unknown })
        .agent_profile,
      stateVariables,
    });
  }

  /**
   * Resolve the effective skill discovery mode for a job using the
   * most-specific-wins cascade: first-step → workflow → agent profile →
   * default (`native`). The agent profile is resolved from the job inputs so
   * the profile-level default can participate in the cascade.
   */
  async resolveSkillDiscoveryModeForJob(params: {
    job: IJob;
    resolvedJobInputs: Record<string, unknown>;
    stateVariables: Record<string, unknown>;
    workflowMode?: SkillDiscoveryMode | null;
  }): Promise<SkillDiscoveryMode> {
    const firstStep = 'steps' in params.job ? params.job.steps?.[0] : undefined;
    const profileName = this.resolveAgentProfileFromJobInputs(
      params.resolvedJobInputs,
      params.job,
      params.stateVariables,
    );
    const profile = profileName
      ? await this.aiConfig.getAgentProfileByName(profileName)
      : null;
    return resolveSkillDiscoveryMode({
      step: firstStep?.skill_discovery_mode ?? null,
      workflow: params.workflowMode ?? null,
      agentProfile: profile?.skill_discovery_mode ?? null,
    });
  }

  selectToolsForJob(tools: IToolRegistry[], job: IJob): IToolRegistry[] {
    return selectToolsForJobWithOutputContract(tools, job);
  }

  async buildUpstreamContextForJob(
    workflowRunId: string,
    job: IJob,
  ): Promise<string> {
    return buildUpstreamContextForJobHelper(
      workflowRunId,
      job.depends_on ?? [],
      job.id,
      this.runRepo,
      this.stateManager,
    );
  }

  getJobTier(job: IJob): ContainerTier {
    return job.tier === 'heavy' ? ContainerTier.HEAVY : ContainerTier.LIGHT;
  }
}

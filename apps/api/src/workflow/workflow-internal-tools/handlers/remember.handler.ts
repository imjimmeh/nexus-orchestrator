import { Injectable, Logger } from '@nestjs/common';
import type { InternalToolExecutionContext, RememberBody } from '@nexus/core';
import { RecordLearningService } from '../../../memory/learning/record-learning.service';
import { SystemSettingsService } from '../../../settings/system-settings.service';
import { RememberWriteGuardService } from './remember-write-guard.service';
import { WorkflowRunRepository } from '../../database/repositories/workflow-run.repository';
import { WorkflowRepository } from '../../database/repositories/workflow.repository';
import { resolveRememberScope } from './remember.helpers';

const AGENT_CAPTURE_SOURCE_QUALITY_CONFIDENCE = 0.9;
const MEMORY_CAPTURE_DEFAULT_CONFIDENCE_SETTING =
  'memory_capture_default_confidence';
const MEMORY_CAPTURE_DEFAULT_CONFIDENCE_FALLBACK = 0.6;
const REMEMBER_SOURCE_TOOL = 'remember';

/**
 * Extracted handler for the `remember` runtime capability
 * (refactoring work item: split `MemoryToolsHandler` per public
 * method). Behaviour is identical to the previous aggregate's
 * `remember` implementation — same budget / near-duplicate
 * enforcement via `RememberWriteGuardService`, same optional
 * confidence resolver (explicit param wins, else
 * `memory_capture_default_confidence` setting with a 0.6
 * fallback), same fallthrough to
 * `RecordLearningService.recordLearning` with
 * `candidateType: agent_capture` and `source.tool: remember`.
 * Same exact-fingerprint duplicate detection and
 * `last_seen_at` + `recurrence_count` reinforcement on the
 * duplicate branch, so the existing `MemoryToolsHandler.remember`
 * describe block continues to exercise the write path unchanged
 * until task 1.5 rewires the tool wrapper to target this handler.
 *
 * The constructor surface is intentionally narrow: only the
 * three services this write path actually touches
 * (`RememberWriteGuardService` for budget / near-dup pre-insert
 * guards, `SystemSettingsService` for the optional-confidence
 * resolver, and `RecordLearningService` for the actual insert)
 * are injected. All other dependencies the aggregate carries
 * stay on the aggregate, which keeps the wiring graph here
 * honest and the handler trivially mockable.
 *
 * `WorkflowRunRepository`/`WorkflowRepository` (Epic C) back
 * {@link resolveRememberScope}'s `scope: 'workflow'` resolution — see
 * `resolveWorkflowNameForRun` in `workflow-run-name-resolver.helpers.ts`.
 */
@Injectable()
export class RememberHandler {
  private readonly logger = new Logger(RememberHandler.name);

  constructor(
    private readonly recordLearningService: RecordLearningService,
    private readonly rememberWriteGuard: RememberWriteGuardService,
    private readonly settings: SystemSettingsService,
    private readonly runRepo: WorkflowRunRepository,
    private readonly workflowRepo: WorkflowRepository,
  ) {}

  async remember(
    context: InternalToolExecutionContext,
    params: RememberBody,
  ): Promise<Record<string, unknown>> {
    // Resolve the scope FIRST: the write guard's near-dup check must key its
    // pending-candidate bucket on this exact (scope_type, scope_id) pair —
    // the same pair the eventual insert uses — so agent-/workflow-/project-
    // scoped writes are never dedup-checked against each other's pools.
    const scopeResolution = await resolveRememberScope(
      this.runRepo,
      this.workflowRepo,
      context,
      params.scope,
      this.logger.warn.bind(this.logger),
    );
    if (!scopeResolution.ok) {
      return {
        created: false,
        reason: 'scope_unresolvable',
        scope: params.scope,
      };
    }

    const guardResult = await this.rememberWriteGuard.checkBudgetAndNearDup(
      context,
      {
        content: params.content,
        scopeType: params.scope,
        scopeId: scopeResolution.scopeId,
      },
    );

    if (guardResult.action !== 'proceed') {
      if (guardResult.action === 'reinforced') {
        const { candidateId: candidate_id } = guardResult;
        return { created: false, reason: 'near_duplicate', candidate_id };
      }
      return { created: false, reason: 'budget_exhausted' };
    }

    const confidence =
      params.confidence ??
      (await this.settings.get<number>(
        MEMORY_CAPTURE_DEFAULT_CONFIDENCE_SETTING,
        MEMORY_CAPTURE_DEFAULT_CONFIDENCE_FALLBACK,
      ));

    return this.recordLearningService.recordLearning(
      context,
      {
        scope_type: params.scope,
        scope_id: scopeResolution.scopeId,
        lesson: params.content,
        evidence: [],
        confidence,
        tags: params.tags,
      },
      {
        candidateType: 'agent_capture',
        sourceTool: REMEMBER_SOURCE_TOOL,
        sourceQualityConfidence: AGENT_CAPTURE_SOURCE_QUALITY_CONFIDENCE,
        humanApprovedAt: params.origin === 'user_request' ? new Date() : null,
        // workflow_run_id / job_id / captured_by (agentProfileName) are already
        // recorded under signals_json.provenance by buildProvenance — do not
        // duplicate them here.
        signalsJsonExtra: {
          memory_type: params.memory_type,
          origin: params.origin,
        },
      },
    );
  }
}

/**
 * Contract types for the retrospective analysis seam (EPIC-212 Phase-2).
 *
 * Declared here (not in `retrospective-analysis.port.ts`) so the exported
 * interface/type aliases satisfy the project's `*.types.ts` convention; the
 * companion port file owns the injection-token Symbol and re-exports these for
 * convenience.
 */
import type { ToolPolicyDocument } from '@nexus/core';
import type { RetrospectiveQueue } from './database/entities/retrospective-queue.entity';

/**
 * Terminal verdict the analyzer returns for a single claimed row. The values
 * map 1:1 onto the `retrospective_queue.status` lanes the drain persists:
 *   - `analyzed` — the analyst produced (or attempted) findings; row is done.
 *   - `failed`   — the analyst errored irrecoverably for this row; row is done.
 *   - `skipped`  — the analyzer chose not to spend on this row (e.g. already
 *                  known / no durable lesson); row is done, no cost incurred.
 */
export type RetrospectiveAnalysisStatus = 'analyzed' | 'failed' | 'skipped';

/**
 * Small result type returned by `RetrospectiveAnalysisPort.analyze`. The
 * optional `reason` is a short machine-readable tag persisted into the row's
 * `signals_json` for observability — never a domain-specific identifier.
 */
export interface RetrospectiveAnalysisOutcome {
  status: RetrospectiveAnalysisStatus;
  reason?: string;
}

/**
 * The abstraction the drain calls for one claimed row. Task 6 implements this
 * (digest → analyst → parse → dedup-against-known → route). It MUST be
 * fail-soft itself; the drain additionally guards every call so a throw cannot
 * abort the window.
 */
export interface RetrospectiveAnalysisPort {
  analyze(row: RetrospectiveQueue): Promise<RetrospectiveAnalysisOutcome>;
}

/**
 * Input to the completion-side `processFindings` step. The findings listener
 * extracts these from the analyst run's terminal event and hands them to the
 * orchestrator, which validates, verifies evidence, dedups against known
 * memory, and routes the survivors.
 *
 *   - `originalRunId` — the run UNDER analysis (the analyst run's
 *     `trigger.workflow_run_id`); the correlation key back to the queue row
 *     and the evidence-id universe.
 *   - `scopeId`       — the original run's scope (null when it carried none).
 *   - `rawFindings`   — the analyst's raw `set_job_output` `findings` array,
 *     unvalidated and untrusted.
 *   - `actingAgentProfileName` — the agent profile that actually executed the
 *     original run (ground truth, resolved during dispatch by
 *     `resolveActingAgentProfiles`), threaded back so the dedup check can
 *     optionally widen its recall to the `agent(<name>)` memory pool (FU-16,
 *     gated behind `RETROSPECTIVE_DEDUP_WIDEN_SCOPE_SETTING`).
 *   - `workflowName`  — the original run's workflow name (resolved during
 *     dispatch alongside the original workflow YAML), threaded back for the
 *     same FU-16 `workflow(<name>)` pool widening.
 */
export interface RetrospectiveProcessFindingsInput {
  originalRunId: string;
  scopeId: string | null;
  rawFindings: unknown;
  actingAgentProfileName?: string;
  workflowName?: string;
}

/**
 * FU-16: the acting agent-profile name / workflow name resolved during
 * dispatch, optionally widening `isAlreadyKnown`'s dedup memory pool beyond
 * project+global. Both fields are optional — the caller supplies whichever
 * it managed to resolve (fail-soft upstream in `analyze()`).
 */
export interface RetrospectiveDedupIdentity {
  agentProfileName?: string;
  workflowName?: string;
}

/**
 * The original run's CURRENT workflow YAML + name (FU-16 Task A2), whichever
 * resolved — see `resolveWorkflowDetailsForRun` /
 * `RetrospectiveAnalysisService.resolveOriginalWorkflowDetails`.
 */
export interface OriginalWorkflowDetails {
  yaml: string | undefined;
  name: string | undefined;
}

/**
 * A snapshot of one agent profile that actually executed (ground truth, not a
 * YAML request) somewhere in the run/chat session under analysis. Threaded
 * into the analyst's trigger context so `agent_profile_change` findings can
 * reference a real, current profile instead of a name guessed from the
 * digest (which carries no profile identifier) — see
 * `RetrospectiveAnalysisService.resolveActingAgentProfiles`, which sources
 * this from `chat_sessions` (subagent-spawning runs) with a fallback to
 * `executions` (every step-dispatched run, via the `agent_profile_name`
 * column populated at dispatch time).
 */
export interface ActingAgentProfileSummary {
  profileName: string;
  systemPrompt: string | null;
  modelName: string | null;
  providerName: string | null;
  thinkingLevel: string | null;
  toolPolicy: ToolPolicyDocument | null;
  assignedSkills: string[] | null;
}

import type { SkillDiscoveryMode } from '@nexus/core';
import { IToolPermissionPolicy, IJob, HarnessSessionRef } from '@nexus/core';

export interface AgentRetryResume {
  resumeSessionRef?: HarnessSessionRef;
  resumeSessionTreeId?: string;
}

export interface WorkflowAutoRetryJobMetadata {
  attempt: number;
  retryQueueJobId: string;
  resume?: AgentRetryResume;
}

export interface JobQueueData {
  workflowRunId: string;
  jobId: string;
  job: IJob;
  workflowPermissions?: IToolPermissionPolicy;
  workflowSkillDiscoveryMode?: SkillDiscoveryMode;
  /**
   * Workflow-level YAML-declared skill names (`IWorkflowDefinition.skills`,
   * Epic B Task 5), unioned into the step's effective skill set alongside
   * profile assignments and runtime bindings. See `resolveEffectiveSkills`.
   */
  workflowYamlSkills?: string[];
  /** Metadata used to validate delayed workflow auto-retry jobs before execution. */
  autoRetry?: WorkflowAutoRetryJobMetadata;
  /** When set, the consumer rehydrates this session tree before starting the container. */
  resumeSessionTreeId?: string;
  /**
   * Engine-agnostic resume reference. For Claude Code, a
   * `{ kind: 'claude_code', sessionId }` ref is plumbed into
   * `config.session.resume` so the engine passes it to the SDK. PI continues to
   * resume via `resumeSessionTreeId` file injection and ignores this field.
   */
  resumeSessionRef?: HarnessSessionRef;
  /** Follow-up message that replaces the systemPrompt when resuming a session. */
  userMessage?: string;
}

/** @deprecated Use JobQueueData instead */
export interface StepJobData {
  workflowRunId: string;
  stepId: string;
  step: unknown;
  workflowPermissions?: IToolPermissionPolicy;
  resumeSessionTreeId?: string;
  userMessage?: string;
}

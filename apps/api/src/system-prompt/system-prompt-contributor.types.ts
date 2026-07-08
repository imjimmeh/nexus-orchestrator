import type { HarnessId } from '@nexus/core';

/** Default additive/transform ordering priority. Higher = earlier. */
export const DEFAULT_CONTRIBUTOR_PRIORITY = 100;

/** Default per-contributor execution budget in milliseconds. */
export const DEFAULT_CONTRIBUTOR_TIMEOUT_MS = 3000;

/** A formatted block appended to the assembled system prompt. */
export interface PromptContributionBlock {
  title: string;
  /** Markdown-formatted content. */
  content: string;
  /** Higher = earlier. Inherited from the contributor when omitted. */
  priority: number;
  metadata?: Record<string, unknown>;
}

/**
 * Neutral, harness-/run-type-agnostic context handed to every contributor.
 * Carries ONLY neutral identifiers — no domain-specific fields.
 */
export interface PromptAssemblyContext {
  runType: 'workflow' | 'chat' | 'subagent';
  harnessId?: HarnessId;
  workflowRunId?: string;
  jobId?: string;
  stepId?: string;
  chatSessionId?: string;
  scopeId?: string;
  contextId?: string;
  contextType?: string;
  agentProfileId?: string;
  model?: string;
  /** Structured view of the engine-built layers (workflow path populates this). */
  baseLayers: ReadonlyArray<{ id: string; content: string }>;
}

/** A contributor that can append context and/or transform the assembled prompt. */
export interface ISystemPromptContributor {
  readonly name: string;
  /** Higher = earlier. Default DEFAULT_CONTRIBUTOR_PRIORITY. */
  readonly priority?: number;
  /** Per-contributor execution budget. Default DEFAULT_CONTRIBUTOR_TIMEOUT_MS. */
  readonly timeoutMs?: number;

  /** Additive stage. Return a block to append, or null to skip. */
  contribute(
    ctx: PromptAssemblyContext,
  ): Promise<PromptContributionBlock | null>;

  /**
   * Optional privileged override stage. Receives the assembled prompt and
   * returns a replacement, or null to pass through unchanged.
   */
  transform?(
    assembled: string,
    ctx: PromptAssemblyContext,
  ): Promise<string | null>;
}

/** Record of a contributor that failed or was skipped during assembly. */
export interface SkippedContributor {
  name: string;
  stage: 'contribute' | 'transform';
  reason: string;
}

/** Result of a full assembly pass. */
export interface SystemPromptAssemblyResult {
  prompt: string;
  blocks: PromptContributionBlock[];
  applied: string[];
  skipped: SkippedContributor[];
}

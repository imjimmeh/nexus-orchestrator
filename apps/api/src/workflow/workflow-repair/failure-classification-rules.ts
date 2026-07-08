import type {
  FailureClassificationDecision,
  FailureEvidenceReference,
  NormalizedFailureEvidence,
  RepairPolicyClass,
} from './failure-classification.types';

type ClassifierDecision = Omit<
  FailureClassificationDecision,
  'eligibility' | 'allowedRepairActionIds'
>;

interface RuleDecision {
  class: RepairPolicyClass;
  confidence: number;
  reason: string;
  safetyTags?: ClassifierDecision['safetyTags'];
}

const DESTRUCTIVE_OPERATION_PATTERN =
  /\b(git\s+reset\s+--hard|rm\s+-rf|docker\s+system\s+prune|kubectl\s+delete|terraform\s+destroy|drop\s+database|truncate\s+table|delete\s+from\b)/i;

export function classifyFailureEvidence(
  evidence: NormalizedFailureEvidence,
): ClassifierDecision {
  const searchableText = buildSearchableText(evidence);
  const ruleDecision = decideClass(searchableText, evidence);

  return {
    ...ruleDecision,
    evidenceReferences: buildEvidenceReferences(evidence),
  };
}

function decideClass(
  searchableText: string,
  evidence: NormalizedFailureEvidence,
): RuleDecision {
  if (DESTRUCTIVE_OPERATION_PATTERN.test(searchableText)) {
    return {
      class: 'ambiguous_failure',
      confidence: 0.9,
      reason:
        'Failure evidence references a destructive operation; automated repair is denied by policy.',
      safetyTags: ['destructive_operation'],
    };
  }

  if (
    /(api[_ -]?key|token|credential|secret|password).*(missing|required|not set|absent)|missing.*(api[_ -]?key|token|credential|secret|password)/i.test(
      searchableText,
    )
  ) {
    return {
      class: 'credential_missing',
      confidence: 0.95,
      reason: 'Failure evidence indicates missing credentials or secrets.',
    };
  }

  const coverageDecision = classifyCoverageValidationFailure(searchableText);
  if (coverageDecision) {
    return coverageDecision;
  }

  if (
    /(set_job_output.*requires.*data object)|output[_ -]?contract.*(not provided|exhausted|missing|invalid)|output_contract_exhausted|(schema|contract|expected|required field|invalid output|output).*(mismatch|missing|invalid)|tool.*(contract|schema|output)/i.test(
      searchableText,
    )
  ) {
    return {
      class: 'tool_contract_mismatch',
      confidence: 0.85,
      reason: 'Failure evidence indicates a tool/output contract mismatch.',
    };
  }

  // Checked before runtime_artifact_stale — see classifyRuntimeStallFailure.
  const runtimeStallDecision = classifyRuntimeStallFailure(searchableText);
  if (runtimeStallDecision) {
    return runtimeStallDecision;
  }

  const providerDecision = classifyProviderFailure(searchableText);
  if (providerDecision) {
    return providerDecision;
  }

  if (
    /(stale|missing).*(mount|artifact|host path|hostpath)|missinghostpaths|stalemanifestbindings|staleattachedbindings/i.test(
      JSON.stringify(evidence.runtimeDiagnostics),
    )
  ) {
    return {
      class: 'runtime_artifact_stale',
      confidence: 0.8,
      reason:
        'Runtime diagnostics indicate stale or missing runtime artifacts.',
    };
  }

  if (
    /(cannot find module|module not found|missing dependency|no module named|command not found|package .* not found|import .* failed|could not find a declaration file for module)/i.test(
      searchableText,
    )
  ) {
    return {
      class: 'dependency_missing',
      confidence: 0.82,
      reason:
        'Failure evidence indicates a missing dependency, module, or binary.',
    };
  }

  if (
    /(missing|required|not found).*(local )?(config|configuration|\.env|\.nexusrc|settings)/i.test(
      searchableText,
    ) ||
    /(author identity unknown|unable to auto-detect email address)/i.test(
      searchableText,
    )
  ) {
    return {
      class: 'config_missing_local',
      confidence: 0.75,
      reason:
        'Failure evidence indicates missing local non-secret configuration.',
    };
  }

  if (
    /(failed to push some refs|pre-?push)[\s\S]*(lint|eslint|test)|(eslint|npm run lint|npm run test)[\s\S]*(fail|error)|pre-push: running lint/i.test(
      searchableText,
    )
  ) {
    return {
      class: 'quality_gate_failed',
      confidence: 0.8,
      reason:
        'Failure evidence indicates a pre-push quality gate (lint/tests) rejected the push.',
    };
  }

  if (
    /(local changes to the following files would be overwritten)|(would be overwritten by merge)|(please commit your changes or stash them)/i.test(
      searchableText,
    )
  ) {
    return {
      class: 'merge_dirty_worktree',
      confidence: 0.9,
      reason:
        'Merge was blocked by uncommitted or untracked changes; the affected paths must be reconciled explicitly before the merge can proceed.',
    };
  }

  return {
    class: 'ambiguous_failure',
    confidence: 0.3,
    reason: 'Failure evidence does not match a known safe repair class.',
  };
}

// Checked before runtime_artifact_stale: the stale-run watchdog attaches and
// removes host mounts as it reaps, so a watchdog-reaped run carries host-mount
// runtime diagnostics that would otherwise spuriously match the stale-artifact
// rule and route to a no-op `refresh_stale_artifacts` repair. A lost step
// container and a stale-run stall are the same recoverable fault: the run was
// left with no live step job. Requeue is the correct recovery.
const RUNTIME_STALL_PATTERN =
  /no active or queued step job|stale-run watchdog|Execution container exited or was lost|container_lost|container health check timed out|health check timed out/i;

function classifyRuntimeStallFailure(
  searchableText: string,
): RuleDecision | null {
  if (!RUNTIME_STALL_PATTERN.test(searchableText)) {
    return null;
  }
  return {
    class: 'runtime_stall_recoverable',
    confidence: 0.8,
    reason:
      'Run was left with no live step job after a container loss, boot health-check timeout, or stale-run watchdog reap; the run is requeueable.',
  };
}

// Downstream coverage validation rejected the producer job's output.
// Re-running the producer with the violation as feedback resolves it.
// Two failure surfaces: (1) the tool's own coverage-logic BadRequest, and
// (2) a schema rejection (-32000 Invalid arguments) when the producer emitted
// a malformed/empty child_ac_assignments that the tool's input schema refuses.
const SPLIT_COVERAGE_INVALID_PATTERN =
  /coverage validation failed[\s\S]*?(?:duplicated across children|uncovered parent acceptance criteria|unknown acceptance criteria not on the parent)/i;

const SPLIT_COVERAGE_SCHEMA_REJECTION_PATTERN =
  /\(-32000\).*validate_split_coverage/i;

function classifyCoverageValidationFailure(
  searchableText: string,
): RuleDecision | null {
  const matched =
    SPLIT_COVERAGE_INVALID_PATTERN.test(searchableText) ||
    SPLIT_COVERAGE_SCHEMA_REJECTION_PATTERN.test(searchableText);
  if (!matched) {
    return null;
  }
  return {
    class: 'split_coverage_invalid',
    confidence: 0.85,
    reason:
      'A producer job emitted output that the downstream split-coverage validation rejected (coverage violation or malformed arguments); re-running the producer with the validation feedback can resolve it.',
  };
}

// Deterministic context-window overflow — the prompt is too large for the
// configured model. A blind requeue would loop, so this routes to human review
// (model swap or prompt summarisation), not auto-repair.
const CONTEXT_WINDOW_EXCEEDED_PATTERN =
  /context window (?:exceeds|exceeded|is too|too (?:large|long))|context[_ ]length[_ ]exceeded|maximum context length|exceeds (?:the )?(?:model'?s? )?(?:maximum )?context|prompt is too long|reduce the length of the (?:messages|prompt|input)/i;

// Transient provider / transport faults — provider 5xx, overload, rate limit,
// and dropped connections; recoverable by requeuing the run. Terminal provider
// failures (billing/usage/auth exhausted) are deliberately excluded so they are
// not requeued into a loop.
const TRANSIENT_PROVIDER_PATTERN =
  /\b(?:502|503|504|529)\b|gateway time-?out|service unavailable|internal server error|server (?:cluster )?(?:is )?(?:under|over)(?: a)? ?high load|under high load|overloaded(?:_error)?|socket hang ?up|connection (?:error|reset|refused|timed out)|\b(?:econnreset|etimedout|econnrefused|eai_again|enotfound|epipe)\b|network error|fetch failed|stream ended without|finish_reason:\s*abort|\b429\b|too many requests|rate[ _-]?limit/i;

// Checked context-window first so a 4xx context error is not mistaken for a
// retryable provider blip.
function classifyProviderFailure(searchableText: string): RuleDecision | null {
  if (CONTEXT_WINDOW_EXCEEDED_PATTERN.test(searchableText)) {
    return {
      class: 'context_window_exceeded',
      confidence: 0.9,
      reason:
        'Provider rejected the request because the prompt exceeds the model context window; retrying as-is will not help (resize the prompt or use a larger-context model).',
    };
  }

  if (TRANSIENT_PROVIDER_PATTERN.test(searchableText)) {
    return {
      class: 'provider_transient',
      confidence: 0.8,
      reason:
        'Failure evidence indicates a transient provider or transport fault (5xx / overload / rate limit / dropped connection); the run is requeueable.',
    };
  }

  return null;
}

function buildSearchableText(evidence: NormalizedFailureEvidence): string {
  return [
    evidence.errorCode,
    evidence.errorMessage,
    JSON.stringify(evidence.jobOutput ?? {}),
    evidence.events
      .map((event) => `${event.errorCode ?? ''} ${event.errorMessage ?? ''}`)
      .join(' '),
    evidence.transcriptReferences
      .map((reference) => reference.summary)
      .join(' '),
  ]
    .filter(Boolean)
    .join(' ');
}

function buildEvidenceReferences(
  evidence: NormalizedFailureEvidence,
): FailureEvidenceReference[] {
  const references: FailureEvidenceReference[] = evidence.events.map(
    (event) => ({
      kind: 'event_ledger',
      id: event.id,
      summary: buildEventReferenceSummary(evidence.workflowRunId, event),
    }),
  );

  if (evidence.jobOutput) {
    references.push({
      kind: 'job_output',
      id: evidence.jobId,
      summary: buildJobOutputReferenceSummary(evidence),
    });
  }

  references.push(...evidence.transcriptReferences);

  if (hasRuntimeDiagnosticSignal(evidence.runtimeDiagnostics)) {
    references.push({
      kind: 'runtime_diagnostic',
      summary: 'Runtime diagnostics contain failure signals.',
    });
  }

  return references;
}

function buildEventReferenceSummary(
  workflowRunId: string,
  event: NormalizedFailureEvidence['events'][number],
): string {
  return [
    `Event ledger failure signal: ${event.name}`,
    `workflowRunId=${workflowRunId}`,
    event.jobId ? `jobId=${event.jobId}` : undefined,
    event.stepId ? `stepId=${event.stepId}` : undefined,
    event.errorCode ? `errorCode=${event.errorCode}` : undefined,
  ]
    .filter(Boolean)
    .join(' ');
}

function buildJobOutputReferenceSummary(
  evidence: NormalizedFailureEvidence,
): string {
  const outputKeys = Object.keys(evidence.jobOutput ?? {}).join(',');
  return [
    `Job output captured for workflowRunId=${evidence.workflowRunId}`,
    evidence.jobId ? `jobId=${evidence.jobId}` : undefined,
    outputKeys ? `outputKeys=${outputKeys}` : undefined,
  ]
    .filter(Boolean)
    .join(' ');
}

function hasRuntimeDiagnosticSignal(value: unknown): boolean {
  return /missinghostpaths|stalemanifestbindings|staleattachedbindings|catalogloaderror|manifestloaderror/i.test(
    JSON.stringify(value),
  );
}

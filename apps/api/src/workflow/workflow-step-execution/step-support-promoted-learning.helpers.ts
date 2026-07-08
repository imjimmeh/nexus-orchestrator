import { asRecord, readStringField } from './step-support-context.helpers';
import type {
  PromotedLearningSegmentLike,
  ResolvedEntityScope,
  PromotedLearningInjectionDeps,
  PromotedLearningRecallIdentity,
} from './step-support-promoted-learning.types';
import {
  MEMORY_RETRIEVAL_MODE_SETTING,
  MEMORY_RETRIEVAL_MODE_DEFAULT,
} from '../../memory/signals/memory-retrieval.constants';
import type { IMemorySegment } from '@nexus/core';
import { resolveWorkflowNameForRun } from '../workflow-run-name-resolver.helpers';
import type { WorkflowRunRepository } from '../database/repositories/workflow-run.repository';
import type { WorkflowRepository } from '../database/repositories/workflow.repository';

const PROMOTED_LEARNING_SECTION_MAX_CHARS = 6000;

/** Token budget for the hybrid memory-recall pass feeding the promoted-learning section. */
export const PROMOTED_LEARNING_RETRIEVAL_TOKEN_BUDGET = 3000;

/** Default cap on legacy-fallback promoted-lesson lookups when no explicit limit is supplied. */
const DEFAULT_PROMOTED_LESSON_LIMIT = 25;
const AGENT_SCOPE_TYPE = 'agent';
const WORKFLOW_SCOPE_TYPE = 'workflow';

/**
 * Resolve the segments injected into the promoted-learning section.
 * Hybrid mode runs relevance-ranked vector recall over the scope's memories;
 * it falls back to the legacy recency-ordered promoted-lesson search when
 * hybrid is off, there is no query context, or retrieval yields nothing (e.g.
 * no embedding model is configured).
 */
export async function resolvePromotedLessonsForInjection(
  deps: PromotedLearningInjectionDeps,
  scope: ResolvedEntityScope,
  queryText: string,
  limit: number | undefined,
  identity: PromotedLearningRecallIdentity = {},
): Promise<IMemorySegment[]> {
  const mode = await deps.systemSettings.get<string>(
    MEMORY_RETRIEVAL_MODE_SETTING,
    MEMORY_RETRIEVAL_MODE_DEFAULT,
  );
  if (mode === 'hybrid' && queryText.length > 0 && scope.entityId.length > 0) {
    const retrieved = await deps.memoryRetrieval.retrieve({
      scopeId: scope.entityId,
      queryText,
      tokenBudget: PROMOTED_LEARNING_RETRIEVAL_TOKEN_BUDGET,
      ...(identity.agentProfileName
        ? { agentProfileName: identity.agentProfileName }
        : {}),
      ...(identity.workflowName ? { workflowName: identity.workflowName } : {}),
    });
    if (retrieved.length > 0) {
      return retrieved;
    }
  }
  const effectiveLimit = limit ?? DEFAULT_PROMOTED_LESSON_LIMIT;
  const fallbackScopes: Array<{ entity_type: string; entity_id: string }> = [
    { entity_type: scope.entityType, entity_id: scope.entityId },
    ...(identity.agentProfileName
      ? [
          {
            entity_type: AGENT_SCOPE_TYPE,
            entity_id: identity.agentProfileName,
          },
        ]
      : []),
    ...(identity.workflowName
      ? [{ entity_type: WORKFLOW_SCOPE_TYPE, entity_id: identity.workflowName }]
      : []),
  ];
  const perScope = await Promise.all(
    fallbackScopes.map((fallbackScope) =>
      deps.memoryManager.searchPromotedLessonsByScope({
        ...fallbackScope,
        ...(queryText.length > 0 ? { query: queryText } : {}),
        limit: effectiveLimit,
      }),
    ),
  );
  // No identity supplied: a single scope was queried, so there is nothing to
  // union — return its result untouched (preserves pre-Epic-C behavior,
  // including trusting the repository's own limit enforcement rather than
  // re-slicing client-side).
  if (perScope.length === 1) {
    return perScope[0];
  }
  return mergeLessonsByRecency(perScope, effectiveLimit);
}

/** Merge per-scope lesson lists newest-first, dedupe by id, cap at `limit`. */
function mergeLessonsByRecency(
  perScope: IMemorySegment[][],
  limit: number,
): IMemorySegment[] {
  const byId = new Map<string, IMemorySegment>();
  for (const lessonSegment of perScope.flat()) {
    if (!byId.has(lessonSegment.id)) {
      byId.set(lessonSegment.id, lessonSegment);
    }
  }
  return [...byId.values()]
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
    .slice(0, limit);
}

/**
 * Build the optional recall identity passed into
 * `resolvePromotedLessonsForInjection` from the caller-supplied agent
 * profile name and the run-resolved workflow name, omitting either field
 * when absent. Extracted as its own pure helper so
 * `StepSupportService.buildPromotedLearningContext` doesn't accumulate
 * extra branches for what is a simple object shape (Epic C).
 */
export function buildRecallIdentity(
  agentProfileName: string | undefined,
  workflowName: string | undefined,
): PromotedLearningRecallIdentity {
  return {
    ...(agentProfileName ? { agentProfileName } : {}),
    ...(workflowName ? { workflowName } : {}),
  };
}

/**
 * Resolves the workflowName threaded into the promoted-learning recall
 * identity: the caller-supplied value when present (FU-8 — the subagent
 * path's `SubagentPromptContextService` always supplies this, since it has
 * no run/workflow repositories of its own), otherwise a run→workflowId→name
 * lookup via the supplied repositories (the step path's pre-existing,
 * unchanged fallback). Extracted here (rather than left inline on
 * `StepSupportService.buildPromotedLearningContext`) so both call sites
 * share one implementation and the service method's cyclomatic complexity
 * stays within the project's lint cap.
 */
export async function resolveEffectiveWorkflowName(
  deps: {
    runRepo: Pick<WorkflowRunRepository, 'findById'>;
    workflowRepo: Pick<WorkflowRepository, 'findById'>;
  },
  workflowRunId: string,
  suppliedWorkflowName: string | undefined,
  onError: (message: string) => void,
): Promise<string | undefined> {
  if (suppliedWorkflowName) {
    return suppliedWorkflowName;
  }
  return resolveWorkflowNameForRun(
    deps.runRepo,
    deps.workflowRepo,
    workflowRunId,
    onError,
  );
}

export function resolveEntityScopeFromState(
  stateVariables: Record<string, unknown> | undefined,
  workflowRunId: string,
): ResolvedEntityScope | undefined {
  const trigger = asRecord(stateVariables?.trigger);
  const triggerContext = asRecord(trigger?.context);
  const contextType = readStringField(triggerContext, 'contextType');
  const scopeId = readStringField(triggerContext, 'scopeId');
  const explicitEntityType =
    readStringField(triggerContext, 'entityType') ??
    readStringField(triggerContext, 'entity_type');
  const explicitEntityId =
    readStringField(triggerContext, 'entityId') ??
    readStringField(triggerContext, 'entity_id');

  const entityType = explicitEntityType ?? contextType ?? 'workflow_run';
  const explicitId = explicitEntityId ?? scopeId;
  const entityId = explicitId ?? workflowRunId;

  if (!entityId) {
    return undefined;
  }

  return { entityType, entityId };
}

export function formatPromotedLearningSection(
  lessons: ReadonlyArray<PromotedLearningSegmentLike>,
): string {
  const header = [
    '## Prior promoted lessons',
    '',
    'The following lessons were promoted from prior workflows in this scope. Use them to inform your plan, but verify they still apply before acting on them.',
    '',
  ].join('\n');

  const renderLine = (
    ordinal: number,
    lesson: PromotedLearningSegmentLike,
  ): string => formatPromotedLearningLine(ordinal, lesson);

  const fullLines = lessons.map((lesson, index) =>
    renderLine(index + 1, lesson),
  );
  const fullText = `${header}${fullLines.join('\n')}`;
  if (fullText.length <= PROMOTED_LEARNING_SECTION_MAX_CHARS) {
    return fullText;
  }

  const truncatedFooter = `\n… (truncated, ${lessons.length} lessons omitted)\n`;
  const availableForBody =
    PROMOTED_LEARNING_SECTION_MAX_CHARS -
    header.length -
    truncatedFooter.length;

  let body = '';
  let includedCount = 0;
  for (const [index, lesson] of lessons.entries()) {
    const candidate = `${renderLine(index + 1, lesson)}\n`;
    if (body.length + candidate.length > availableForBody) {
      break;
    }
    body += candidate;
    includedCount += 1;
  }
  const omittedCount = Math.max(0, lessons.length - includedCount);
  return `${header}${body}… (truncated, ${omittedCount} more lessons omitted)\n`;
}

function formatPromotedLearningLine(
  ordinal: number,
  lesson: PromotedLearningSegmentLike,
): string {
  const metadata = asRecord(lesson.metadata_json) ?? {};
  const confidenceRaw = metadata.confidence;
  const confidence =
    typeof confidenceRaw === 'number' && Number.isFinite(confidenceRaw)
      ? confidenceRaw.toFixed(2)
      : null;
  const source = typeof metadata.source === 'string' ? metadata.source : null;
  const tags = Array.isArray(metadata.tags)
    ? metadata.tags.filter((tag): tag is string => typeof tag === 'string')
    : [];

  const metaParts: string[] = [];
  if (confidence !== null) {
    metaParts.push(`confidence: ${confidence}`);
  }
  if (source) {
    metaParts.push(`source: ${source}`);
  }
  const metaSuffix = metaParts.length > 0 ? `  (${metaParts.join(', ')})` : '';
  const tagSuffix = tags.length > 0 ? `  tags: ${tags.join(', ')}` : '';
  return `${ordinal}. ${lesson.content}${metaSuffix}${tagSuffix}`;
}

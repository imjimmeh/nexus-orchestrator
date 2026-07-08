import { DEFAULT_SKILL_DISCOVERY_MODE } from '@nexus/core';
import { renderSkillSection } from '../skill-catalog-prompt.helpers';
import {
  renderInjectedSkillContent,
  resolveSkillContentBudgetTokens,
} from '../skill-content-injection.helpers';
import {
  MEMORY_CAPTURE_GUIDANCE,
  MEMORY_RETRIEVAL_GUIDANCE,
} from '../workflow-step-execution/step-support-memory-capture.helpers';
import type { UniversalPromptContext } from './universal-prompt-context.types';

function buildRuntimeContextSection(ctx: {
  workflowRunId: string;
  jobId: string;
  stepId: string;
  scopeId?: string;
  contextId?: string;
  contextType?: string;
}): string {
  const lines = [
    'Workflow runtime context:',
    `- workflowRunId: ${ctx.workflowRunId}`,
    `- jobId: ${ctx.jobId}`,
    `- stepId: ${ctx.stepId}`,
  ];

  if (ctx.scopeId) {
    lines.push(`- scopeId: ${ctx.scopeId}`);
  }
  if (ctx.contextId) {
    lines.push(`- contextId: ${ctx.contextId}`);
  }
  if (ctx.contextType) {
    lines.push(`- contextType: ${ctx.contextType}`);
  }

  return lines.join('\n');
}

function buildSkillSection(ctx: UniversalPromptContext): string {
  const skillDiscoveryMode =
    ctx.skillDiscoveryMode ?? DEFAULT_SKILL_DISCOVERY_MODE;
  const isHarnessAgent =
    ctx.harnessId === 'pi' || ctx.harnessId === 'claude-code';

  if (skillDiscoveryMode === 'native') {
    return renderInjectedSkillContent({
      skills: (ctx.assignedSkills ?? []).map((s) => ({
        name: s.name,
        description: s.description,
        skillMarkdown: s.skillMarkdown,
      })),
      budgetTokens: resolveSkillContentBudgetTokens(),
    });
  }

  if (isHarnessAgent) {
    return '';
  }

  return renderSkillSection({
    mode: skillDiscoveryMode,
    assignedSkills: ctx.assignedSkills?.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
    })),
    availableCategories: ctx.availableCategories,
  });
}

/**
 * Returns the UNIVERSAL baseLayers (order: runtime → promoted-learning →
 * resolved → skill → memory-capture-guidance), each {id, content}.
 * Callers prepend their own context-specific layers before assembling.
 *
 * Empty-content layers are filtered out so callers receive only layers that
 * contribute visible content to the assembled system prompt.
 */
export async function buildUniversalPromptLayers(
  ctx: UniversalPromptContext,
): Promise<Array<{ id: string; content: string }>> {
  const promotedLearningContext =
    await ctx.support.buildPromotedLearningContext({
      workflowRunId: ctx.workflowRunId,
      stateVariables: ctx.scopeId
        ? {
            trigger: {
              context: {
                scopeId: ctx.scopeId,
                ...(ctx.contextId ? { contextId: ctx.contextId } : {}),
                ...(ctx.contextType ? { contextType: ctx.contextType } : {}),
                ...(ctx.entityType ? { entityType: ctx.entityType } : {}),
                ...(ctx.entityId ? { entityId: ctx.entityId } : {}),
              },
            },
          }
        : undefined,
      ...(ctx.taskPrompt ? { query: ctx.taskPrompt } : {}),
      ...(ctx.agentProfile ? { agentProfileName: ctx.agentProfile } : {}),
      ...(ctx.workflowName ? { workflowName: ctx.workflowName } : {}),
    });

  const runtimeContext = buildRuntimeContextSection(ctx);
  const skillSection = buildSkillSection(ctx);

  return [
    { id: 'runtime', content: runtimeContext },
    { id: 'promoted-learning', content: promotedLearningContext },
    { id: 'resolved', content: ctx.resolvedSystemPrompt },
    { id: 'skill', content: skillSection },
    ...(ctx.suppressMemoryCapture
      ? []
      : [
          { id: 'memory-capture-guidance', content: MEMORY_CAPTURE_GUIDANCE },
          {
            id: 'memory-retrieval-guidance',
            content: MEMORY_RETRIEVAL_GUIDANCE,
          },
        ]),
  ].filter((layer) => layer.content && layer.content.trim().length > 0);
}

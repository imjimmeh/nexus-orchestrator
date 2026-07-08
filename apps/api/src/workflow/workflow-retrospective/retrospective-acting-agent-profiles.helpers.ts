/**
 * Pure/collaborator-parameterized helpers for resolving the agent profile(s)
 * that ACTUALLY executed a run/chat session under retrospective analysis.
 *
 * The struggle digest handed to the analyst carries NO agent-profile
 * identifier, so without this the analyst has no real source for an
 * `agent_profile_change` finding's `profileName` and would have to guess —
 * risking a mutation targeting the wrong (or a non-existent) profile.
 *
 * TWO sources feed this, because `chat_sessions` rows only exist for a run
 * that spawned at least one subagent (each step's and each subagent's chat
 * session is stamped with the profile that really ran it, post
 * step/subagent-input override — ground truth, not the workflow YAML's
 * request):
 *
 *   1. `chat_sessions` (via `resolveChatSessionsForSource` /
 *      `dedupeProfileNames`) — covers subagent-spawning runs and named chat
 *      sessions.
 *   2. `executions` (via `dedupeExecutionProfileNames`) — the fallback for
 *      the common single-agent-per-step run, where no chat session is ever
 *      created. `StepAgentStepExecutorService` populates each step's
 *      `executions.agent_profile_name`/`agent_profile_id` once the profile is
 *      resolved (see `persistResolvedConfig` in
 *      `step-agent-step-executor.multistep.ts`), so this source is only
 *      populated going forward — executions predating that change stay null
 *      and simply yield no acting profile (fail-soft, not an error).
 *
 * `RetrospectiveAnalysisService.resolveActingAgentProfiles` is the fail-soft
 * caller: it fetches the chat sessions, falls back to executions when they
 * name no profile, delegates to `hydrateActingAgentProfileSummaries` here,
 * and swallows any thrown error.
 */
import type { AgentProfile } from '../../ai-config/database/entities/agent-profile.entity';
import type { ChatSession } from '../domain-ports';
import type { ActingAgentProfileSummary } from './retrospective-analysis.types';
import type { ChatSessionLookup } from './retrospective-acting-agent-profiles.helpers.types';

/**
 * Resolves the chat session(s) for an `analyze()` source: every step/subagent
 * session for a run-sourced row, or the single named session for a
 * chat-sourced row.
 */
export async function resolveChatSessionsForSource(
  source: { workflowRunId: string } | { chatSessionId: string },
  lookup: ChatSessionLookup,
): Promise<ChatSession[]> {
  if ('workflowRunId' in source) {
    return lookup.findByWorkflowRunId(source.workflowRunId);
  }
  const session = await lookup.findById(source.chatSessionId);
  return session ? [session] : [];
}

/** Distinct, non-empty acting profile names across a run's chat sessions. */
export function dedupeProfileNames(sessions: ChatSession[]): string[] {
  const names = sessions
    .map((session) => session.agent_profile_name)
    .filter((name): name is string => typeof name === 'string' && name !== '');
  return Array.from(new Set(names));
}

/**
 * Distinct, non-empty acting profile names across a run's `executions` rows —
 * the fallback source for single-agent-per-step runs, which never create a
 * `chat_sessions` row (see module doc).
 */
export function dedupeExecutionProfileNames(
  executions: { agent_profile_name?: string | null }[],
): string[] {
  const names = executions
    .map((execution) => execution.agent_profile_name)
    .filter((name): name is string => typeof name === 'string' && name !== '');
  return Array.from(new Set(names));
}

export function toActingAgentProfileSummary(
  profile: AgentProfile,
): ActingAgentProfileSummary {
  return {
    profileName: profile.name,
    systemPrompt: profile.system_prompt ?? null,
    modelName: profile.model_name ?? null,
    providerName: profile.provider_name ?? null,
    thinkingLevel: profile.thinking_level ?? null,
    toolPolicy: profile.tool_policy ?? null,
    assignedSkills: profile.assigned_skills ?? null,
  };
}

/**
 * Hydrates each of `profileNames` via `findProfileByName` and returns their
 * current-field summaries. Returns `undefined` (never an empty array) when no
 * profile could be resolved, so callers can omit the field entirely rather
 * than threading an empty array. Propagates any lookup error — the caller
 * applies the fail-soft wrapper. Source-agnostic: shared by both the
 * chat-session and executions acting-profile sources.
 */
export async function hydrateActingAgentProfileSummaries(
  profileNames: string[],
  findProfileByName: (name: string) => Promise<AgentProfile | null>,
): Promise<ActingAgentProfileSummary[] | undefined> {
  if (profileNames.length === 0) {
    return undefined;
  }

  const profiles = await Promise.all(
    profileNames.map((name) => findProfileByName(name)),
  );
  const summaries = profiles
    .filter((profile): profile is AgentProfile => profile !== null)
    .map(toActingAgentProfileSummary);
  return summaries.length > 0 ? summaries : undefined;
}

/**
 * FU-16 Task A2: the single acting agent-profile name (the first hydrated
 * summary, if any) threaded onto the analyst launch trigger so the
 * completion-side dedup check can later widen its recall to the
 * `agent(<name>)` memory pool. Extracted purely to keep
 * `RetrospectiveAnalysisService.analyze`'s cyclomatic complexity under the
 * project's per-function budget.
 */
export function resolveActingAgentProfileName(
  profiles: ActingAgentProfileSummary[] | undefined,
): string | undefined {
  return profiles?.[0]?.profileName;
}

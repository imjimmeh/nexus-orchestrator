import type { AgentProfileRepository } from '../../ai-config/database/repositories/agent-profile.repository';
import type { SystemSettingsService } from '../../settings/system-settings.service';
import type { MentionValidationContext } from './agent-communication-mesh.service.types';
import type { IAgentCommunicationDomainPort } from '../domain-ports';

interface ValidationDependencies {
  agentProfileRepository: AgentProfileRepository;
  agentCommunication: IAgentCommunicationDomainPort;
  systemSettings: SystemSettingsService;
}

export async function findMentionDenialReason(
  context: MentionValidationContext,
  dependencies: ValidationDependencies,
): Promise<string | null> {
  const validators: Array<() => string | null | Promise<string | null>> = [
    () =>
      validateTargetAgent(
        dependencies.agentProfileRepository,
        context.targetAgentProfile,
      ),
    () => validateMessageSize(dependencies.systemSettings, context.body),
    () => validateRunMentionRate(dependencies, context.workflowRunId),
    () =>
      validatePolicyMatrix(
        dependencies.systemSettings,
        context.requesterExecutionId,
        context.targetAgentProfile,
      ),
    () => validateThreadScope(dependencies.agentCommunication, context),
    () => validateThreadMessageLimit(dependencies, context.threadId),
  ];

  for (const validate of validators) {
    const denialReason = await validate();
    if (denialReason) {
      return denialReason;
    }
  }

  return null;
}

async function validateTargetAgent(
  agentProfileRepository: AgentProfileRepository,
  targetAgentProfile: string,
): Promise<string | null> {
  const profile =
    await agentProfileRepository.findByNameInsensitive(targetAgentProfile);
  return !profile || !profile.is_active
    ? 'target_agent_profile_not_active'
    : null;
}

async function validateMessageSize(
  systemSettings: SystemSettingsService,
  body: string,
): Promise<string | null> {
  const maxMessageChars = await systemSettings.get<number>(
    'agent_mesh_max_message_chars',
    4000,
  );
  return body.length > maxMessageChars ? 'message_too_large' : null;
}

async function validateRunMentionRate(
  dependencies: ValidationDependencies,
  workflowRunId: string,
): Promise<string | null> {
  const maxMentionsPerRun = await dependencies.systemSettings.get<number>(
    'agent_mesh_max_mentions_per_run',
    50,
  );
  const requestCountInRun =
    await dependencies.agentCommunication.countByRunAndKind(
      workflowRunId,
      'request',
    );
  return requestCountInRun >= maxMentionsPerRun
    ? 'mention_rate_limit_exceeded_for_run'
    : null;
}

async function validatePolicyMatrix(
  systemSettings: SystemSettingsService,
  requesterExecutionId: string | null,
  targetAgentProfile: string,
): Promise<string | null> {
  const policyMatrix = await systemSettings.get<Record<string, string[]>>(
    'agent_mesh_policy_matrix',
    {},
  );
  if (!requesterExecutionId) {
    return null;
  }

  const allowedTargets = policyMatrix[requesterExecutionId];
  const isRestricted =
    Array.isArray(allowedTargets) && allowedTargets.length > 0;
  const isAllowed =
    !isRestricted ||
    allowedTargets.some(
      (entry) =>
        entry.trim().toLowerCase() === targetAgentProfile.toLowerCase(),
    );
  return isAllowed ? null : 'target_agent_not_allowed_by_policy_matrix';
}

async function validateThreadScope(
  agentCommunication: IAgentCommunicationDomainPort,
  context: MentionValidationContext,
): Promise<string | null> {
  const existing = await agentCommunication.findByThreadId(context.threadId);
  if (!existing) {
    context.existingThread = null;
    return null;
  }

  context.existingThread = {
    workflow_run_id: existing.workflow_run_id,
    message_count: existing.message_count,
  };

  if (existing.workflow_run_id !== context.workflowRunId) {
    return 'thread_belongs_to_different_workflow_run';
  }

  return null;
}

async function validateThreadMessageLimit(
  dependencies: ValidationDependencies,
  threadId: string,
): Promise<string | null> {
  const maxMessagesPerThread = await dependencies.systemSettings.get<number>(
    'agent_mesh_max_messages_per_thread',
    100,
  );
  const existingMessageCount =
    await dependencies.agentCommunication.countByThreadId(threadId);
  return existingMessageCount + 2 > maxMessagesPerThread
    ? 'message_limit_exceeded_for_thread'
    : null;
}

import { BadRequestException } from '@nestjs/common';
import {
  AGENT_WAR_ROOM_MESSAGE_KIND_VALUES,
  type AgentWarRoomMessageKind,
} from './database/entities/agent-war-room-message.entity.types';
import {
  AGENT_WAR_ROOM_PARTICIPANT_ROLE_VALUES,
  AGENT_WAR_ROOM_PARTICIPATION_STATUS_VALUES,
  type AgentWarRoomParticipantRole,
  type AgentWarRoomParticipationStatus,
} from './database/entities/agent-war-room-participant.entity.types';
import {
  AGENT_WAR_ROOM_RESOLUTION_TYPE_VALUES,
  type AgentWarRoomConsensusState,
  type AgentWarRoomResolutionType,
} from './database/entities/agent-war-room-session.entity.types';
import {
  AGENT_WAR_ROOM_SIGNOFF_DECISION_VALUES,
  type AgentWarRoomSignoffDecision,
} from './database/entities/agent-war-room-signoff.entity.types';
import type {
  WarRoomLifecycleEvent,
  WarRoomParticipantInput,
} from './war-room.service.types';
import type { WarRoomServiceDependencies } from './war-room.service.dependencies';

export { resolveConsensusState } from './war-room.service.consensus';

export const DEFAULT_REQUIRED_ROLES: AgentWarRoomParticipantRole[] = [
  'architect',
  'dev',
  'qa',
];

const WAR_ROOM_AGENT_PROFILE_ALIAS_CANDIDATES: Record<
  string,
  readonly string[]
> = {
  architect: ['architect-agent'],
  architecture: ['architect-agent'],
  pm: ['product-manager'],
  product_manager: ['product-manager'],
  qa: ['qa_automation'],
  qa_agent: ['qa_automation'],
  dev: ['senior_dev', 'staff_engineer', 'junior_dev'],
  developer: ['senior_dev', 'staff_engineer', 'junior_dev'],
  ceo: ['ceo-agent'],
};

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`${field} is required`);
  }

  return value.trim();
}

export function optionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function requireRole(
  value: unknown,
  field: string,
): AgentWarRoomParticipantRole {
  if (
    typeof value !== 'string' ||
    !AGENT_WAR_ROOM_PARTICIPANT_ROLE_VALUES.includes(
      value as AgentWarRoomParticipantRole,
    )
  ) {
    throw new BadRequestException(
      `${field} must be one of: ${AGENT_WAR_ROOM_PARTICIPANT_ROLE_VALUES.join(', ')}`,
    );
  }

  return value as AgentWarRoomParticipantRole;
}

export function requireMessageKind(
  value: unknown,
  field: string,
): AgentWarRoomMessageKind {
  if (
    typeof value !== 'string' ||
    !AGENT_WAR_ROOM_MESSAGE_KIND_VALUES.includes(
      value as AgentWarRoomMessageKind,
    )
  ) {
    throw new BadRequestException(
      `${field} must be one of: ${AGENT_WAR_ROOM_MESSAGE_KIND_VALUES.join(', ')}`,
    );
  }

  return value as AgentWarRoomMessageKind;
}

export function requireSignoffDecision(
  value: unknown,
  field: string,
): AgentWarRoomSignoffDecision {
  if (
    typeof value !== 'string' ||
    !AGENT_WAR_ROOM_SIGNOFF_DECISION_VALUES.includes(
      value as AgentWarRoomSignoffDecision,
    )
  ) {
    throw new BadRequestException(
      `${field} must be one of: ${AGENT_WAR_ROOM_SIGNOFF_DECISION_VALUES.join(', ')}`,
    );
  }

  return value as AgentWarRoomSignoffDecision;
}

export function requireResolutionType(
  value: unknown,
): AgentWarRoomResolutionType {
  if (
    typeof value !== 'string' ||
    !AGENT_WAR_ROOM_RESOLUTION_TYPE_VALUES.includes(
      value as AgentWarRoomResolutionType,
    )
  ) {
    throw new BadRequestException(
      `resolution_type must be one of: ${AGENT_WAR_ROOM_RESOLUTION_TYPE_VALUES.join(', ')}`,
    );
  }

  return value as AgentWarRoomResolutionType;
}

export function validateSessionAccess(
  session: {
    workflow_run_id: string;
  } | null,
  workflowRunId: string,
): string | null {
  if (!session) {
    return 'session_not_found';
  }
  if (session.workflow_run_id !== workflowRunId) {
    return 'workflow_run_scope_mismatch';
  }
  return null;
}

export function validateMutatingSessionAccess(
  session: {
    workflow_run_id: string;
    status: string;
  } | null,
  workflowRunId: string,
): string | null {
  if (!session) {
    return 'session_not_found';
  }
  if (session.workflow_run_id !== workflowRunId) {
    return 'workflow_run_scope_mismatch';
  }
  if (session.status !== 'open') {
    return 'session_not_open';
  }

  return null;
}

export async function appendLifecycleEvents(
  dependencies: WarRoomServiceDependencies,
  workflowRunId: string,
  actorId: string | null,
  events: WarRoomLifecycleEvent[],
): Promise<void> {
  for (const event of events) {
    await dependencies.workflowEventLog.appendBestEffort({
      workflowRunId,
      eventType: event.event_type,
      actorId: actorId ?? undefined,
      payload: event.payload,
    });
  }
}

export async function ensureAgentProfilesActive(
  dependencies: WarRoomServiceDependencies,
  profiles: string[],
): Promise<void> {
  for (const profileName of dedupeStrings(profiles)) {
    await resolveActiveAgentProfileName(
      dependencies,
      profileName,
      'agent_profile',
    );
  }
}

export async function resolveActiveAgentProfileName(
  dependencies: WarRoomServiceDependencies,
  profileName: string,
  field: string,
): Promise<string> {
  const requiredProfileName = requireString(profileName, field);

  for (const candidate of buildAgentProfileLookupCandidates(
    requiredProfileName,
  )) {
    const profile =
      await dependencies.agentProfileRepository.findByNameInsensitive(
        candidate,
      );
    if (profile && profile.is_active) {
      return profile.name;
    }
  }

  throw new BadRequestException(
    `agent profile ${requiredProfileName} is not active`,
  );
}

export function normalizeParticipants(
  participants: WarRoomParticipantInput[],
  workflowRunId: string,
  moderatorProfile: string,
): Array<{
  workflow_run_id: string;
  agent_profile: string;
  role: AgentWarRoomParticipantRole;
  execution_id: string | null;
  participation_status: AgentWarRoomParticipationStatus;
  joined_at: Date | null;
  metadata: Record<string, unknown> | null;
}> {
  const byAgent = new Map<string, WarRoomParticipantInput>();
  for (const participant of participants) {
    const agentProfile = optionalString(participant.agent_profile);
    if (!agentProfile) {
      continue;
    }

    byAgent.set(agentProfile.toLowerCase(), {
      ...participant,
      agent_profile: agentProfile,
    });
  }

  if (!byAgent.has(moderatorProfile.toLowerCase())) {
    byAgent.set(moderatorProfile.toLowerCase(), {
      agent_profile: moderatorProfile,
      role: 'moderator',
    });
  }

  return [...byAgent.values()].map((participant) => {
    const role = requireRole(participant.role, 'participants[].role');
    const participationStatus =
      participant.participation_status &&
      AGENT_WAR_ROOM_PARTICIPATION_STATUS_VALUES.includes(
        participant.participation_status,
      )
        ? participant.participation_status
        : 'invited';
    return {
      workflow_run_id: workflowRunId,
      agent_profile: requireString(
        participant.agent_profile,
        'participants[].agent_profile',
      ),
      role,
      execution_id: optionalString(participant.execution_id) ?? null,
      participation_status: participationStatus,
      joined_at: participationStatus === 'active' ? new Date() : null,
      metadata: participant.metadata ?? null,
    };
  });
}

export async function resolveRequiredSignoffRoles(
  dependencies: WarRoomServiceDependencies,
): Promise<AgentWarRoomParticipantRole[]> {
  const configuredRoles = await dependencies.systemSettings.get<string[]>(
    'agent_war_room_required_signoff_roles',
    DEFAULT_REQUIRED_ROLES,
  );
  const roles = dedupeStrings(configuredRoles)
    .map((value) => value.toLowerCase())
    .filter((value): value is AgentWarRoomParticipantRole =>
      AGENT_WAR_ROOM_PARTICIPANT_ROLE_VALUES.includes(
        value as AgentWarRoomParticipantRole,
      ),
    );

  return roles.length > 0 ? roles : DEFAULT_REQUIRED_ROLES;
}

export async function resolveDeadlockThreshold(
  dependencies: WarRoomServiceDependencies,
  requiredRoleCount: number,
): Promise<number> {
  const configuredThreshold = await dependencies.systemSettings.get<number>(
    'agent_war_room_deadlock_signoff_threshold',
    requiredRoleCount,
  );
  if (!Number.isInteger(configuredThreshold)) {
    return requiredRoleCount;
  }

  return Math.max(1, Math.min(configuredThreshold, requiredRoleCount));
}

export function resolveResolutionTypeForConsensus(
  consensusState: AgentWarRoomConsensusState,
): AgentWarRoomResolutionType | null {
  if (consensusState === 'consensus_reached') {
    return 'consensus';
  }
  if (consensusState === 'deadlocked') {
    return 'deadlock';
  }
  if (consensusState === 'ceo_tie_break_applied') {
    return 'ceo_tie_break';
  }
  return null;
}

export function normalizeExpectedVersion(
  expectedVersion: unknown,
  fallback: number,
): number {
  if (expectedVersion === undefined || expectedVersion === null) {
    return fallback;
  }
  if (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 0) {
    throw new BadRequestException(
      'expected_version must be a non-negative integer when provided',
    );
  }
  return Number(expectedVersion);
}

function dedupeStrings(values: string[]): string[] {
  const deduped = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }
    const normalized = value.trim();
    if (normalized.length === 0) {
      continue;
    }
    deduped.add(normalized);
  }

  return [...deduped.values()];
}

function normalizeAgentProfileAlias(value: string): string {
  return value.toLowerCase().replaceAll('-', '_');
}

function buildAgentProfileLookupCandidates(profileName: string): string[] {
  const deduped = new Set<string>([profileName]);
  const aliasCandidates =
    WAR_ROOM_AGENT_PROFILE_ALIAS_CANDIDATES[
      normalizeAgentProfileAlias(profileName)
    ];

  if (aliasCandidates) {
    for (const aliasCandidate of aliasCandidates) {
      deduped.add(aliasCandidate);
    }
  }

  return [...deduped.values()];
}

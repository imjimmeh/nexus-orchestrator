import type { AgentWarRoomConsensusState } from './database/entities/agent-war-room-session.entity.types';
import type { AgentWarRoomParticipantRole } from './database/entities/agent-war-room-participant.entity.types';
import type { AgentWarRoomSignoffDecision } from './database/entities/agent-war-room-signoff.entity.types';

export function resolveConsensusState(
  currentState: AgentWarRoomConsensusState,
  requiredRoles: AgentWarRoomParticipantRole[],
  signoffs: Array<{
    role: AgentWarRoomParticipantRole;
    decision: AgentWarRoomSignoffDecision;
    updated_at: Date;
  }>,
  deadlockThreshold: number,
): AgentWarRoomConsensusState {
  if (requiredRoles.length === 0) {
    return currentState;
  }

  const latestByRole = collectLatestSignoffsByRole(signoffs);
  if (areAllRequiredRolesApproved(requiredRoles, latestByRole)) {
    return 'consensus_reached';
  }
  if (hasRequiredRoleDecision(requiredRoles, latestByRole, 'blocked')) {
    return 'deadlocked';
  }

  const submittedCount = countSubmittedRoles(requiredRoles, latestByRole);
  if (
    submittedCount >= deadlockThreshold &&
    hasRequiredRoleDecision(requiredRoles, latestByRole, 'approved') &&
    hasRequiredRoleDecision(requiredRoles, latestByRole, 'changes_requested')
  ) {
    return 'deadlocked';
  }
  if (submittedCount > 0) {
    return 'partial_signoff';
  }

  return currentState === 'collecting_input' ? 'draft_ready' : currentState;
}

function collectLatestSignoffsByRole(
  signoffs: Array<{
    role: AgentWarRoomParticipantRole;
    decision: AgentWarRoomSignoffDecision;
    updated_at: Date;
  }>,
): Map<
  AgentWarRoomParticipantRole,
  { decision: AgentWarRoomSignoffDecision; updated_at: Date }
> {
  const latestByRole = new Map<
    AgentWarRoomParticipantRole,
    { decision: AgentWarRoomSignoffDecision; updated_at: Date }
  >();
  for (const signoff of signoffs) {
    const existing = latestByRole.get(signoff.role);
    if (
      !existing ||
      signoff.updated_at.getTime() >= existing.updated_at.getTime()
    ) {
      latestByRole.set(signoff.role, {
        decision: signoff.decision,
        updated_at: signoff.updated_at,
      });
    }
  }

  return latestByRole;
}

function countSubmittedRoles(
  requiredRoles: AgentWarRoomParticipantRole[],
  latestByRole: Map<
    AgentWarRoomParticipantRole,
    { decision: AgentWarRoomSignoffDecision; updated_at: Date }
  >,
): number {
  return requiredRoles.filter((role) => latestByRole.has(role)).length;
}

function areAllRequiredRolesApproved(
  requiredRoles: AgentWarRoomParticipantRole[],
  latestByRole: Map<
    AgentWarRoomParticipantRole,
    { decision: AgentWarRoomSignoffDecision; updated_at: Date }
  >,
): boolean {
  return requiredRoles.every(
    (role) => latestByRole.get(role)?.decision === 'approved',
  );
}

function hasRequiredRoleDecision(
  requiredRoles: AgentWarRoomParticipantRole[],
  latestByRole: Map<
    AgentWarRoomParticipantRole,
    { decision: AgentWarRoomSignoffDecision; updated_at: Date }
  >,
  expectedDecision: AgentWarRoomSignoffDecision,
): boolean {
  return requiredRoles.some(
    (role) => latestByRole.get(role)?.decision === expectedDecision,
  );
}

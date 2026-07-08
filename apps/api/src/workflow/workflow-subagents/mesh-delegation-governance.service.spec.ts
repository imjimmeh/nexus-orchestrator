import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IAMPolicyService } from '../../security/iam-policy.service';
import type { SystemSettingsService } from '../../settings/system-settings.service';
import { MeshDelegationGovernanceService } from './mesh-delegation-governance.service';

describe('MeshDelegationGovernanceService', () => {
  let service: MeshDelegationGovernanceService;

  const evaluateAccessMock = vi.fn();
  const systemSettingsGetMock = vi.fn();

  const iamPolicy = {
    evaluateAccess: evaluateAccessMock,
  } as unknown as IAMPolicyService;

  const systemSettings = {
    get: systemSettingsGetMock,
  } as unknown as SystemSettingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    evaluateAccessMock.mockReturnValue(true);
    systemSettingsGetMock.mockImplementation(
      async (_key: string, fallback: unknown) => fallback,
    );

    service = new MeshDelegationGovernanceService(iamPolicy, systemSettings);
  });

  it('denies when requested tool list is empty', async () => {
    const decision = await service.evaluate({
      targetAgentProfile: 'architect-agent',
      requestedTools: [],
    });

    expect(decision.allowed).toBe(false);
    expect(decision.denialReason).toBe('requested_tools_missing');
  });

  it('denies unauthorized tools for target profile', async () => {
    evaluateAccessMock.mockImplementation(
      (profileName: string, toolName: string) =>
        profileName === 'architect-agent' && toolName !== 'bash',
    );

    const decision = await service.evaluate({
      targetAgentProfile: 'architect-agent',
      requestedTools: ['read', 'bash'],
    });

    expect(decision.allowed).toBe(false);
    expect(decision.denialReason).toBe(
      'target_profile_not_authorized_for_requested_tools',
    );
  });

  it('requires explicit privileged approval for privileged tools', async () => {
    systemSettingsGetMock.mockImplementation(async (key: string) => {
      if (key === 'agent_mesh_privileged_tools') {
        return ['bash'];
      }

      return null;
    });

    const decision = await service.evaluate({
      targetAgentProfile: 'architect-agent',
      requestedTools: ['bash'],
      allowPrivilegedTools: false,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.denialReason).toBe(
      'privileged_tools_require_explicit_approval',
    );
  });

  it('denies token budgets beyond configured maximum', async () => {
    systemSettingsGetMock.mockImplementation(async (key: string) => {
      if (key === 'agent_mesh_max_token_budget') {
        return 1000;
      }

      if (key === 'agent_mesh_max_time_budget_ms') {
        return 10_000;
      }

      if (key === 'agent_mesh_privileged_tools') {
        return [];
      }

      return null;
    });

    const decision = await service.evaluate({
      targetAgentProfile: 'architect-agent',
      requestedTools: ['read'],
      tokenBudget: 1001,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.denialReason).toBe('token_budget_out_of_range');
  });

  it('allows valid requests and reports effective tools', async () => {
    systemSettingsGetMock.mockImplementation(async (key: string) => {
      if (key === 'agent_mesh_privileged_tools') {
        return ['bash'];
      }

      if (key === 'agent_mesh_max_token_budget') {
        return 10_000;
      }

      if (key === 'agent_mesh_max_time_budget_ms') {
        return 60_000;
      }

      return null;
    });

    const decision = await service.evaluate({
      targetAgentProfile: 'architect-agent',
      requestedTools: [' read ', 'bash', 'read'],
      allowPrivilegedTools: true,
      tokenBudget: 2_000,
      timeBudgetMs: 45_000,
      maxRetries: 2,
      queuePriority: 200,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.effectiveTools).toEqual(['read', 'bash']);
    expect(decision.privilegedTools).toEqual(['bash']);
  });
});

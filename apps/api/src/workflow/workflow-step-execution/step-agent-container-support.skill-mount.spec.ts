import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('node:fs', () => ({}));

// requireJwtSecret reads process.env at module-import time
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-jwt-32chars';

import { StepAgentContainerSupportService } from './step-agent-container-support.service';
import type { SkillLibraryRecord } from '../../ai-config/services/agent-skill-library.service.types';

type PrivateResolveSkillMountForJob = {
  resolveSkillMountForJob: (params: {
    agentProfile?: string;
    stateVariables: Record<string, unknown>;
    mountKey: string;
    workflowRunId: string;
    preResolvedAssignedSkills?: SkillLibraryRecord[];
  }) => Promise<{
    assignedSkills: SkillLibraryRecord[];
    skillMountPath: string | null;
  }>;
};

function buildSkill(name: string): SkillLibraryRecord {
  return {
    id: name,
    name,
    description: `${name} description`,
    skillMarkdown: `# ${name}`,
    compatibility: null,
    category: null,
    tags: [],
    metadata: null,
    scope: null,
    isActive: true,
    version: 1,
    source: 'admin',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    rootPath: `/skills/${name}`,
  };
}

function makeService(
  overrides: {
    resolveAssignedSkillsForProfile?: ReturnType<typeof vi.fn>;
    prepareSkillMount?: ReturnType<typeof vi.fn>;
  } = {},
): {
  service: StepAgentContainerSupportService;
  support: { resolveAssignedSkillsForProfile: ReturnType<typeof vi.fn> };
  skillMounting: { prepareSkillMount: ReturnType<typeof vi.fn> };
} {
  const support = {
    resolveAssignedSkillsForProfile:
      overrides.resolveAssignedSkillsForProfile ??
      vi.fn().mockResolvedValue({ skills: [buildSkill('profile-skill')] }),
  };
  const skillMounting = {
    prepareSkillMount:
      overrides.prepareSkillMount ?? vi.fn().mockReturnValue('/mount/path'),
  };
  const harnessRegistry = {
    resolve: vi.fn().mockReturnValue({ capabilities: {} }),
  };

  const service = new (StepAgentContainerSupportService as never)(
    ...([
      /* containerOrchestrator */ {},
      /* toolMounting */ {},
      /* skillMounting */ skillMounting,
      /* toolRegistry */ {},
      /* aiConfig */ {},
      /* eventPublisher */ {},
      /* support */ support,
      /* hostMountResolution */ {},
      /* hostMountAudit */ {},
      /* harnessRegistry */ harnessRegistry,
      /* docker */ {},
      /* toolchainResolver */ {},
      /* harnessImageResolver */ {},
      /* packageCacheVolumeService */ {},
    ] as Parameters<typeof StepAgentContainerSupportService>),
  ) as StepAgentContainerSupportService;

  return { service, support, skillMounting };
}

describe('StepAgentContainerSupportService — skill mount resolution (FU-7)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('mounts a pre-resolved bound (non-profile) skill without re-querying profile-only resolution', async () => {
    const boundSkill = buildSkill('step-bound-skill');
    const { service, support, skillMounting } = makeService();

    const result = await (
      service as unknown as PrivateResolveSkillMountForJob
    ).resolveSkillMountForJob({
      agentProfile: 'software-architect',
      stateVariables: {},
      mountKey: 'mount-key-1',
      workflowRunId: 'run-1',
      preResolvedAssignedSkills: [buildSkill('profile-skill'), boundSkill],
    });

    // The bound skill (not on the profile) must reach the on-disk mount call —
    // SkillMountingService.prepareSkillMount is what writes each skill's
    // SKILL.md to disk (see skill-mounting.service.spec.ts for that layer).
    expect(skillMounting.prepareSkillMount).toHaveBeenCalledWith(
      'mount-key-1',
      expect.arrayContaining([
        expect.objectContaining({ name: 'step-bound-skill' }),
      ]),
    );
    expect(result.assignedSkills.map((skill) => skill.name)).toContain(
      'step-bound-skill',
    );

    // The caller (step executor) already resolved the full effective set via
    // the shared resolver — asserting this was NOT called proves the mount
    // path doesn't perform a second, redundant profile-only skill-library scan.
    expect(support.resolveAssignedSkillsForProfile).not.toHaveBeenCalled();
  });

  it('falls back to profile-only resolution when no pre-resolved skill set is supplied', async () => {
    const { service, support, skillMounting } = makeService();

    await (
      service as unknown as PrivateResolveSkillMountForJob
    ).resolveSkillMountForJob({
      agentProfile: 'software-architect',
      stateVariables: {},
      mountKey: 'mount-key-2',
      workflowRunId: 'run-2',
    });

    expect(support.resolveAssignedSkillsForProfile).toHaveBeenCalledWith(
      'software-architect',
      { stateVariables: {}, workflowRunId: 'run-2' },
    );
    expect(skillMounting.prepareSkillMount).toHaveBeenCalledWith(
      'mount-key-2',
      expect.arrayContaining([
        expect.objectContaining({ name: 'profile-skill' }),
      ]),
    );
  });
});

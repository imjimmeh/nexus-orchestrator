import { describe, it, expect, vi, afterEach } from 'vitest';

const { cleanupSkillMountMock, cleanupToolMountMock } = vi.hoisted(() => ({
  cleanupSkillMountMock: vi.fn(),
  cleanupToolMountMock: vi.fn(),
}));

vi.mock('node:fs', () => ({}));

// requireJwtSecret reads process.env at module-import time
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-jwt-32chars';

import { StepAgentContainerSupportService } from './step-agent-container-support.service';

function makeService(): {
  service: StepAgentContainerSupportService;
  containerOrchestrator: {
    provisionContainer: ReturnType<typeof vi.fn>;
    killContainer: ReturnType<typeof vi.fn>;
    removeContainer: ReturnType<typeof vi.fn>;
    getContainerHostMountBindings: ReturnType<typeof vi.fn>;
  };
} {
  const containerOrchestrator = {
    provisionContainer: vi.fn().mockResolvedValue('container-id-123'),
    killContainer: vi.fn().mockResolvedValue(undefined),
    removeContainer: vi.fn().mockResolvedValue(undefined),
    getContainerHostMountBindings: vi.fn().mockResolvedValue([]),
  };

  const skillMounting = {
    prepareSkillMount: vi.fn(),
    cleanupSkillMount: cleanupSkillMountMock,
  };

  const toolMounting = {
    cleanupToolMount: cleanupToolMountMock,
  };

  const eventPublisher = {
    publishProcessEvent: vi.fn().mockResolvedValue(undefined),
  };

  const harnessRegistry = {
    resolve: vi.fn().mockReturnValue({ capabilities: {} }),
  };

  const service = new (StepAgentContainerSupportService as never)(
    ...([
      containerOrchestrator,
      /* toolMounting */ toolMounting,
      /* skillMounting */ skillMounting,
      /* toolRegistry */ {},
      /* aiConfig */ {},
      /* eventPublisher */ eventPublisher,
      /* support */ {},
      /* hostMountResolution */ {},
      /* hostMountAudit */ {},
      /* harnessRegistry */ harnessRegistry,
      /* docker */ {},
      /* toolchainResolver */ {},
      /* harnessImageResolver */ {},
      /* packageCacheVolumeService */ {},
    ] as Parameters<typeof StepAgentContainerSupportService>),
  ) as StepAgentContainerSupportService;

  return { service, containerOrchestrator };
}

describe('StepAgentContainerSupportService — job resource cleanup', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls cleanupSkillMount and cleanupToolMount during cleanupJobResources', async () => {
    const { service } = makeService();

    await service.cleanupJobResources({
      workflowRunId: 'run-3',
      jobId: 'job-3',
      stepId: 'step-3',
      containerId: null,
      stopContainerLogStreaming: null,
      toolMountKey: 'mount-key-3',
      skillMountKey: 'mount-key-3',
    });

    expect(cleanupToolMountMock).toHaveBeenCalledWith('mount-key-3');
    expect(cleanupSkillMountMock).toHaveBeenCalledWith('mount-key-3');
  });
});

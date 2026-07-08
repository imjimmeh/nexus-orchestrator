/**
 * Unit tests asserting that the SESSION_CHECKPOINT_RESUME_ENABLED flag
 * correctly gates the checkpoint volume mount inside
 * StepAgentContainerSupportService.provisionContainer.
 *
 * We call the private `provisionContainer` method directly so we can
 * isolate just the flag-gating logic without wiring every NestJS provider.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ContainerTier } from '@nexus/core';

// Use vi.hoisted so the mock factories can safely reference these variables
// after vi.mock hoisting moves the vi.mock() calls to the top of the file.
const { mkdirSyncMock, buildAgentContainerConfigMock } = vi.hoisted(() => ({
  mkdirSyncMock: vi.fn(),
  buildAgentContainerConfigMock: vi.fn().mockReturnValue({}),
}));

vi.mock('node:fs', () => ({
  mkdirSync: mkdirSyncMock,
}));

vi.mock('./step-agent-container-config.helpers', () => ({
  buildAgentContainerConfig: buildAgentContainerConfigMock,
}));

// requireJwtSecret reads process.env at module-import time, so set the secret
// before the service is imported.
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-jwt-32chars';

// Import AFTER mocks are registered.
import { StepAgentContainerSupportService } from './step-agent-container-support.service';

type PrivateProvisionContainer = {
  provisionContainer: (params: {
    workflowRunId: string;
    jobId: string;
    stepId: string;
    tier: ContainerTier;
    hostMountPath: string;
    hostMountBindings: [];
    harnessId: 'claude-code';
    agentProfileName?: string;
    agentProfileConfig?: {
      toolchains: Array<{ tool: string; version: string }>;
    };
    scopeId?: string;
    skillMountPath?: string | null;
    worktreePath?: string;
    harnessImageRef?: string;
    harnessDefaultEnv?: Record<string, string>;
    stepInputs: Record<string, unknown>;
    runInputConfig?: { toolchains: Array<{ tool: string; version: string }> };
  }) => Promise<string>;
};

type ToolchainMockOverrides = {
  toolchainResolve?: ReturnType<typeof vi.fn>;
  resolveImageRef?: ReturnType<typeof vi.fn>;
  resolveCacheMounts?: ReturnType<typeof vi.fn>;
};

function makeService(overrides: ToolchainMockOverrides = {}): {
  service: StepAgentContainerSupportService;
  containerOrchestrator: { provisionContainer: ReturnType<typeof vi.fn> };
} {
  const containerOrchestrator = {
    provisionContainer: vi.fn().mockResolvedValue('container-id-123'),
  };

  const harnessRegistry = {
    resolve: vi.fn().mockReturnValue({ capabilities: {} }),
  };

  // Node-only fast path: resolver returns the base default (no toolchains),
  // image resolver echoes the base image ref unchanged, cache service adds
  // nothing — mirrors the real node-only behavior these tests pin down.
  // Tests exercising the non-node-only path override these via `overrides`.
  const toolchainResolver = {
    resolve:
      overrides.toolchainResolve ??
      vi.fn().mockResolvedValue({ toolchains: [] }),
  };
  const harnessImageResolver = {
    resolveImageRef:
      overrides.resolveImageRef ??
      vi
        .fn()
        .mockImplementation(
          async (params: { baseImageRef: string }) => params.baseImageRef,
        ),
  };
  const packageCacheVolumeService = {
    resolveCacheMounts:
      overrides.resolveCacheMounts ??
      vi.fn().mockResolvedValue({ volumes: [], env: {} }),
  };

  // Construct with enough stubs to satisfy the constructor; we only exercise
  // provisionContainer so the other deps are inert mocks.
  const service = new (StepAgentContainerSupportService as never)(
    ...([
      containerOrchestrator,
      /* toolMounting */ {},
      /* skillMounting */ {},
      /* toolRegistry */ {},
      /* aiConfig */ {},
      /* eventPublisher */ {},
      /* support */ {},
      /* hostMountResolution */ {},
      /* hostMountAudit */ {},
      /* harnessRegistry */ harnessRegistry,
      /* docker */ {},
      /* toolchainResolver */ toolchainResolver,
      /* harnessImageResolver */ harnessImageResolver,
      /* packageCacheVolumeService */ packageCacheVolumeService,
    ] as Parameters<typeof StepAgentContainerSupportService>),
  ) as StepAgentContainerSupportService;

  return { service, containerOrchestrator };
}

const BASE_PARAMS = {
  workflowRunId: 'run-flag-test',
  jobId: 'job-flag-test',
  stepId: 'step-flag-test',
  tier: ContainerTier.LIGHT,
  hostMountPath: '/tmp/mounts',
  hostMountBindings: [] as [],
  harnessId: 'claude-code' as const,
  stepInputs: {},
};

describe('StepAgentContainerSupportService — checkpoint feature-flag gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXUS_CHECKPOINT_BASE_DIR', '/tmp/nexus-ck-test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does NOT create the checkpoint directory or pass checkpointHostDir when flag is OFF (default)', async () => {
    vi.stubEnv('SESSION_CHECKPOINT_RESUME_ENABLED', '');

    const { service, containerOrchestrator } = makeService();

    await (service as unknown as PrivateProvisionContainer).provisionContainer(
      BASE_PARAMS,
    );

    expect(mkdirSyncMock).not.toHaveBeenCalled();
    expect(containerOrchestrator.provisionContainer).toHaveBeenCalledOnce();

    // Node-only path: no step toolchain inputs, so the resolved image must
    // be the unmodified base image for the LIGHT tier — not a composite ref.
    expect(containerOrchestrator.provisionContainer.mock.calls[0][0]).toEqual(
      expect.objectContaining({ image: 'nexus-light:latest' }),
    );

    // buildAgentContainerConfig must have been called without checkpointHostDir
    expect(buildAgentContainerConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({ checkpointHostDir: undefined }),
    );
  });

  it('creates the checkpoint directory and passes checkpointHostDir when flag is ON', async () => {
    vi.stubEnv('SESSION_CHECKPOINT_RESUME_ENABLED', 'true');

    const { service, containerOrchestrator } = makeService();

    await (service as unknown as PrivateProvisionContainer).provisionContainer(
      BASE_PARAMS,
    );

    // Directory must be created
    expect(mkdirSyncMock).toHaveBeenCalledOnce();
    expect(mkdirSyncMock).toHaveBeenCalledWith(
      expect.stringContaining('run-flag-test'),
      { recursive: true },
    );

    // buildAgentContainerConfig must receive a truthy checkpointHostDir
    expect(buildAgentContainerConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        checkpointHostDir: expect.stringContaining('run-flag-test'),
      }),
    );

    expect(containerOrchestrator.provisionContainer).toHaveBeenCalledOnce();
  });
});

describe('StepAgentContainerSupportService — runtime toolchain provisioning (non-node-only path)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXUS_CHECKPOINT_BASE_DIR', '/tmp/nexus-ck-test');
    vi.stubEnv('SESSION_CHECKPOINT_RESUME_ENABLED', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('threads a step-level toolchain config through to a composite image and cache mounts in the final container config', async () => {
    const COMPOSITE_IMAGE_REF = 'nexus-rt/pi:abc123def456';
    const CACHE_VOLUME = {
      hostPath: 'nexus-cache-pip',
      containerPath: '/root/.cache/pip',
      readOnly: false,
    };
    const CACHE_ENV = { PIP_CACHE_DIR: '/root/.cache/pip' };

    const toolchainResolve = vi
      .fn()
      .mockResolvedValue({ toolchains: [{ tool: 'python', version: '3.12' }] });
    const resolveImageRef = vi.fn().mockResolvedValue(COMPOSITE_IMAGE_REF);
    const resolveCacheMounts = vi.fn().mockResolvedValue({
      volumes: [CACHE_VOLUME],
      env: CACHE_ENV,
    });

    const { service, containerOrchestrator } = makeService({
      toolchainResolve,
      resolveImageRef,
      resolveCacheMounts,
    });

    await (service as unknown as PrivateProvisionContainer).provisionContainer({
      ...BASE_PARAMS,
      stepInputs: { toolchains: [{ tool: 'python', version: '3.12' }] },
    });

    expect(containerOrchestrator.provisionContainer).toHaveBeenCalledOnce();
    const finalConfig = containerOrchestrator.provisionContainer.mock
      .calls[0][0] as {
      image: string;
      env?: Record<string, string>;
      volumes?: Array<{
        hostPath: string;
        containerPath: string;
        readOnly?: boolean;
      }>;
    };

    // The resolved step-level toolchain config must reach the resolver, the
    // composite image ref must replace the base image, and the cache
    // volume/env must be present on the config handed to the orchestrator.
    expect(toolchainResolve).toHaveBeenCalledWith(
      expect.objectContaining({
        stepConfig: expect.objectContaining({
          toolchains: [{ tool: 'python', version: '3.12' }],
        }),
      }),
    );
    expect(finalConfig.image).toBe(COMPOSITE_IMAGE_REF);
    expect(finalConfig.image).not.toBe('nexus-light:latest');
    expect(finalConfig.volumes).toContainEqual(CACHE_VOLUME);
    expect(finalConfig.env).toEqual(expect.objectContaining(CACHE_ENV));
  });

  it('threads a run-input toolchain config through to the resolver as runInputConfig', async () => {
    const toolchainResolve = vi
      .fn()
      .mockResolvedValue({ toolchains: [{ tool: 'go', version: '1.23' }] });
    const resolveImageRef = vi
      .fn()
      .mockResolvedValue('nexus-rt/pi:def456abc123');
    const resolveCacheMounts = vi
      .fn()
      .mockResolvedValue({ volumes: [], env: {} });

    const { service } = makeService({
      toolchainResolve,
      resolveImageRef,
      resolveCacheMounts,
    });

    await (service as unknown as PrivateProvisionContainer).provisionContainer({
      ...BASE_PARAMS,
      runInputConfig: { toolchains: [{ tool: 'go', version: '1.23' }] },
    });

    // Layer 3 of the 5-layer precedence chain (Task 16): a run-input
    // toolchain config — sourced from `stateVariables.trigger.runtime_toolchains`
    // — must reach the resolver as `runInputConfig`, alongside the (absent
    // here) step-level `stepConfig`.
    expect(toolchainResolve).toHaveBeenCalledWith(
      expect.objectContaining({
        runInputConfig: { toolchains: [{ tool: 'go', version: '1.23' }] },
      }),
    );
  });

  it('threads the loaded agent profile toolchain config through to the resolver as agentProfileConfig', async () => {
    const toolchainResolve = vi
      .fn()
      .mockResolvedValue({ toolchains: [{ tool: 'rust', version: '1.80' }] });
    const resolveImageRef = vi.fn().mockResolvedValue('nexus-rt/pi:profile123');
    const resolveCacheMounts = vi
      .fn()
      .mockResolvedValue({ volumes: [], env: {} });

    const { service } = makeService({
      toolchainResolve,
      resolveImageRef,
      resolveCacheMounts,
    });

    await (service as unknown as PrivateProvisionContainer).provisionContainer({
      ...BASE_PARAMS,
      agentProfileName: 'rust-agent',
      agentProfileConfig: { toolchains: [{ tool: 'rust', version: '1.80' }] },
    });

    // The Task 13/18 agent-profile toolchain layer (runtime_toolchains on
    // AgentProfile) must reach the resolver as `agentProfileConfig` so the
    // UI-editable profile layer actually takes effect at runtime.
    expect(toolchainResolve).toHaveBeenCalledWith(
      expect.objectContaining({
        agentProfileConfig: { toolchains: [{ tool: 'rust', version: '1.80' }] },
      }),
    );
  });
});

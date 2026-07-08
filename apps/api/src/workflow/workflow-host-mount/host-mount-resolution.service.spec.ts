import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { IJob } from '@nexus/core';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { AiConfigurationService } from '../../ai-config/ai-configuration.service';
import { SystemSettingsService } from '../../settings/system-settings.service';
import { HostMountAuditService } from './host-mount-audit.service';
import { HostMountResolutionService } from './host-mount-resolution.service';
import { HostMountStartupValidationService } from './host-mount-startup-validation.service';

const HOST_MOUNT_CATALOG_SETTING_KEY = 'workflow_host_mount_catalog';
const HOST_MOUNT_RW_APPROVAL_REQUIRED_SETTING_KEY =
  'workflow_host_mount_rw_approval_required';

describe('HostMountResolutionService', () => {
  let service: HostMountResolutionService;
  let tempRoot: string;
  let docsRoot: string;
  let reportsRoot: string;

  const settingsGetMock = vi.fn();
  const getAgentProfileByNameMock = vi.fn();
  const hostMountAuditEmitMock = vi.fn();
  const startupValidationValidateMock = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'host-mount-resolution-'));
    docsRoot = path.join(tempRoot, 'docs');
    reportsRoot = path.join(tempRoot, 'reports');
    fs.mkdirSync(path.join(docsRoot, 'specs'), { recursive: true });
    fs.mkdirSync(path.join(reportsRoot, 'daily'), { recursive: true });

    settingsGetMock.mockImplementation((key: string, defaultValue: unknown) => {
      if (key === HOST_MOUNT_CATALOG_SETTING_KEY) {
        return {
          project_docs: {
            api_root: docsRoot,
            default_mode: 'ro',
            writable_allowed: true,
          },
          reports: {
            api_root: reportsRoot,
            default_mode: 'ro',
            writable_allowed: false,
          },
        };
      }

      if (key === HOST_MOUNT_RW_APPROVAL_REQUIRED_SETTING_KEY) {
        return false;
      }

      return defaultValue;
    });

    getAgentProfileByNameMock.mockResolvedValue({
      name: 'architect-agent',
      allowed_mount_aliases: ['project_docs', 'reports'],
      denied_mount_aliases: [],
      allow_rw_mount_aliases: ['project_docs'],
    });
    hostMountAuditEmitMock.mockResolvedValue(undefined);
    startupValidationValidateMock.mockResolvedValue(undefined);

    service = new HostMountResolutionService(
      {
        get: settingsGetMock,
      } as unknown as SystemSettingsService,
      {
        getAgentProfileByName: getAgentProfileByNameMock,
      } as unknown as AiConfigurationService,
      {
        emit: hostMountAuditEmitMock,
      } as unknown as HostMountAuditService,
      {
        validate: startupValidationValidateMock,
      } as unknown as HostMountStartupValidationService,
    );
  });

  afterEach(() => {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('resolves approved read-only host mount bindings', async () => {
    const bindings = await service.resolveHostMountBindings({
      job: buildExecutionJob({
        permissions: {
          allow_host_mounts: ['project_docs'],
        },
        host_mounts: [
          {
            alias: 'project_docs',
            subpath: 'specs',
          },
        ],
      }),
      workflowPermissions: {
        allow_host_mounts: ['project_docs'],
      },
      agentProfile: 'architect-agent',
    });

    expect(bindings).toEqual([
      {
        alias: 'project_docs',
        hostPath: path.resolve(docsRoot, 'specs'),
        containerPath: '/workspace/host-shares/project_docs/specs',
        mode: 'ro',
        readOnly: true,
      },
    ]);
  });

  it('rejects unknown host mount aliases', async () => {
    await expect(
      service.resolveHostMountBindings({
        job: buildExecutionJob({
          permissions: {
            allow_host_mounts: ['unknown_alias'],
          },
          host_mounts: [{ alias: 'unknown_alias' }],
        }),
        workflowPermissions: {
          allow_host_mounts: ['unknown_alias'],
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects denied aliases from policy layers', async () => {
    await expect(
      service.resolveHostMountBindings({
        job: buildExecutionJob({
          permissions: {
            allow_host_mounts: ['project_docs'],
            deny_host_mounts: ['project_docs'],
          },
          host_mounts: [{ alias: 'project_docs' }],
        }),
        workflowPermissions: {
          allow_host_mounts: ['project_docs'],
        },
        agentProfile: 'architect-agent',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects host mount traversal subpaths', async () => {
    await expect(
      service.resolveHostMountBindings({
        job: buildExecutionJob({
          permissions: {
            allow_host_mounts: ['project_docs'],
          },
          host_mounts: [
            {
              alias: 'project_docs',
              subpath: '../reports',
            },
          ],
        }),
        workflowPermissions: {
          allow_host_mounts: ['project_docs'],
        },
        agentProfile: 'architect-agent',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects host mount symlink escapes outside alias root', async () => {
    const externalRoot = path.join(tempRoot, 'external-docs');
    fs.mkdirSync(externalRoot, { recursive: true });
    const symlinkPath = path.join(docsRoot, 'external-link');
    fs.symlinkSync(
      externalRoot,
      symlinkPath,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await expect(
      service.resolveHostMountBindings({
        job: buildExecutionJob({
          permissions: {
            allow_host_mounts: ['project_docs'],
          },
          host_mounts: [
            {
              alias: 'project_docs',
              subpath: 'external-link',
            },
          ],
        }),
        workflowPermissions: {
          allow_host_mounts: ['project_docs'],
        },
        agentProfile: 'architect-agent',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects read-write host mounts without explicit rw allowlist', async () => {
    getAgentProfileByNameMock.mockResolvedValue({
      name: 'architect-agent',
      allowed_mount_aliases: ['project_docs'],
      denied_mount_aliases: [],
      allow_rw_mount_aliases: [],
    });

    await expect(
      service.resolveHostMountBindings({
        job: buildExecutionJob({
          permissions: {
            allow_host_mounts: ['project_docs'],
          },
          host_mounts: [{ alias: 'project_docs', mode: 'rw' }],
        }),
        workflowPermissions: {
          allow_host_mounts: ['project_docs'],
        },
        agentProfile: 'architect-agent',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects rw mounts when approval is required', async () => {
    settingsGetMock.mockImplementation((key: string, defaultValue: unknown) => {
      if (key === HOST_MOUNT_CATALOG_SETTING_KEY) {
        return {
          project_docs: {
            api_root: docsRoot,
            default_mode: 'ro',
            writable_allowed: true,
            approval_required_on_rw: true,
          },
        };
      }

      if (key === HOST_MOUNT_RW_APPROVAL_REQUIRED_SETTING_KEY) {
        return false;
      }

      return defaultValue;
    });

    await expect(
      service.resolveHostMountBindings({
        job: buildExecutionJob({
          permissions: {
            allow_host_mounts: ['project_docs'],
            allow_host_mount_rw: ['project_docs'],
          },
          host_mounts: [{ alias: 'project_docs', mode: 'rw' }],
        }),
        workflowPermissions: {
          allow_host_mounts: ['project_docs'],
          allow_host_mount_rw: ['project_docs'],
        },
        agentProfile: 'architect-agent',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns approval_required preflight outcome when rw mount needs approval', async () => {
    settingsGetMock.mockImplementation((key: string, defaultValue: unknown) => {
      if (key === HOST_MOUNT_CATALOG_SETTING_KEY) {
        return {
          project_docs: {
            api_root: docsRoot,
            default_mode: 'ro',
            writable_allowed: true,
            approval_required_on_rw: true,
          },
        };
      }

      if (key === HOST_MOUNT_RW_APPROVAL_REQUIRED_SETTING_KEY) {
        return false;
      }

      return defaultValue;
    });

    const outcome = await service.resolveHostMountBindingsPreflight({
      job: buildExecutionJob({
        permissions: {
          allow_host_mounts: ['project_docs'],
          allow_host_mount_rw: ['project_docs'],
        },
        host_mounts: [{ alias: 'project_docs', mode: 'rw' }],
      }),
      workflowPermissions: {
        allow_host_mounts: ['project_docs'],
        allow_host_mount_rw: ['project_docs'],
      },
      agentProfile: 'architect-agent',
      workflowRunId: 'run-1',
      stepId: 'step-1',
    });

    expect(outcome.status).toBe('approval_required');
    expect(outcome.bindings).toEqual([]);
    expect(outcome.approvals_required).toEqual([
      {
        alias: 'project_docs',
        mode: 'rw',
        reason: "Host mount alias 'project_docs' requires write approval",
      },
    ]);
  });

  it('resolves rw mounts when alias is writable and explicitly allowed', async () => {
    const bindings = await service.resolveHostMountBindings({
      job: buildExecutionJob({
        permissions: {
          allow_host_mounts: ['project_docs'],
          allow_host_mount_rw: ['project_docs'],
        },
        host_mounts: [{ alias: 'project_docs', mode: 'rw' }],
      }),
      workflowPermissions: {
        allow_host_mounts: ['project_docs'],
        allow_host_mount_rw: ['project_docs'],
      },
      agentProfile: 'architect-agent',
    });

    expect(bindings[0]?.readOnly).toBe(false);
    expect(bindings[0]?.mode).toBe('rw');
  });
});

function buildExecutionJob(overrides: Partial<IJob> = {}): IJob {
  return {
    id: 'job-1',
    type: 'execution',
    tier: 'heavy',
    steps: [{ id: 'default', prompt: 'test' }],
    ...overrides,
  };
}

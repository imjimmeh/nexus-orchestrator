import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SystemSettingsService } from '../../settings/system-settings.service';
import { HostMountStartupValidationService } from './host-mount-startup-validation.service';

describe('HostMountStartupValidationService', () => {
  const settingsGetMock = vi.fn();
  const originalApiBasePath = process.env.NEXUS_API_HOST_SHARE_BASE_PATH;
  const originalHostShareMountPath = process.env.NEXUS_HOST_SHARE_MOUNT_PATH;
  const originalEnvCatalog = process.env.NEXUS_HOST_MOUNT_CATALOG_JSON;
  const originalSkillsLibraryPath = process.env.NEXUS_SKILLS_LIBRARY_PATH;

  let tempRoot: string;
  let apiBasePath: string;
  let hostShareMountPath: string;
  let catalogRoot: string;
  let skillsLibraryRoot: string;
  let service: HostMountStartupValidationService;
  let loggerWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'host-mount-startup-'));
    apiBasePath = path.join(tempRoot, 'api-host-shares');
    hostShareMountPath = path.join(tempRoot, 'host-share-mounts');
    skillsLibraryRoot = path.join(tempRoot, 'skills-library');
    catalogRoot = path.join(apiBasePath, 'project-docs');
    fs.mkdirSync(catalogRoot, { recursive: true });
    fs.mkdirSync(hostShareMountPath, { recursive: true });
    fs.mkdirSync(skillsLibraryRoot, { recursive: true });

    settingsGetMock.mockImplementation((key: string, defaultValue: unknown) => {
      if (key === 'workflow_host_mount_catalog') {
        return {
          project_docs: {
            api_root: catalogRoot,
            default_mode: 'ro',
            writable_allowed: true,
          },
        };
      }

      return defaultValue;
    });

    process.env.NEXUS_API_HOST_SHARE_BASE_PATH = apiBasePath;
    process.env.NEXUS_HOST_SHARE_MOUNT_PATH = hostShareMountPath;
    process.env.NEXUS_SKILLS_LIBRARY_PATH = skillsLibraryRoot;
    delete process.env.NEXUS_HOST_MOUNT_CATALOG_JSON;

    loggerWarnSpy = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    service = new HostMountStartupValidationService({
      get: settingsGetMock,
    } as unknown as SystemSettingsService);
  });

  afterEach(() => {
    if (fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }

    if (originalApiBasePath === undefined) {
      delete process.env.NEXUS_API_HOST_SHARE_BASE_PATH;
    } else {
      process.env.NEXUS_API_HOST_SHARE_BASE_PATH = originalApiBasePath;
    }

    if (originalHostShareMountPath === undefined) {
      delete process.env.NEXUS_HOST_SHARE_MOUNT_PATH;
    } else {
      process.env.NEXUS_HOST_SHARE_MOUNT_PATH = originalHostShareMountPath;
    }

    if (originalEnvCatalog === undefined) {
      delete process.env.NEXUS_HOST_MOUNT_CATALOG_JSON;
    } else {
      process.env.NEXUS_HOST_MOUNT_CATALOG_JSON = originalEnvCatalog;
    }

    if (originalSkillsLibraryPath === undefined) {
      delete process.env.NEXUS_SKILLS_LIBRARY_PATH;
    } else {
      process.env.NEXUS_SKILLS_LIBRARY_PATH = originalSkillsLibraryPath;
    }

    loggerWarnSpy.mockRestore();
  });

  it('validates host mount catalog and mapping paths at startup', async () => {
    await expect(service.validate()).resolves.toBeUndefined();
    expect(settingsGetMock).toHaveBeenCalledWith(
      'workflow_host_mount_catalog',
      {},
    );
  });

  it('throws when API host-share base path is not absolute', async () => {
    process.env.NEXUS_API_HOST_SHARE_BASE_PATH = 'relative/path';

    await expect(service.validate()).rejects.toThrow(
      'NEXUS_API_HOST_SHARE_BASE_PATH must be an absolute path',
    );
  });

  it('accepts skills library catalog roots outside the host-share base path', async () => {
    const skillsAliasRoot = path.join(skillsLibraryRoot, 'authoring');
    fs.mkdirSync(skillsAliasRoot, { recursive: true });

    settingsGetMock.mockImplementation((key: string, defaultValue: unknown) => {
      if (key === 'workflow_host_mount_catalog') {
        return {
          skills_library: {
            api_root: skillsAliasRoot,
            default_mode: 'ro',
            writable_allowed: true,
            approval_required_on_rw: true,
          },
        };
      }

      return defaultValue;
    });

    await expect(service.validate()).resolves.toBeUndefined();
    expect(loggerWarnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Host mount alias 'skills_library' api_root"),
    );
  });
});

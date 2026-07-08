import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { SystemSettingsService } from '../../settings/system-settings.service';
import {
  parseCatalogFromEnv,
  parseHostMountCatalog,
} from './host-mount-resolution.helpers';
import { HOST_MOUNT_CATALOG_SETTING_KEY } from './host-mount-resolution.service.types';

const DEFAULT_API_HOST_SHARE_BASE_PATH = path.join(
  '/data',
  'nexus-host-shares',
);

@Injectable()
export class HostMountStartupValidationService {
  private readonly logger = new Logger(HostMountStartupValidationService.name);
  private readonly defaultSkillsLibraryPath = path.join(
    '/data',
    'nexus-skills',
  );

  constructor(private readonly settings: SystemSettingsService) {}

  async validate(): Promise<void> {
    const catalog = await this.loadCatalog();
    const allowedCatalogRoots = this.resolveAllowedCatalogRoots();
    const hostShareMountPath = this.resolveHostShareMountPath();

    await this.validateCatalogRoots(catalog, allowedCatalogRoots);
    await this.validateHostShareMountPath(hostShareMountPath);

    if (catalog.size > 0 && !hostShareMountPath) {
      this.logger.warn(
        'Host mount catalog is configured but NEXUS_HOST_SHARE_MOUNT_PATH is unset; nested Docker host-path remap may be unavailable.',
      );
    }

    this.logger.log(
      `Host mount startup validation complete: catalog_aliases=${catalog.size.toString()}, allowed_api_roots='${allowedCatalogRoots.join(',')}', host_mount_path='${hostShareMountPath || '<unset>'}'`,
    );
  }

  private async loadCatalog(): Promise<
    ReturnType<typeof parseHostMountCatalog>
  > {
    const settingsCatalog = await this.settings.get<unknown>(
      HOST_MOUNT_CATALOG_SETTING_KEY,
      {},
    );

    const envCatalog = parseCatalogFromEnv(
      process.env.NEXUS_HOST_MOUNT_CATALOG_JSON,
    );

    return parseHostMountCatalog({
      ...(envCatalog as Record<string, unknown>),
      ...(settingsCatalog as Record<string, unknown>),
    });
  }

  private resolveAllowedCatalogRoots(): string[] {
    const apiHostShareBasePath =
      process.env.NEXUS_API_HOST_SHARE_BASE_PATH?.trim() ||
      DEFAULT_API_HOST_SHARE_BASE_PATH;

    if (!path.isAbsolute(apiHostShareBasePath)) {
      throw new BadRequestException(
        'NEXUS_API_HOST_SHARE_BASE_PATH must be an absolute path',
      );
    }

    const skillsLibraryPath = this.resolveSkillsLibraryPath();
    return [...new Set([apiHostShareBasePath, skillsLibraryPath])];
  }

  private resolveSkillsLibraryPath(): string {
    const value =
      process.env.NEXUS_SKILLS_LIBRARY_PATH?.trim() ||
      this.defaultSkillsLibraryPath;

    return path.isAbsolute(value) ? value : path.resolve(value);
  }

  private resolveHostShareMountPath(): string {
    const value = process.env.NEXUS_HOST_SHARE_MOUNT_PATH?.trim() || '';

    if (!value) {
      return '';
    }

    if (!path.isAbsolute(value)) {
      throw new BadRequestException(
        'NEXUS_HOST_SHARE_MOUNT_PATH must be an absolute path when set',
      );
    }

    return value;
  }

  private async validateCatalogRoots(
    catalog: ReturnType<typeof parseHostMountCatalog>,
    allowedCatalogRoots: string[],
  ): Promise<void> {
    for (const entry of catalog.values()) {
      try {
        const resolvedRoot = await fs.realpath(entry.apiRoot);
        const withinAllowedRoot = allowedCatalogRoots.some((allowedRoot) =>
          this.isWithinRoot(allowedRoot, resolvedRoot),
        );

        if (!withinAllowedRoot) {
          this.logger.warn(
            `Host mount alias '${entry.alias}' api_root '${resolvedRoot}' is outside configured API catalog roots '${allowedCatalogRoots.join(',')}'`,
          );
        }
      } catch {
        this.logger.warn(
          `Host mount alias '${entry.alias}' api_root '${entry.apiRoot}' is not accessible at startup`,
        );
      }
    }
  }

  private async validateHostShareMountPath(
    hostShareMountPath: string,
  ): Promise<void> {
    if (!hostShareMountPath) {
      return;
    }

    try {
      await fs.realpath(hostShareMountPath);
    } catch {
      this.logger.warn(
        `NEXUS_HOST_SHARE_MOUNT_PATH '${hostShareMountPath}' is not accessible at startup`,
      );
    }
  }

  private isWithinRoot(rootPath: string, targetPath: string): boolean {
    const relative = path.relative(rootPath, targetPath);
    return (
      relative === '' ||
      (!relative.startsWith('..') && !path.isAbsolute(relative))
    );
  }
}

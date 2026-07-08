import { Inject, Injectable, Logger } from '@nestjs/common';
import Docker from 'dockerode';
import type { RuntimeToolchainConfig } from '@nexus/core';
import { DOCKER_CLIENT } from '../../docker/docker.constants';
import { CACHE_PRESETS, CACHE_VOLUME_PREFIX } from './cache-volume-presets';
import type { ResolvedCacheMounts } from './package-cache-volume.service.types';

/**
 * Ensures Docker named volumes exist for package-manager/OS caches (npm, pip,
 * go, cargo, maven, mise, apt) plus any user-defined custom caches, honoring
 * `disableCaches`. Volume creation is idempotent: Docker's createVolume
 * succeeds as a no-op when a volume with the same name already exists.
 */
@Injectable()
export class PackageCacheVolumeService {
  private readonly logger = new Logger(PackageCacheVolumeService.name);

  constructor(@Inject(DOCKER_CLIENT) private readonly docker: Docker) {}

  async resolveCacheMounts(
    config: RuntimeToolchainConfig,
  ): Promise<ResolvedCacheMounts> {
    const disabled = new Set(config.disableCaches ?? []);
    const volumes: ResolvedCacheMounts['volumes'] = [];
    const env: Record<string, string> = {};

    for (const preset of CACHE_PRESETS) {
      if (disabled.has(preset.id) || !preset.enabledFor(config)) continue;
      volumes.push({
        hostPath: `${CACHE_VOLUME_PREFIX}${preset.id}`,
        containerPath: preset.containerPath,
        readOnly: false,
      });
      Object.assign(env, preset.env ?? {});
    }

    for (const cache of config.caches ?? []) {
      volumes.push({
        hostPath: `${CACHE_VOLUME_PREFIX}${cache.id}`,
        containerPath: cache.path,
        readOnly: false,
      });
    }

    await Promise.all(volumes.map((v) => this.ensureVolume(v.hostPath)));
    return { volumes, env };
  }

  private async ensureVolume(name: string): Promise<void> {
    try {
      await this.docker.createVolume({
        Name: name,
        Labels: { 'nexus.managed': 'true', 'nexus.cache': 'true' },
      });
    } catch (error) {
      // createVolume is idempotent in practice; ignore "already exists".
      // Log at warn level to surface real errors (auth, disk-full) instead of
      // silently masking them.
      this.logger.warn(
        `Failed to create cache volume "${name}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

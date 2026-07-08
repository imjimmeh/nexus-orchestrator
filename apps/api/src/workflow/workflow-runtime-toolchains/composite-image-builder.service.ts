import { Inject, Injectable, Logger } from '@nestjs/common';
import * as tar from 'tar-stream';
import Docker from 'dockerode';
import type { RuntimeToolchainConfig } from '@nexus/core';
import {
  COMPOSITE_TAG_PREFIX,
  computeCompositeImageTag,
} from './composite-image-tag';
import { generateCompositeDockerfile } from './composite-dockerfile';
import { CompositeImageBuildError } from './composite-image-build.error';
import { DOCKER_CLIENT } from '../../docker/docker.constants';
import { normalizeContainerLogs } from '../../docker/container-log-text.utils';

/** Docker label applied to every composite image so GC can find them by selector. */
const MANAGED_LABEL = 'nexus.managed';
/** Max characters of build-failure log retained on `CompositeImageBuildError.logTail`. */
const BUILD_LOG_TAIL_MAX_CHARS = 2_000;

/**
 * Resolves (and lazily builds) the composite harness+toolchain image for a
 * workflow execution container. Builds are content-addressed by
 * {@link computeCompositeImageTag} and de-duplicated per-tag via an
 * in-process lock so concurrent requests for the same toolchain set share a
 * single `docker buildImage` call instead of racing.
 */
@Injectable()
export class CompositeImageBuilderService {
  private readonly logger = new Logger(CompositeImageBuilderService.name);
  private readonly inFlight = new Map<string, Promise<string>>();

  constructor(@Inject(DOCKER_CLIENT) private readonly docker: Docker) {}

  private tagFor(
    harnessId: string,
    baseImageId: string,
    config: RuntimeToolchainConfig,
  ): string {
    return computeCompositeImageTag({ harnessId, baseImageId, config });
  }

  /**
   * Returns the composite image ref for the given harness base image and
   * resolved toolchain config, building it under a per-tag lock if it does
   * not already exist locally.
   */
  async ensureImage(params: {
    harnessId: string;
    baseImageRef: string;
    config: RuntimeToolchainConfig;
  }): Promise<string> {
    const baseId = (await this.docker.getImage(params.baseImageRef).inspect())
      .Id;
    const tag = this.tagFor(params.harnessId, baseId, params.config);

    if (await this.imageExists(tag)) return tag;

    const existing = this.inFlight.get(tag);
    if (existing) return existing;

    const build = this.build(tag, params.baseImageRef, params.config).finally(
      () => this.inFlight.delete(tag),
    );
    this.inFlight.set(tag, build);
    return build;
  }

  private async imageExists(ref: string): Promise<boolean> {
    try {
      await this.docker.getImage(ref).inspect();
      return true;
    } catch {
      return false;
    }
  }

  private async build(
    tag: string,
    baseImageRef: string,
    config: RuntimeToolchainConfig,
  ): Promise<string> {
    const dockerfile = generateCompositeDockerfile({ baseImageRef, config });
    const context = this.tarContext(dockerfile);
    const stream = await this.docker.buildImage(context, {
      t: tag,
      dockerfile: 'Dockerfile',
      version: '2',
      labels: { [MANAGED_LABEL]: 'true' },
    });
    await this.followBuild(stream, tag);
    return tag;
  }

  private tarContext(dockerfile: string): NodeJS.ReadableStream {
    const pack = tar.pack();
    pack.entry({ name: 'Dockerfile' }, dockerfile);
    pack.finalize();
    return pack;
  }

  private followBuild(
    stream: NodeJS.ReadableStream,
    tag: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.docker.modem.followProgress(
        stream,
        (err: Error | null, _res: unknown) => {
          if (err) {
            const tail =
              normalizeContainerLogs(err.message, BUILD_LOG_TAIL_MAX_CHARS) ??
              '';
            reject(
              new CompositeImageBuildError(
                `Composite image build failed for ${tag}`,
                tail,
              ),
            );
            return;
          }
          resolve();
        },
      );
    });
  }

  /**
   * Periodic GC entrypoint (wired by a future task's cron service): removes
   * managed composite images whose last build is older than `maxAgeMs`.
   */
  async collectGarbage(maxAgeMs: number): Promise<void> {
    const images = await this.docker.listImages({
      filters: { label: [`${MANAGED_LABEL}=true`] },
    });
    for (const img of images) {
      const repoTag = (img.RepoTags ?? []).find((t) =>
        t.startsWith(`${COMPOSITE_TAG_PREFIX}/`),
      );
      if (!repoTag) continue;
      const ageMs = Date.now() - img.Created * 1000;
      if (ageMs > maxAgeMs) {
        try {
          await this.docker.getImage(repoTag).remove({ force: false });
        } catch (error) {
          this.logger.warn(
            `GC could not remove ${repoTag}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }
}

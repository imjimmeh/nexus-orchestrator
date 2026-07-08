import type { IContainerConfig, RuntimeToolchainConfig } from '@nexus/core';
import type { ToolchainResolverService } from '../workflow-runtime-toolchains/toolchain-resolver.service';
import type { HarnessImageResolver } from '../workflow-runtime-toolchains/harness-image-resolver.service';
import type { PackageCacheVolumeService } from '../workflow-runtime-toolchains/package-cache-volume.service';

/**
 * Augments a provisioned {@link IContainerConfig} with the resolved runtime
 * toolchain image and package/OS cache volume mounts. Runs the 5-layer
 * precedence resolver, swaps the container image for the base (node-only
 * fast path) or composite ref, and appends the cache volumes/env onto the
 * config already produced by {@link buildAgentContainerConfig}.
 *
 * Shared by both the step and subagent container-provisioning paths (closes
 * the historical step-vs-subagent divergence for this concern) — callers
 * pass only the narrow `resolve`/`resolveImageRef`/`resolveCacheMounts`
 * surface they depend on, so either path's lightweight context type can
 * satisfy these params without depending on the concrete service classes.
 */
export async function applyRuntimeToolchains(params: {
  config: IContainerConfig;
  harnessId: string;
  baseImageRef: string;
  resolverInputs: {
    stepConfig?: RuntimeToolchainConfig;
    agentProfileConfig?: RuntimeToolchainConfig;
    runInputConfig?: RuntimeToolchainConfig;
    workspacePath?: string;
  };
  resolver: Pick<ToolchainResolverService, 'resolve'>;
  imageResolver: Pick<HarnessImageResolver, 'resolveImageRef'>;
  cacheService: Pick<PackageCacheVolumeService, 'resolveCacheMounts'>;
}): Promise<IContainerConfig> {
  const resolved = await params.resolver.resolve(params.resolverInputs);
  const image = await params.imageResolver.resolveImageRef({
    harnessId: params.harnessId,
    baseImageRef: params.baseImageRef,
    config: resolved,
  });
  const mounts = await params.cacheService.resolveCacheMounts(resolved);
  return {
    ...params.config,
    image,
    env: { ...(params.config.env ?? {}), ...mounts.env },
    volumes: [...(params.config.volumes ?? []), ...mounts.volumes],
  };
}

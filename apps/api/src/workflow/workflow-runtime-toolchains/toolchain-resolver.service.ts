import { Injectable } from '@nestjs/common';
import type { RuntimeToolchainConfig } from '@nexus/core';
import { RepoToolchainDetectorService } from './repo-toolchain-detector.service';
import { mergeToolchainLayers } from './toolchain-merge';
import { validateRuntimeToolchainConfig } from './toolchain-validation';

/** Lowest-precedence layer when no other source supplies a toolchain set. */
const BASE_DEFAULT: RuntimeToolchainConfig = { toolchains: [] };

/**
 * Resolves the effective {@link RuntimeToolchainConfig} for a workflow
 * execution by merging the 5-layer precedence chain (step > agent profile >
 * run input > repo-detected > base default) via {@link mergeToolchainLayers}.
 * Each explicit (non-detected) layer is validated up front so an invalid
 * toolchain request fails fast, before any merge or image-build work starts.
 * The final merged result — which may be won by the untrusted repo-detected
 * layer — is validated again before being returned, since the Dockerfile
 * generator that consumes it performs no escaping of its own.
 */
@Injectable()
export class ToolchainResolverService {
  constructor(private readonly detector: RepoToolchainDetectorService) {}

  async resolve(params: {
    stepConfig?: RuntimeToolchainConfig;
    agentProfileConfig?: RuntimeToolchainConfig;
    runInputConfig?: RuntimeToolchainConfig;
    workspacePath?: string;
  }): Promise<RuntimeToolchainConfig> {
    for (const explicit of [
      params.stepConfig,
      params.agentProfileConfig,
      params.runInputConfig,
    ])
      if (explicit) validateRuntimeToolchainConfig(explicit);

    const detected: RuntimeToolchainConfig | undefined = params.workspacePath
      ? { toolchains: await this.detector.detect(params.workspacePath) }
      : undefined;

    const merged = mergeToolchainLayers([
      params.stepConfig,
      params.agentProfileConfig,
      params.runInputConfig,
      detected,
      BASE_DEFAULT,
    ]);

    // Re-validate the fully merged result: the detected layer (sourced from
    // untrusted repo content such as .tool-versions/go.mod/package.json) is
    // never validated above, yet it wins the merge whenever no explicit
    // layer overrides it. Downstream Dockerfile generation performs no
    // escaping, so an unvalidated merged config is a command-injection risk.
    validateRuntimeToolchainConfig(merged);

    return merged;
  }
}

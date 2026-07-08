import { Injectable } from '@nestjs/common';
import type { RuntimeToolchainConfig } from '@nexus/core';
import { CompositeImageBuilderService } from './composite-image-builder.service';
import { isNodeOnly } from './composite-image-tag';

/**
 * Resolves the harness container image ref for an execution: the node-only
 * fast path returns the harness base image unchanged (no build), while any
 * other toolchain set is delegated to {@link CompositeImageBuilderService}
 * for content-addressed composite image build/reuse.
 */
@Injectable()
export class HarnessImageResolver {
  constructor(private readonly builder: CompositeImageBuilderService) {}

  async resolveImageRef(params: {
    harnessId: string;
    baseImageRef: string;
    config: RuntimeToolchainConfig;
  }): Promise<string> {
    if (isNodeOnly(params.config)) return params.baseImageRef;
    return this.builder.ensureImage({
      harnessId: params.harnessId,
      baseImageRef: params.baseImageRef,
      config: params.config,
    });
  }
}

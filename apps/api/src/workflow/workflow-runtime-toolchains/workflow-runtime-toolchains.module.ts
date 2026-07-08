import { Module } from '@nestjs/common';
import { DockerModule } from '../../docker/docker.module';
import { RepoToolchainDetectorService } from './repo-toolchain-detector.service';
import { ToolchainResolverService } from './toolchain-resolver.service';
import { HarnessImageResolver } from './harness-image-resolver.service';
import { CompositeImageBuilderService } from './composite-image-builder.service';
import { PackageCacheVolumeService } from './package-cache-volume.service';

/**
 * Multi-language harness runtime toolchain resolution: precedence merging
 * (step > agent profile > run input > repo-detected > base default),
 * composite image build/reuse, and package/OS cache volume management.
 *
 * Imports {@link DockerModule} (non-circular: DockerModule does not import
 * this module back) for `DOCKER_CLIENT`, used by
 * {@link CompositeImageBuilderService}. The existing periodic container
 * cleanup cron (`ContainerCleanupService`, owned by `DockerModule`) resolves
 * `CompositeImageBuilderService` lazily via `ModuleRef` (`strict: false`)
 * rather than this module importing `DockerModule` from a `ContainerCleanup`-
 * specific module edge — that keeps the dependency graph a DAG instead of
 * introducing a new module cycle (see `apps/api/CIRCULAR_BASELINE.md`).
 */
@Module({
  imports: [DockerModule],
  providers: [
    RepoToolchainDetectorService,
    ToolchainResolverService,
    HarnessImageResolver,
    CompositeImageBuilderService,
    PackageCacheVolumeService,
  ],
  exports: [
    ToolchainResolverService,
    HarnessImageResolver,
    PackageCacheVolumeService,
    CompositeImageBuilderService,
  ],
})
export class WorkflowRuntimeToolchainsModule {}

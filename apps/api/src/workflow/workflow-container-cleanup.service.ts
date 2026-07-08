import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import Docker from 'dockerode';
import { DOCKER_CLIENT } from '../docker/docker.constants';

/**
 * Owns the Docker kill loop that terminates managed workflow run
 * containers. Extracted from `WorkflowEngineService` and
 * `WorkflowTerminalRunCloserService` so cancellation and
 * failure-closing paths share a single, single-purpose seam.
 *
 * Swallows per-container kill failures and `listContainers` failures
 * with a `Logger.warn` so a single stuck container cannot abort a
 * cancel/close cascade. The behaviour mirrors the engine's prior
 * inline helper byte-for-byte.
 */
@Injectable()
export class WorkflowContainerCleanupService {
  private readonly logger = new Logger(WorkflowContainerCleanupService.name);

  constructor(
    @Inject(DOCKER_CLIENT)
    @Optional()
    private readonly docker?: Docker,
  ) {}

  /**
   * Best-effort kill of every managed Docker container tagged with the
   * supplied workflow run id. Returns the count of containers that
   * were killed without error; failed kills and a failed
   * `listContainers` call do not throw.
   */
  async stopManagedContainersForRun(workflowRunId: string): Promise<number> {
    if (!this.docker) {
      return 0;
    }

    try {
      const containers = await this.docker.listContainers({
        all: true,
        filters: {
          label: [
            'nexus.managed=true',
            `nexus.workflow_run_id=${workflowRunId}`,
          ],
        },
      });

      let stoppedCount = 0;
      for (const containerInfo of containers) {
        const container = this.docker.getContainer(containerInfo.Id);
        try {
          await container.kill();
          stoppedCount += 1;
        } catch (error) {
          this.logger.warn(
            `Failed to kill container ${containerInfo.Id} for run ${workflowRunId}: ${(error as Error).message}`,
          );
        }
      }
      return stoppedCount;
    } catch (error) {
      this.logger.warn(
        `Failed to list containers for workflow run ${workflowRunId}: ${(error as Error).message}`,
      );
      return 0;
    }
  }
}

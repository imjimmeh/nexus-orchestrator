import { Inject, Injectable, Logger } from '@nestjs/common';
import Docker from 'dockerode';
import { DOCKER_CLIENT } from '../docker/docker.constants';
import type { ContainerLivenessProbe } from './execution-supervisor.service';

interface DockerLikeError {
  statusCode?: number;
}

@Injectable()
export class SubagentContainerLivenessProbe implements ContainerLivenessProbe {
  private readonly logger = new Logger(SubagentContainerLivenessProbe.name);

  constructor(@Inject(DOCKER_CLIENT) private readonly docker: Docker) {}

  async isContainerLost(containerId: string): Promise<boolean> {
    try {
      const info = (await this.docker.getContainer(containerId).inspect()) as {
        State?: { Status?: string };
      };
      const status = info.State?.Status;
      return status === 'exited' || status === 'dead' || status === 'removing';
    } catch (error) {
      if ((error as DockerLikeError).statusCode === 404) {
        return true;
      }
      this.logger.warn(
        `Liveness probe failed for ${containerId}: ${(error as Error).message}`,
      );
      return false;
    }
  }
}

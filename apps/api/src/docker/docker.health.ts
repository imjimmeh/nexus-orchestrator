import { Injectable, Inject } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthCheckError,
  HealthIndicator,
} from '@nestjs/terminus';
import Docker from 'dockerode';
import { DOCKER_CLIENT } from './docker.constants';

@Injectable()
export class DockerHealthIndicator extends HealthIndicator {
  constructor(@Inject(DOCKER_CLIENT) private readonly docker: Docker) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.docker.ping();
      return this.getStatus(key, true);
    } catch (e) {
      const error = e as Error;
      throw new HealthCheckError(
        `Docker check failed: ${error.message}`,
        this.getStatus(key, false),
      );
    }
  }
}

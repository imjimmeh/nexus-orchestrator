import { Inject, Injectable, Optional } from '@nestjs/common';
import Docker from 'dockerode';
import { DOCKER_CLIENT } from '../docker/docker.constants';
import { resolveContainerContextForSubagent } from './telemetry-gateway-container-context.helpers';

/**
 * Resolves a running container for a (workflowRunId, jobId, stepId) tuple
 * via Docker label lookup. Used by both the event broadcast path (to seed
 * the session checkpoint's container id) and the subagent orchestration path
 * (to seed the client's container id when no agent has connected yet).
 *
 * Centralizing the Docker client here keeps Docker out of both the event
 * service and the subagent service so they remain narrow and business-only.
 */
@Injectable()
export class TelemetryContainerContextService {
  constructor(
    @Optional()
    @Inject(DOCKER_CLIENT)
    private readonly docker?: Docker,
  ) {}

  resolve(context: {
    workflowRunId: string;
    jobId?: string;
    stepId?: string;
  }): Promise<string | null> {
    return resolveContainerContextForSubagent({
      docker: this.docker,
      ...context,
    });
  }
}

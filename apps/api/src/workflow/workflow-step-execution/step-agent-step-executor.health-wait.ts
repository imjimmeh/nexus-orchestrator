import { resolveHealthCheckTimeoutMs } from '../../docker/container-http-client.service';
import type { JobExecutionDependencies } from './step-agent-step-executor.multistep.types';

/**
 * Waits for a freshly-started step container's `/health` server. Uses a
 * provisioning-aware timeout (the baked image may run `npm install` on lockfile
 * drift before listening) and fails fast via the liveness probe if the
 * container exits during that grace window — rather than waiting out the full
 * ceiling and being misclassified as a slow timeout.
 */
export async function waitForStepContainerHealth(
  deps: Pick<
    JobExecutionDependencies,
    'containerHttpClient' | 'fetchContainerLogSnapshot' | 'isContainerRunning'
  >,
  baseUrl: string,
  containerId: string,
): Promise<void> {
  const isContainerRunning = deps.isContainerRunning;
  await deps.containerHttpClient.waitForHealth(
    baseUrl,
    resolveHealthCheckTimeoutMs(process.env.CONTAINER_HEALTH_CHECK_TIMEOUT_MS),
    {
      containerId,
      fetchLogs: () => deps.fetchContainerLogSnapshot(containerId),
      isContainerRunning: isContainerRunning
        ? () => isContainerRunning(containerId)
        : undefined,
    },
  );
}

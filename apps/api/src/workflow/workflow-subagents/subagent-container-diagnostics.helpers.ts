import type Docker from 'dockerode';
import type { ContainerDiagnostics } from './subagent-container-diagnostics.helpers.types';
import { normalizeContainerLogs } from '../../docker/container-log-text.utils';

/** Number of trailing log lines captured from a child container on reap. */
export const CONTAINER_DIAGNOSTICS_LOG_TAIL_LINES = 80;

/** Upper bound on captured log characters; older characters are dropped first. */
export const CONTAINER_DIAGNOSTICS_LOG_MAX_CHARS = 8_000;

/**
 * Captures the tail of a child container's logs for post-mortem diagnostics.
 * Never throws: a missing/gone container yields a "failed to collect" note so a
 * reap can always record what it could observe.
 */
export async function collectContainerDiagnostics(
  docker: Pick<Docker, 'getContainer'>,
  childContainerId: string | null,
): Promise<ContainerDiagnostics | null> {
  if (!childContainerId) {
    return null;
  }

  try {
    const output = await docker.getContainer(childContainerId).logs({
      stdout: true,
      stderr: true,
      follow: false,
      tail: CONTAINER_DIAGNOSTICS_LOG_TAIL_LINES,
    });
    const logsTail = normalizeContainerLogs(
      output,
      CONTAINER_DIAGNOSTICS_LOG_MAX_CHARS,
    );

    if (!logsTail) {
      return null;
    }

    return {
      child_container_id: childContainerId,
      logs_tail: logsTail,
    };
  } catch (error) {
    return {
      child_container_id: childContainerId,
      logs_tail: `Failed to collect logs: ${(error as Error).message}`,
    };
  }
}

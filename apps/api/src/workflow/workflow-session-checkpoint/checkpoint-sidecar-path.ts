import * as path from 'node:path';
import { DEFAULT_CHECKPOINT_BASE_DIR } from '@nexus/core';

/**
 * Base directory under which per-execution checkpoint sidecars are stored on
 * the Docker host. Individual sidecar directories are nested as
 * `<base>/<workflowRunId>/<jobId>/`. The directory must be accessible from the
 * Docker host, since it is bind-mounted into the execution container.
 *
 * Override by setting `NEXUS_CHECKPOINT_BASE_DIR` in the environment; defaults
 * to `/tmp/nexus-checkpoints` (the container-internal path that docker-compose
 * bind-mounts from `NEXUS_HOST_CHECKPOINT_PATH`).
 */
export function resolveCheckpointBaseDir(): string {
  return (
    process.env['NEXUS_CHECKPOINT_BASE_DIR'] ?? DEFAULT_CHECKPOINT_BASE_DIR
  );
}

/**
 * Returns the host-side directory that holds the `checkpoints.jsonl` sidecar
 * for a given (workflowRunId, jobId) pair.
 *
 * Keying by run + job (rather than executionId) lets the supervisor reconstruct
 * the path from the execution row's `workflow_run_id` and `context_id` columns
 * without an additional DB lookup, and keeps the sidecar stable across retries
 * (executions are superseded, but run + job identity is stable).
 *
 * The bind-mount covers the directory; the harness writes
 * {@link CONTAINER_CHECKPOINT_PATH} (`checkpoints.jsonl`) inside it.
 */
export function checkpointSidecarHostDir(
  baseDir: string,
  workflowRunId: string,
  jobId: string,
): string {
  return path.join(baseDir, workflowRunId, jobId);
}

/**
 * Full host path to the `checkpoints.jsonl` sidecar file for a given
 * (workflowRunId, jobId) pair. Derived from {@link checkpointSidecarHostDir}.
 */
export function checkpointSidecarHostPath(
  baseDir: string,
  workflowRunId: string,
  jobId: string,
): string {
  return path.join(
    checkpointSidecarHostDir(baseDir, workflowRunId, jobId),
    'checkpoints.jsonl',
  );
}

/**
 * Full host path to the `session.jsonl` file written by the PI engine during
 * execution. The PI engine writes continuously to `CONTAINER_SESSION_PATH` which
 * is bind-mounted from the per-(run, job) sidecar directory, so the latest
 * mid-turn state is always available at this path — even after a SIGKILL.
 *
 * Keeping the path convention here (alongside `checkpointSidecarHostPath`)
 * ensures there is a single source of truth for both sidecar files.
 */
export function checkpointSidecarSessionPath(
  baseDir: string,
  workflowRunId: string,
  jobId: string,
): string {
  return path.join(
    checkpointSidecarHostDir(baseDir, workflowRunId, jobId),
    'session.jsonl',
  );
}

export const SESSION_HYDRATION_SERVICE = 'SESSION_HYDRATION_SERVICE';

export interface SessionTreeRecord {
  id: string;
}

export interface ISessionHydrationService {
  saveSessionForWorkflowChat(...args: unknown[]): Promise<unknown>;
  saveSessionFromExitedContainer(...args: unknown[]): Promise<unknown>;
  dehydrateSession(containerId: string, workflowRunId: string): Promise<string>;
  findSessionTreeByWorkflowRunId(
    workflowRunId: string,
  ): Promise<SessionTreeRecord | null>;
  /**
   * Validates, secret-scans, compresses, and persists a raw JSONL string into
   * the session tree store. Used on the reap path where the PI engine writes
   * session.jsonl to the bind-mounted sidecar dir on the Docker host.
   *
   * @param options.containerTier - Stored container tier (1=LIGHT, 2=HEAVY).
   *   When provided, overrides the LIGHT default that applies when no containerId
   *   is available. Pass the reaped execution row's container_tier so HEAVY PI
   *   sessions are resumed on the correct image.
   */
  saveSessionFromJsonl(
    jsonlString: string,
    ownerRef: { workflow_run_id?: string; chat_session_id?: string },
    options?: { containerTier?: number },
  ): Promise<string>;
}

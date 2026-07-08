import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  createSessionCheckpointDebouncer,
  persistSessionCheckpointImpl,
  type PersistSessionCheckpoint,
  type ShouldPersistSessionCheckpoint,
} from './telemetry-gateway-session-checkpoint.helpers';
import { SESSION_HYDRATION_SERVICE } from '../shared/interfaces/session-hydration.interface';
import type { ISessionHydrationService } from '../shared/interfaces/session-hydration.interface';

/**
 * Owns per-event session-checkpoint persistence so the runtime gateway
 * never needs to inject `ISessionHydrationService` directly.
 *
 * The debouncer (`shouldPersistSessionCheckpoint`) lives here because it
 * tracks process-local state — sharing it across services would re-introduce
 * the cross-cutting coupling this service exists to remove.
 */
@Injectable()
export class TelemetrySessionCheckpointService {
  private readonly logger = new Logger(TelemetrySessionCheckpointService.name);

  private readonly shouldPersistSessionCheckpoint =
    createSessionCheckpointDebouncer();

  constructor(
    @Optional()
    @Inject(SESSION_HYDRATION_SERVICE)
    private readonly sessionHydration?: ISessionHydrationService,
  ) {}

  /**
   * Returns the runtime debouncer. Bound to this service so callers
   * (`resolveSessionTreeId`) can thread it through without re-binding.
   */
  getShouldPersist(): ShouldPersistSessionCheckpoint {
    return (params) => this.shouldPersistSessionCheckpoint(params);
  }

  /**
   * Persists a session checkpoint for the given (workflowRunId, containerId)
   * pair, preferring the workflow-chat path when a chat session id is present.
   */
  persist(
    params: Parameters<PersistSessionCheckpoint>[0],
  ): Promise<string | undefined> {
    return persistSessionCheckpointImpl(
      params,
      this.sessionHydration,
      this.logger,
    );
  }

  /**
   * Convenience bind that lets the per-event compat helpers accept
   * `persistSessionCheckpoint` as a callback without `.bind(this)` noise at
   * each call site.
   */
  readonly persistBound: PersistSessionCheckpoint = (params) =>
    this.persist(params);
}

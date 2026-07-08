import { Injectable } from '@nestjs/common';
import {
  HealthCheckError,
  HealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { ChatSessionContextService } from '../session/chat-session-context.service';

/**
 * Terminus health indicator for the chat context provider registry.
 *
 * The indicator returns "down" if `ChatSessionContextService.isHealthy()`
 * is false (registry is empty). Wired into `HealthController` so `/health`
 * returns HTTP 503 whenever the built-in providers are missing — see
 * `docs/architecture/memory-management.md` ("Built-in Context Provider
 * Bootstrap") for the fail-loud contract.
 */
@Injectable()
export class ContextProviderHealthIndicator extends HealthIndicator {
  constructor(
    private readonly chatSessionContextService: ChatSessionContextService,
  ) {
    super();
  }

  check(key: string): Promise<HealthIndicatorResult> {
    try {
      // Reuse the service's own assertion so the health-check path
      // exercises the same code that crashes the app at bootstrap.
      this.chatSessionContextService.assertRegistryNonEmpty('health-check');
      return Promise.resolve(this.getStatus(key, true));
    } catch (error) {
      const err = error as Error;
      throw new HealthCheckError(
        `Context provider registry check failed: ${err.message}`,
        this.getStatus(key, false),
      );
    }
  }
}

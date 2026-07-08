import { Injectable } from '@nestjs/common';
import type { IOrchestratorIpResolver } from './execution-dispatch.service.types';

/**
 * Default production implementation of {@link IOrchestratorIpResolver}.
 *
 * Used when the `execution_dispatch_ip_resolver_override` system
 * setting is `default` or unset. Parses the orchestrator URL via the
 * WHATWG URL parser and returns its hostname component (e.g.
 * `orchestrator.local` for `http://orchestrator.local:3000`). Mirrors
 * the inline URL-parse behaviour described in the OPEN_QUESTIONS E1
 * gap and supersedes the `protected resolveIpFromOrchestrator` hook on
 * `ExecutionDispatchService`, which previously returned `undefined` as
 * a placeholder while production wiring was deferred.
 *
 * Stateless: holds no fields and injects no dependencies. The
 * orchestrator URL is validated by the WHATWG parser — malformed input
 * surfaces as a `TypeError` thrown synchronously from `new URL(...)`,
 * which the dispatcher propagates as a resolution failure.
 */
@Injectable()
export class DefaultOrchestratorIpResolver implements IOrchestratorIpResolver {
  resolve(orchestratorUrl: string): Promise<string> {
    const parsed = new URL(orchestratorUrl);
    return Promise.resolve(parsed.hostname);
  }
}

/**
 * Typed error used by the `HonchoClientService` transport layer
 * when a wire-shape field on the Honcho response violates an
 * expected contract.
 *
 * The class is introduced in work item 1291ad94 milestone 1 (M1)
 * so the segment-normalization helpers that previously lived
 * inline on `HonchoMemoryBackendService.normalizeSegments` can be
 * relocated onto `HonchoClientService` (the transport layer)
 * without losing the ability to surface contract drift as a
 * typed exception. Milestone 3 (M3) will rewire the backend to
 * honour the configured policy (`throw` raises this; `history`
 * and `log-then-history` swallow it).
 *
 * The class follows the established project convention for typed
 * errors in `apps/api/src` (see
 * `apps/api/src/common/errors/bulk-action.error.ts`,
 * `apps/api/src/gitops/gitops-credentials-resolver.service.ts`,
 * and `apps/api/src/harness/import/source-fetcher.ts`):
 *
 *   - extends `Error` directly,
 *   - assigns a distinct `name` so `err.name === 'HonchoTransportContractError'`
 *     is a stable predicate for callers and exception filters,
 *   - carries typed readonly fields for the minimum information an
 *     operator needs to triage the drift (the offending wire field).
 *
 * The class is additive — `HonchoClientService` does NOT throw this
 * by default. It exists so a future caller (or test) can opt into
 * the `'throw'` policy without a second error class.
 */
export class HonchoTransportContractError extends Error {
  /**
   * The wire-shape field that triggered the failure. Always a
   * camelCase or snake_case identifier matching the field name on
   * the offending Honcho response payload
   * (e.g. `'memory_type'`, `'content'`, `'id'`). The value is
   * stable so consumers can switch on it for routing or alerting.
   */
  public readonly field: string;

  constructor(field: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'HonchoTransportContractError';
    this.field = field;

    // Restore the prototype chain after the `super(message)` call
    // has been made. Without this, `instanceof HonchoTransportContractError`
    // would fail when the class is down-compiled to ES5 targets —
    // a guard the related typed errors in this codebase don't need
    // today (those targets are ES2022+) but which keeps the class
    // portable for future build targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

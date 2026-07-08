import { describe, it, expect, vi } from 'vitest';
import { OAuthInstrumentation } from './oauth-instrumentation';
import type { MetricsService } from '../observability/metrics.service';

/**
 * Build a fresh `MetricsService` mock for each test. The mock
 * exposes only the single mutator the helper touches —
 * `recordOAuthLoginOrphaned` — paired 1:1 with the
 * `oauthMetrics` spy in
 * `apps/api/src/oauth/oauth-login.service.spec-helpers.ts`.
 *
 * Mirrors the prom-metrics mock factory shape used by
 * `apps/api/src/memory/backend-instrumentation.spec.ts` (search
 * for `createPromMetricsMock`); kept in this file rather than
 * imported because the OAuth helper has a narrower surface
 * (one mutator today) and the mock should reflect that.
 */
function createPromMetricsMock(): {
  recordOAuthLoginOrphaned: ReturnType<typeof vi.fn>;
} {
  return {
    recordOAuthLoginOrphaned: vi.fn(),
  };
}

/**
 * Build a fresh `OAuthInstrumentation` helper wired to a fresh
 * `MetricsService` mock. Each test gets its own mock so call
 * counts are scoped per test (no leakage between `it` blocks).
 */
function createHelper(): {
  helper: OAuthInstrumentation;
  promMetrics: ReturnType<typeof createPromMetricsMock>;
} {
  const promMetrics = createPromMetricsMock();
  const helper = new OAuthInstrumentation(
    promMetrics as unknown as MetricsService,
  );
  return { helper, promMetrics };
}

describe('OAuthInstrumentation', () => {
  describe('recordOAuthLoginOrphaned', () => {
    it('increments the orphan-recovery counter on the prom-client mirror exactly once per call', () => {
      const { helper, promMetrics } = createHelper();

      helper.recordOAuthLoginOrphaned();

      expect(promMetrics.recordOAuthLoginOrphaned).toHaveBeenCalledTimes(1);
      // The mutator is invoked with no arguments; the orphan-
      // recovery counter is unlabelled (single global series).
      expect(promMetrics.recordOAuthLoginOrphaned).toHaveBeenCalledWith();
    });

    it('increments the counter N times across N calls (no deduplication)', () => {
      const { helper, promMetrics } = createHelper();

      for (let i = 0; i < 5; i += 1) {
        helper.recordOAuthLoginOrphaned();
      }

      expect(promMetrics.recordOAuthLoginOrphaned).toHaveBeenCalledTimes(5);
    });

    it('never throws when the metrics mutator throws (non-throwing contract)', () => {
      // The orphan-recovery path in `oauth-login.service.ts`
      // is load-bearing: a metrics-layer failure MUST NOT abort
      // the `failed` + `DEL` transition. The helper's non-
      // throwing contract is the structural guarantee that
      // mirrors the `recordBackend*` shape documented in
      // `docs/architecture/decisions/ADR-backend-instrumentation-helper-extraction.md`.
      const promMetrics = {
        recordOAuthLoginOrphaned: vi.fn(() => {
          throw new Error('prom-client registry unavailable');
        }),
      };
      const helper = new OAuthInstrumentation(
        promMetrics as unknown as MetricsService,
      );

      // No exception escapes the helper. If this throws, the
      // non-throwing contract is violated and the orphan-
      // recovery path could break in production.
      expect(() => {
        helper.recordOAuthLoginOrphaned();
      }).not.toThrow();
      expect(promMetrics.recordOAuthLoginOrphaned).toHaveBeenCalledTimes(1);
    });

    it('still increments the counter for subsequent calls after a previous call swallowed a metrics failure', () => {
      // First-call failure must not poison the helper for
      // future calls — each call is independent so the
      // counter resumes normal behaviour once the registry is
      // healthy again.
      const recordSpy = vi
        .fn<() => void>()
        .mockImplementationOnce(() => {
          throw new Error('first-call failure');
        })
        .mockImplementation(() => undefined);
      const promMetrics = {
        recordOAuthLoginOrphaned: recordSpy,
      };
      const helper = new OAuthInstrumentation(
        promMetrics as unknown as MetricsService,
      );

      expect(() => {
        helper.recordOAuthLoginOrphaned();
      }).not.toThrow();
      expect(() => {
        helper.recordOAuthLoginOrphaned();
      }).not.toThrow();

      expect(promMetrics.recordOAuthLoginOrphaned).toHaveBeenCalledTimes(2);
    });
  });
});

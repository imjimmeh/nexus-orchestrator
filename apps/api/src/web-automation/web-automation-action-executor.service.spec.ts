import { describe, expect, it, vi } from 'vitest';
import type {
  IBrowserAutomationPolicy,
  IBrowserSelectorTrace,
} from '@nexus/core';
import { WebAutomationActionExecutorService } from './web-automation-action-executor.service';
import { WebAutomationActionRunnerService } from './web-automation-action-runner.service';
import { WebAutomationFailureArtifactService } from './web-automation-failure-artifact.service';
import { WebAutomationPolicyService } from './web-automation-policy.service';
import { WebAutomationRequestParserService } from './web-automation-request-parser.service';
import { WebAutomationSelectorResolverService } from './web-automation-selector-resolver.service';
import { WebAutomationSessionStoreService } from './web-automation-session-store.service';
import type { BrowserAutomationResolvedRequest } from './web-automation.types';

function createPolicy(overrides: Partial<IBrowserAutomationPolicy> = {}) {
  return {
    timeout_ms: 1_000,
    retry_budget: 2,
    backoff_initial_ms: 0,
    backoff_factor: 1,
    backoff_max_ms: 0,
    pacing_ms: 0,
    ...overrides,
  } satisfies IBrowserAutomationPolicy;
}

function createRequest(): BrowserAutomationResolvedRequest {
  return {
    action: 'click',
    session_id: 'default',
    selector: '#submit',
  };
}

function createSelectorTrace(): IBrowserSelectorTrace {
  return {
    candidates: [
      {
        selector: '#submit',
        source: 'explicit',
        reason: 'inputs.selector',
        rank: 1,
      },
    ],
    attempted_selectors: [],
  };
}

describe('WebAutomationActionExecutorService retry behavior', () => {
  it('retries flaky actions and succeeds within retry budget', async () => {
    const actionRunner = {
      runAttempt: vi
        .fn()
        .mockRejectedValueOnce(new Error('Temporary timeout'))
        .mockResolvedValueOnce({
          current_url: 'https://example.com',
          selector: '#submit',
          selector_source: 'explicit',
        }),
    };

    const failureArtifacts = {
      captureFailureArtifact: vi.fn(),
    };

    const policyService = {
      resolvePolicy: vi.fn().mockReturnValue(createPolicy({ retry_budget: 2 })),
      computeBackoffDelayMs: vi.fn().mockReturnValue(0),
    };

    const requestParser = {
      resolveRequest: vi.fn().mockReturnValue(createRequest()),
      waitForUsesSelector: vi.fn().mockReturnValue(true),
    };

    const selectorResolver = {
      resolve: vi.fn().mockReturnValue(createSelectorTrace()),
    };

    const sessionStore = {
      getSession: vi.fn().mockReturnValue(null),
    };

    const service = new WebAutomationActionExecutorService(
      actionRunner as unknown as WebAutomationActionRunnerService,
      failureArtifacts as unknown as WebAutomationFailureArtifactService,
      policyService as unknown as WebAutomationPolicyService,
      requestParser as unknown as WebAutomationRequestParserService,
      selectorResolver as unknown as WebAutomationSelectorResolverService,
      sessionStore as unknown as WebAutomationSessionStoreService,
    );

    const result = await service.execute({
      workflowRunId: 'run-1',
      stepId: 'step-1',
      inputs: {
        action: 'click',
        selector: '#submit',
      },
    });

    expect(result.ok).toBe(true);
    expect(actionRunner.runAttempt).toHaveBeenCalledTimes(2);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]?.success).toBe(false);
    expect(result.attempts[1]?.success).toBe(true);
    expect(policyService.computeBackoffDelayMs).toHaveBeenCalledTimes(1);
    expect(policyService.computeBackoffDelayMs).toHaveBeenCalledWith(
      expect.objectContaining({ retry_budget: 2 }),
      1,
    );
    expect(failureArtifacts.captureFailureArtifact).not.toHaveBeenCalled();
  });
});

describe('WebAutomationActionExecutorService selector resolution failures', () => {
  it('captures failure artifact when selector resolution fails before attempt execution', async () => {
    const actionRunner = {
      runAttempt: vi.fn(),
    };

    const failureArtifacts = {
      captureFailureArtifact: vi.fn().mockResolvedValue({ id: 'artifact-2' }),
    };

    const policyService = {
      resolvePolicy: vi.fn().mockReturnValue(createPolicy({ retry_budget: 1 })),
      computeBackoffDelayMs: vi.fn().mockReturnValue(0),
    };

    const requestParser = {
      resolveRequest: vi.fn().mockReturnValue(createRequest()),
      waitForUsesSelector: vi.fn().mockReturnValue(true),
    };

    const selectorResolver = {
      resolve: vi.fn().mockReturnValue({
        candidates: [],
        attempted_selectors: [],
      }),
    };

    const sessionStore = {
      getSession: vi.fn().mockReturnValue(null),
    };

    const service = new WebAutomationActionExecutorService(
      actionRunner as unknown as WebAutomationActionRunnerService,
      failureArtifacts as unknown as WebAutomationFailureArtifactService,
      policyService as unknown as WebAutomationPolicyService,
      requestParser as unknown as WebAutomationRequestParserService,
      selectorResolver as unknown as WebAutomationSelectorResolverService,
      sessionStore as unknown as WebAutomationSessionStoreService,
    );

    const result = await service.execute({
      workflowRunId: 'run-3',
      stepId: 'step-3',
      inputs: {
        action: 'click',
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected selector resolution failure');
    }
    expect(result.failure_artifact_id).toBe('artifact-2');
    expect(result.attempts).toHaveLength(0);
    expect(actionRunner.runAttempt).not.toHaveBeenCalled();
    expect(failureArtifacts.captureFailureArtifact).toHaveBeenCalledTimes(1);
  });
});

describe('WebAutomationActionExecutorService exhausted retries', () => {
  it('captures failure artifact when retries are exhausted', async () => {
    const actionRunner = {
      runAttempt: vi
        .fn()
        .mockRejectedValue(new Error('Element never appeared')),
    };

    const failureArtifacts = {
      captureFailureArtifact: vi.fn().mockResolvedValue({ id: 'artifact-1' }),
    };

    const policyService = {
      resolvePolicy: vi.fn().mockReturnValue(createPolicy({ retry_budget: 1 })),
      computeBackoffDelayMs: vi.fn().mockReturnValue(0),
    };

    const requestParser = {
      resolveRequest: vi.fn().mockReturnValue(createRequest()),
      waitForUsesSelector: vi.fn().mockReturnValue(true),
    };

    const selectorResolver = {
      resolve: vi.fn().mockReturnValue(createSelectorTrace()),
    };

    const sessionStore = {
      getSession: vi.fn().mockReturnValue(null),
    };

    const service = new WebAutomationActionExecutorService(
      actionRunner as unknown as WebAutomationActionRunnerService,
      failureArtifacts as unknown as WebAutomationFailureArtifactService,
      policyService as unknown as WebAutomationPolicyService,
      requestParser as unknown as WebAutomationRequestParserService,
      selectorResolver as unknown as WebAutomationSelectorResolverService,
      sessionStore as unknown as WebAutomationSessionStoreService,
    );

    const result = await service.execute({
      workflowRunId: 'run-2',
      stepId: 'step-2',
      inputs: {
        action: 'click',
        selector: '#submit',
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected retries-exhausted failure');
    }
    expect(result.failure_artifact_id).toBe('artifact-1');
    expect(result.attempts).toHaveLength(2);
    expect(failureArtifacts.captureFailureArtifact).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from 'vitest';
import type {
  IBrowserAutomationPolicy,
  IBrowserSelectorTrace,
} from '@nexus/core';
import { WebAutomationActionRunnerService } from './web-automation-action-runner.service';
import type {
  BrowserAutomationExecutionContext,
  BrowserAutomationResolvedRequest,
} from './web-automation.types';
import { WebAutomationSessionStoreService } from './web-automation-session-store.service';

function createPolicy(overrides: Partial<IBrowserAutomationPolicy> = {}) {
  return {
    timeout_ms: 1_000,
    retry_budget: 1,
    backoff_initial_ms: 0,
    backoff_factor: 1,
    backoff_max_ms: 0,
    pacing_ms: 0,
    ...overrides,
  } satisfies IBrowserAutomationPolicy;
}

function createContext(): BrowserAutomationExecutionContext {
  return {
    workflowRunId: 'run-1',
    stepId: 'step-1',
    inputs: {},
  };
}

describe('WebAutomationActionRunnerService', () => {
  it('falls back to the next selector candidate when the first one fails', async () => {
    const clickMock = vi.fn(async (selector: string) => {
      if (selector === '#missing-button') {
        throw new Error('Element not found');
      }
    });

    const sessionStore = {
      openSession: vi.fn(),
      getSession: vi.fn().mockReturnValue({
        id: 'default',
        page: {
          goto: vi.fn(),
          click: clickMock,
          fill: vi.fn(),
          waitForSelector: vi.fn(),
          waitForLoadState: vi.fn(),
          waitForTimeout: vi.fn(),
          content: vi.fn().mockResolvedValue('<html></html>'),
          title: vi.fn().mockResolvedValue('Page'),
          url: vi.fn().mockReturnValue('https://example.com/form'),
          screenshot: vi.fn(),
        },
      }),
    };

    const service = new WebAutomationActionRunnerService(
      sessionStore as unknown as WebAutomationSessionStoreService,
    );

    const request: BrowserAutomationResolvedRequest = {
      action: 'click',
      session_id: 'default',
      selector_alias: 'primary_button',
    };

    const selectorTrace: IBrowserSelectorTrace = {
      candidates: [
        {
          selector: '#missing-button',
          source: 'explicit',
          reason: 'inputs.selector',
          rank: 1,
        },
        {
          selector: '#submit-button',
          source: 'alias',
          reason: 'selector_alias:primary_button',
          rank: 2,
        },
      ],
      attempted_selectors: [],
    };

    const result = await service.runAttempt(
      createContext(),
      request,
      createPolicy(),
      selectorTrace,
    );

    expect(clickMock).toHaveBeenCalledTimes(2);
    expect(result.selector).toBe('#submit-button');
    expect(result.selector_source).toBe('alias');
    expect(selectorTrace.attempted_selectors).toEqual([
      '#missing-button',
      '#submit-button',
    ]);
    expect(selectorTrace.selected_selector).toBe('#submit-button');
  });
});

import { Injectable } from '@nestjs/common';
import type {
  BrowserAutomationActionType,
  BrowserAutomationSelectorSource,
  BrowserAutomationWaitState,
  IBrowserAutomationPolicy,
  IBrowserSelectorTrace,
} from '@nexus/core';
import { WebAutomationSessionStoreService } from './web-automation-session-store.service';
import type {
  BrowserAutomationExecutionContext,
  BrowserAutomationLoadState,
  BrowserAutomationResolvedRequest,
  BrowserAutomationSelectorWaitState,
  BrowserAutomationSession,
  BrowserAutomationSuccessDetails,
} from './web-automation.types';

@Injectable()
export class WebAutomationActionRunnerService {
  constructor(
    private readonly sessionStore: WebAutomationSessionStoreService,
  ) {}

  async runAttempt(
    context: BrowserAutomationExecutionContext,
    request: BrowserAutomationResolvedRequest,
    policy: IBrowserAutomationPolicy,
    selectorTrace: IBrowserSelectorTrace | undefined,
  ): Promise<BrowserAutomationSuccessDetails> {
    switch (request.action) {
      case 'open_page':
        return this.executeOpenPage(context.workflowRunId, request, policy);
      case 'navigate':
        return this.executeNavigate(context, request, policy);
      case 'click':
        return this.executeClick(context, request, policy, selectorTrace);
      case 'type':
        return this.executeType(context, request, policy, selectorTrace);
      case 'wait_for':
        return this.executeWaitFor(context, request, policy, selectorTrace);
      case 'read_page':
        return this.executeReadPage(context, request);
      case 'screenshot':
        return this.executeScreenshot(context, request);
      default:
        throw new Error(
          `Step ${context.stepId}: unsupported web_automation action '${request.action}'`,
        );
    }
  }

  private async executeOpenPage(
    workflowRunId: string,
    request: BrowserAutomationResolvedRequest,
    policy: IBrowserAutomationPolicy,
  ): Promise<BrowserAutomationSuccessDetails> {
    const session = await this.sessionStore.openSession(
      workflowRunId,
      request.session_id,
    );

    if (request.url) {
      await session.page.goto(request.url, {
        timeout: policy.timeout_ms,
        waitUntil: 'load',
      });
    }

    return {
      current_url: session.page.url(),
    };
  }

  private async executeNavigate(
    context: BrowserAutomationExecutionContext,
    request: BrowserAutomationResolvedRequest,
    policy: IBrowserAutomationPolicy,
  ): Promise<BrowserAutomationSuccessDetails> {
    const url = this.requireString(request.url, context.stepId, 'inputs.url');
    const session = this.requireSession(
      context,
      request.session_id,
      request.action,
    );

    await session.page.goto(url, {
      timeout: policy.timeout_ms,
      waitUntil: this.resolveLoadState(request.wait_for),
    });

    return {
      current_url: session.page.url(),
    };
  }

  private async executeClick(
    context: BrowserAutomationExecutionContext,
    request: BrowserAutomationResolvedRequest,
    policy: IBrowserAutomationPolicy,
    selectorTrace: IBrowserSelectorTrace | undefined,
  ): Promise<BrowserAutomationSuccessDetails> {
    const session = this.requireSession(
      context,
      request.session_id,
      request.action,
    );
    const selected = await this.executeSelectorStrategy(
      selectorTrace,
      async (selector) => {
        await session.page.click(selector, {
          timeout: policy.timeout_ms,
        });
      },
    );

    return {
      current_url: session.page.url(),
      selector: selected.selector,
      selector_source: selected.source,
    };
  }

  private async executeType(
    context: BrowserAutomationExecutionContext,
    request: BrowserAutomationResolvedRequest,
    policy: IBrowserAutomationPolicy,
    selectorTrace: IBrowserSelectorTrace | undefined,
  ): Promise<BrowserAutomationSuccessDetails> {
    const text = this.requireString(
      request.text,
      context.stepId,
      'inputs.text',
    );
    const session = this.requireSession(
      context,
      request.session_id,
      request.action,
    );
    const selected = await this.executeSelectorStrategy(
      selectorTrace,
      async (selector) => {
        await session.page.fill(selector, text, {
          timeout: policy.timeout_ms,
        });
      },
    );

    return {
      current_url: session.page.url(),
      selector: selected.selector,
      selector_source: selected.source,
    };
  }

  private async executeWaitFor(
    context: BrowserAutomationExecutionContext,
    request: BrowserAutomationResolvedRequest,
    policy: IBrowserAutomationPolicy,
    selectorTrace: IBrowserSelectorTrace | undefined,
  ): Promise<BrowserAutomationSuccessDetails> {
    const session = this.requireSession(
      context,
      request.session_id,
      request.action,
    );

    const loadState = this.toLoadState(request.wait_for);
    if (loadState) {
      await session.page.waitForLoadState(loadState, {
        timeout: policy.timeout_ms,
      });

      return {
        current_url: session.page.url(),
        waited_for: `load_state:${loadState}`,
      };
    }

    if (request.duration_ms && request.duration_ms > 0) {
      await session.page.waitForTimeout(request.duration_ms);
      return {
        current_url: session.page.url(),
        waited_for: `duration_ms:${request.duration_ms}`,
      };
    }

    const waitState = this.resolveSelectorWaitState(request);
    const selected = await this.executeSelectorStrategy(
      selectorTrace,
      async (selector) => {
        await session.page.waitForSelector(selector, {
          timeout: policy.timeout_ms,
          state: waitState,
        });
      },
    );

    return {
      current_url: session.page.url(),
      waited_for: `selector:${waitState}`,
      selector: selected.selector,
      selector_source: selected.source,
    };
  }

  private async executeReadPage(
    context: BrowserAutomationExecutionContext,
    request: BrowserAutomationResolvedRequest,
  ): Promise<BrowserAutomationSuccessDetails> {
    const session = this.requireSession(
      context,
      request.session_id,
      request.action,
    );

    const html = await session.page.content();
    const title = await session.page.title();

    return {
      current_url: session.page.url(),
      html,
      title,
    };
  }

  private async executeScreenshot(
    context: BrowserAutomationExecutionContext,
    request: BrowserAutomationResolvedRequest,
  ): Promise<BrowserAutomationSuccessDetails> {
    const session = this.requireSession(
      context,
      request.session_id,
      request.action,
    );
    const image = await session.page.screenshot({
      fullPage: request.full_page ?? true,
      type: 'png',
    });

    return {
      current_url: session.page.url(),
      screenshot_base64: image.toString('base64'),
    };
  }

  private async executeSelectorStrategy(
    selectorTrace: IBrowserSelectorTrace | undefined,
    operation: (selector: string) => Promise<void>,
  ): Promise<{ selector: string; source: BrowserAutomationSelectorSource }> {
    if (!selectorTrace || selectorTrace.candidates.length === 0) {
      throw new Error(
        'Selector strategy did not produce any candidate selectors',
      );
    }

    let lastError: Error | null = null;

    for (const candidate of selectorTrace.candidates) {
      selectorTrace.attempted_selectors.push(candidate.selector);

      try {
        await operation(candidate.selector);
        selectorTrace.selected_selector = candidate.selector;
        selectorTrace.selected_source = candidate.source;

        return {
          selector: candidate.selector,
          source: candidate.source,
        };
      } catch (error) {
        lastError = this.toError(error);
      }
    }

    throw (
      lastError ??
      new Error('Selector strategy exhausted all candidates without success')
    );
  }

  private requireSession(
    context: BrowserAutomationExecutionContext,
    sessionId: string,
    action: BrowserAutomationActionType,
  ): BrowserAutomationSession {
    const session = this.sessionStore.getSession(
      context.workflowRunId,
      sessionId,
    );
    if (!session) {
      throw new Error(
        `Step ${context.stepId}: web_automation action '${action}' requires an existing session '${sessionId}'. Run open_page first.`,
      );
    }

    return session;
  }

  private resolveLoadState(
    waitState: BrowserAutomationWaitState | undefined,
  ): BrowserAutomationLoadState {
    return this.toLoadState(waitState) ?? 'load';
  }

  private toLoadState(
    waitState: BrowserAutomationWaitState | undefined,
  ): BrowserAutomationLoadState | undefined {
    if (
      waitState === 'load' ||
      waitState === 'domcontentloaded' ||
      waitState === 'networkidle'
    ) {
      return waitState;
    }

    return undefined;
  }

  private resolveSelectorWaitState(
    request: BrowserAutomationResolvedRequest,
  ): BrowserAutomationSelectorWaitState {
    const waitState = request.wait_state ?? request.wait_for;

    if (
      waitState === 'attached' ||
      waitState === 'detached' ||
      waitState === 'visible' ||
      waitState === 'hidden'
    ) {
      return waitState;
    }

    return 'visible';
  }

  private requireString(
    value: string | undefined,
    stepId: string,
    field: string,
  ): string {
    if (!value) {
      throw new Error(`Step ${stepId}: web_automation requires ${field}`);
    }

    return value;
  }

  private toError(error: unknown): Error {
    if (error instanceof Error) {
      return error;
    }

    if (typeof error === 'string') {
      return new Error(error);
    }

    try {
      return new Error(JSON.stringify(error));
    } catch {
      return new Error('Unknown web automation error');
    }
  }
}

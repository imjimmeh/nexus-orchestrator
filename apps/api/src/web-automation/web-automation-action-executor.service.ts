import { Injectable } from '@nestjs/common';
import type {
  IBrowserAutomationAttemptTrace,
  IBrowserAutomationPolicy,
  IBrowserSelectorTrace,
} from '@nexus/core';
import { WebAutomationActionRunnerService } from './web-automation-action-runner.service';
import { WebAutomationFailureArtifactService } from './web-automation-failure-artifact.service';
import { WebAutomationPolicyService } from './web-automation-policy.service';
import { WebAutomationRequestParserService } from './web-automation-request-parser.service';
import { WebAutomationSelectorResolverService } from './web-automation-selector-resolver.service';
import { WebAutomationSessionStoreService } from './web-automation-session-store.service';
import type {
  BrowserAutomationActionOutcome,
  BrowserAutomationExecutionContext,
  BrowserAutomationResolvedRequest,
  BrowserAutomationSuccessDetails,
} from './web-automation.types';

@Injectable()
export class WebAutomationActionExecutorService {
  constructor(
    private readonly actionRunner: WebAutomationActionRunnerService,
    private readonly failureArtifacts: WebAutomationFailureArtifactService,
    private readonly policyService: WebAutomationPolicyService,
    private readonly requestParser: WebAutomationRequestParserService,
    private readonly selectorResolver: WebAutomationSelectorResolverService,
    private readonly sessionStore: WebAutomationSessionStoreService,
  ) {}

  async execute(
    context: BrowserAutomationExecutionContext,
  ): Promise<BrowserAutomationActionOutcome> {
    const request = this.requestParser.resolveRequest(context);
    const policy = this.policyService.resolvePolicy(request);
    const attempts: IBrowserAutomationAttemptTrace[] = [];
    const startedAtMs = Date.now();
    let selectorTrace: IBrowserSelectorTrace | undefined;

    try {
      selectorTrace = this.resolveSelectorTrace(request);
      const successDetails = await this.executeWithRetries(
        context,
        request,
        policy,
        selectorTrace,
        attempts,
      );

      return {
        ok: true,
        action: request.action,
        session_id: request.session_id,
        attempts,
        selector_trace: selectorTrace,
        ...successDetails,
      };
    } catch (error) {
      const errorMessage = this.toError(error).message;
      const session = this.sessionStore.getSession(
        context.workflowRunId,
        request.session_id,
      );
      const artifact = await this.failureArtifacts.captureFailureArtifact({
        workflowRunId: context.workflowRunId,
        stepId: context.stepId,
        action: request.action,
        inputs: context.inputs,
        selectorTrace,
        attempts,
        errorMessage,
        startedAtMs,
        session: session ?? undefined,
      });

      return {
        ok: false,
        action: request.action,
        session_id: request.session_id,
        error: errorMessage,
        failure_artifact_id: artifact.id,
        attempts,
        selector_trace: selectorTrace,
      };
    }
  }

  private resolveSelectorTrace(
    request: BrowserAutomationResolvedRequest,
  ): IBrowserSelectorTrace | undefined {
    const shouldResolveSelector =
      request.action === 'click' ||
      request.action === 'type' ||
      (request.action === 'wait_for' &&
        this.requestParser.waitForUsesSelector(request));

    if (!shouldResolveSelector) {
      return undefined;
    }

    const selectorTrace = this.selectorResolver.resolve(request);
    if (selectorTrace.candidates.length === 0) {
      throw new Error(
        `web_automation action '${request.action}' requires a selector strategy (selector, alias, or heuristics)`,
      );
    }

    return selectorTrace;
  }

  private async executeWithRetries(
    context: BrowserAutomationExecutionContext,
    request: BrowserAutomationResolvedRequest,
    policy: IBrowserAutomationPolicy,
    selectorTrace: IBrowserSelectorTrace | undefined,
    attempts: IBrowserAutomationAttemptTrace[],
  ): Promise<BrowserAutomationSuccessDetails> {
    const totalAttempts = policy.retry_budget + 1;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
      const startedAt = Date.now();

      try {
        if (attempt > 1 && policy.pacing_ms > 0) {
          await this.delay(policy.pacing_ms);
        }

        const result = await this.actionRunner.runAttempt(
          context,
          request,
          policy,
          selectorTrace,
        );

        attempts.push(
          this.createAttemptTrace({
            attempt,
            startedAt,
            success: true,
            selector: result.selector,
            selectorSource: result.selector_source,
          }),
        );

        return result;
      } catch (error) {
        const normalizedError = this.toError(error);
        lastError = normalizedError;

        attempts.push(
          this.createAttemptTrace({
            attempt,
            startedAt,
            success: false,
            errorMessage: normalizedError.message,
          }),
        );

        if (attempt >= totalAttempts) {
          break;
        }

        const backoffDelay = this.policyService.computeBackoffDelayMs(
          policy,
          attempt,
        );
        if (backoffDelay > 0) {
          await this.delay(backoffDelay);
        }
      }
    }

    throw (
      lastError ?? new Error(`Step ${context.stepId}: web_automation failed`)
    );
  }

  private createAttemptTrace(params: {
    attempt: number;
    startedAt: number;
    success: boolean;
    selector?: string;
    selectorSource?: 'explicit' | 'alias' | 'heuristic';
    errorMessage?: string;
  }): IBrowserAutomationAttemptTrace {
    const finishedAt = Date.now();

    return {
      attempt: params.attempt,
      started_at: new Date(params.startedAt).toISOString(),
      finished_at: new Date(finishedAt).toISOString(),
      duration_ms: Math.max(finishedAt - params.startedAt, 0),
      success: params.success,
      selector: params.selector ?? null,
      selector_source: params.selectorSource ?? null,
      error_message: params.errorMessage ?? null,
    };
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

  private async delay(durationMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, durationMs);
    });
  }
}

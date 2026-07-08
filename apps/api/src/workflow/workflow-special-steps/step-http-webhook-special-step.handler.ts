import { Injectable, Logger, Optional } from '@nestjs/common';
import { getErrorMessage } from '@nexus/core';
import {
  asRecord,
  isAllowedByPatterns,
  requireNonEmptyString,
  requireStringArray,
  resolveTimeoutMs,
  withTimeout,
} from './special-step-policy.helpers';
import { SpecialStepAuditPublisher } from './special-step-audit.publisher';
import {
  ISpecialStepHandler,
  SpecialStepExecutionContext,
  SpecialStepHandlerResult,
} from './step-special-step.types';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_METHOD = 'POST';
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class StepHttpWebhookSpecialStepHandler implements ISpecialStepHandler {
  readonly type = 'http_webhook' as const;
  readonly descriptor = {
    type: this.type,
    owningDomain: 'core',
    inputContract: 'inputs.url + inputs.policy.allowed_urls',
  } as const;

  private readonly logger = new Logger(StepHttpWebhookSpecialStepHandler.name);

  constructor(
    private readonly auditPublisher: SpecialStepAuditPublisher,
    @Optional() private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async execute({
    workflowRunId,
    stepId,
    resolvedStepInputs,
  }: SpecialStepExecutionContext): Promise<SpecialStepHandlerResult> {
    const url = requireNonEmptyString(
      resolvedStepInputs,
      'url',
      stepId,
      this.type,
    );
    const method = this.resolveMethod(resolvedStepInputs, stepId);
    const policy = asRecord(resolvedStepInputs.policy);
    const allowedUrls = requireStringArray(
      policy,
      'allowed_urls',
      stepId,
      this.type,
    );
    const allowedMethods = this.resolveAllowedMethods(policy);

    if (!isAllowedByPatterns(url, allowedUrls)) {
      const message = `Step ${stepId}: http_webhook URL '${url}' is not allowed by policy`;
      await this.auditPublisher.audit({
        type: this.type,
        outcome: 'blocked',
        workflowRunId,
        stepId,
        payload: { method, url },
        errorMessage: message,
      });
      throw new Error(message);
    }

    if (!allowedMethods.has(method)) {
      const message = `Step ${stepId}: http_webhook method '${method}' is not allowed by policy`;
      await this.auditPublisher.audit({
        type: this.type,
        outcome: 'blocked',
        workflowRunId,
        stepId,
        payload: { method, url },
        errorMessage: message,
      });
      throw new Error(message);
    }

    const timeoutMs = resolveTimeoutMs(
      resolvedStepInputs,
      DEFAULT_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    );

    try {
      const response = await withTimeout(
        this.fetchImpl(url, this.buildRequestInit(resolvedStepInputs, method)),
        timeoutMs,
        `http_webhook timed out after ${timeoutMs}ms`,
      );
      const bodyText = await response.text();
      const responseJson = this.parseJsonBody(bodyText, response.headers);
      const output = {
        ok: response.ok,
        stepId,
        method,
        url,
        status_code: response.status,
        response_text: bodyText,
        ...(responseJson === undefined ? {} : { response_json: responseJson }),
        timed_out: false,
      };

      await this.auditPublisher.audit({
        type: this.type,
        outcome: response.ok ? 'succeeded' : 'failed',
        workflowRunId,
        stepId,
        payload: { method, url },
        ...(response.ok ? {} : { errorMessage: `HTTP ${response.status}` }),
      });
      this.logger.log(
        `http_webhook [${stepId}]: ${method} ${url} -> ${response.status}`,
      );

      return {
        result: {
          status: 'completed',
          mode: 'http_webhook',
          method,
          statusCode: response.status,
        },
        output,
      };
    } catch (error) {
      const message = getErrorMessage(error);
      const timedOut = message.includes('timed out');
      await this.auditPublisher.audit({
        type: this.type,
        outcome: 'failed',
        workflowRunId,
        stepId,
        payload: { method, url },
        errorMessage: message,
      });
      this.logger.warn(`http_webhook [${stepId}]: ${message}`);

      return {
        result: {
          status: 'completed',
          mode: 'http_webhook',
          method,
        },
        output: {
          ok: false,
          stepId,
          method,
          url,
          error: message,
          timed_out: timedOut,
        },
      };
    }
  }

  private resolveMethod(
    inputs: Record<string, unknown>,
    stepId: string,
  ): string {
    const raw = inputs.method;
    const method =
      typeof raw === 'string' && raw.trim().length > 0
        ? raw.trim().toUpperCase()
        : DEFAULT_METHOD;

    if (!ALLOWED_METHODS.has(method)) {
      throw new Error(
        `Step ${stepId}: http_webhook method '${method}' is not supported`,
      );
    }

    return method;
  }

  private resolveAllowedMethods(policy: Record<string, unknown> | undefined) {
    const raw = policy?.allowed_methods;
    if (!Array.isArray(raw)) {
      return ALLOWED_METHODS;
    }

    return new Set(
      raw
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim().toUpperCase())
        .filter((item) => ALLOWED_METHODS.has(item)),
    );
  }

  private buildRequestInit(
    inputs: Record<string, unknown>,
    method: string,
  ): RequestInit {
    const headers = this.resolveHeaders(inputs.headers);
    const body = inputs.body;
    if (body !== undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }

    return {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };
  }

  private resolveHeaders(value: unknown): Headers {
    const headers = new Headers();
    const record = asRecord(value);
    if (!record) {
      return headers;
    }

    for (const [key, headerValue] of Object.entries(record)) {
      if (typeof headerValue === 'string') {
        headers.set(key, headerValue);
      }
    }

    return headers;
  }

  private parseJsonBody(bodyText: string, headers: Headers): unknown {
    if (!headers.get('content-type')?.includes('application/json')) {
      return undefined;
    }

    try {
      return JSON.parse(bodyText) as unknown;
    } catch {
      return undefined;
    }
  }
}

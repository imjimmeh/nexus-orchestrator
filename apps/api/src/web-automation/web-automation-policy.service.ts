import { Injectable } from '@nestjs/common';
import type {
  BrowserAutomationActionType,
  IBrowserAutomationPolicy,
} from '@nexus/core';
import type { BrowserAutomationResolvedRequest } from './web-automation.types';

const DEFAULT_POLICY: IBrowserAutomationPolicy = {
  timeout_ms: 8_000,
  retry_budget: 2,
  backoff_initial_ms: 200,
  backoff_factor: 2,
  backoff_max_ms: 2_000,
  pacing_ms: 100,
};

const ACTION_POLICY_OVERRIDES: Record<
  BrowserAutomationActionType,
  Partial<IBrowserAutomationPolicy>
> = {
  open_page: {
    timeout_ms: 15_000,
    retry_budget: 1,
  },
  navigate: {
    timeout_ms: 15_000,
    retry_budget: 2,
  },
  click: {
    timeout_ms: 8_000,
    retry_budget: 3,
  },
  type: {
    timeout_ms: 8_000,
    retry_budget: 3,
  },
  wait_for: {
    timeout_ms: 10_000,
    retry_budget: 2,
  },
  read_page: {
    timeout_ms: 8_000,
    retry_budget: 1,
  },
  screenshot: {
    timeout_ms: 8_000,
    retry_budget: 1,
  },
};

@Injectable()
export class WebAutomationPolicyService {
  resolvePolicy(
    request: BrowserAutomationResolvedRequest,
  ): IBrowserAutomationPolicy {
    const actionPolicy = ACTION_POLICY_OVERRIDES[request.action] ?? {};
    const nestedPolicy = request.policy ?? {};

    const merged: Partial<IBrowserAutomationPolicy> = {
      ...DEFAULT_POLICY,
      ...actionPolicy,
      ...nestedPolicy,
      timeout_ms: request.timeout_ms ?? nestedPolicy.timeout_ms,
      retry_budget: request.retry_budget ?? nestedPolicy.retry_budget,
      backoff_initial_ms:
        request.backoff_initial_ms ?? nestedPolicy.backoff_initial_ms,
      backoff_factor: request.backoff_factor ?? nestedPolicy.backoff_factor,
      backoff_max_ms: request.backoff_max_ms ?? nestedPolicy.backoff_max_ms,
      pacing_ms: request.pacing_ms ?? nestedPolicy.pacing_ms,
    };

    return {
      timeout_ms: this.toBoundedInteger(
        merged.timeout_ms,
        DEFAULT_POLICY.timeout_ms,
        250,
        120_000,
      ),
      retry_budget: this.toBoundedInteger(
        merged.retry_budget,
        DEFAULT_POLICY.retry_budget,
        0,
        8,
      ),
      backoff_initial_ms: this.toBoundedInteger(
        merged.backoff_initial_ms,
        DEFAULT_POLICY.backoff_initial_ms,
        0,
        10_000,
      ),
      backoff_factor: this.toBoundedNumber(
        merged.backoff_factor,
        DEFAULT_POLICY.backoff_factor,
        1,
        4,
      ),
      backoff_max_ms: this.toBoundedInteger(
        merged.backoff_max_ms,
        DEFAULT_POLICY.backoff_max_ms,
        0,
        30_000,
      ),
      pacing_ms: this.toBoundedInteger(
        merged.pacing_ms,
        DEFAULT_POLICY.pacing_ms,
        0,
        5_000,
      ),
    };
  }

  computeBackoffDelayMs(
    policy: IBrowserAutomationPolicy,
    retryAttempt: number,
  ): number {
    if (retryAttempt <= 0 || policy.backoff_initial_ms <= 0) {
      return 0;
    }

    const exponentialDelay =
      policy.backoff_initial_ms * policy.backoff_factor ** (retryAttempt - 1);

    return Math.min(Math.round(exponentialDelay), policy.backoff_max_ms);
  }

  private toBoundedInteger(
    value: unknown,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const numeric = this.toNumber(value);
    if (numeric === null) {
      return fallback;
    }

    const bounded = Math.min(Math.max(numeric, min), max);
    return Math.round(bounded);
  }

  private toBoundedNumber(
    value: unknown,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const numeric = this.toNumber(value);
    if (numeric === null) {
      return fallback;
    }

    return Math.min(Math.max(numeric, min), max);
  }

  private toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return null;
  }
}

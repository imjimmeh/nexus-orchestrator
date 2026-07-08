import { Injectable } from '@nestjs/common';
import type {
  BrowserAutomationActionType,
  BrowserAutomationWaitState,
} from '@nexus/core';
import type {
  BrowserAutomationExecutionContext,
  BrowserAutomationResolvedRequest,
} from './web-automation.types';

const DEFAULT_SESSION_ID = 'default';

const ACTIONS: ReadonlySet<BrowserAutomationActionType> = new Set([
  'open_page',
  'navigate',
  'click',
  'type',
  'wait_for',
  'read_page',
  'screenshot',
]);

@Injectable()
export class WebAutomationRequestParserService {
  resolveRequest(
    context: BrowserAutomationExecutionContext,
  ): BrowserAutomationResolvedRequest {
    const actionRaw = this.toNonEmptyString(context.inputs.action);
    if (!actionRaw || !this.isActionType(actionRaw)) {
      throw new Error(
        `Step ${context.stepId}: web_automation requires a supported inputs.action`,
      );
    }

    return {
      action: actionRaw,
      session_id:
        this.toNonEmptyString(context.inputs.session_id) ?? DEFAULT_SESSION_ID,
      url: this.toNonEmptyString(context.inputs.url),
      text: this.toNonEmptyString(context.inputs.text),
      selector: this.toNonEmptyString(context.inputs.selector),
      selector_alias: this.toNonEmptyString(context.inputs.selector_alias),
      selector_aliases: this.toSelectorAliasMap(
        context.inputs.selector_aliases,
      ),
      role: this.toNonEmptyString(context.inputs.role),
      name: this.toNonEmptyString(context.inputs.name),
      target_text: this.toNonEmptyString(context.inputs.target_text),
      placeholder: this.toNonEmptyString(context.inputs.placeholder),
      test_id: this.toNonEmptyString(context.inputs.test_id),
      wait_for: this.toWaitState(context.inputs.wait_for),
      wait_state: this.toWaitState(context.inputs.wait_state),
      duration_ms: this.toPositiveInteger(context.inputs.duration_ms),
      full_page: this.toBoolean(context.inputs.full_page),
      policy: this.toPolicyOverride(context.inputs.policy),
      timeout_ms: this.toPositiveInteger(context.inputs.timeout_ms),
      retry_budget: this.toNonNegativeInteger(context.inputs.retry_budget),
      backoff_initial_ms: this.toNonNegativeInteger(
        context.inputs.backoff_initial_ms,
      ),
      backoff_factor: this.toPositiveNumber(context.inputs.backoff_factor),
      backoff_max_ms: this.toNonNegativeInteger(context.inputs.backoff_max_ms),
      pacing_ms: this.toNonNegativeInteger(context.inputs.pacing_ms),
    };
  }

  waitForUsesSelector(request: BrowserAutomationResolvedRequest): boolean {
    return !this.isLoadState(request.wait_for) && !request.duration_ms;
  }

  private toSelectorAliasMap(
    value: unknown,
  ): Record<string, string | string[]> | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const map: Record<string, string | string[]> = {};

    for (const [alias, selectors] of Object.entries(value)) {
      if (typeof selectors === 'string' && selectors.trim().length > 0) {
        map[alias] = selectors;
        continue;
      }

      if (Array.isArray(selectors)) {
        const validSelectors = selectors.filter(
          (entry): entry is string =>
            typeof entry === 'string' && entry.trim().length > 0,
        );
        if (validSelectors.length > 0) {
          map[alias] = validSelectors;
        }
      }
    }

    return Object.keys(map).length > 0 ? map : undefined;
  }

  private toPolicyOverride(
    value: unknown,
  ): BrowserAutomationResolvedRequest['policy'] {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const raw = value as Record<string, unknown>;

    return {
      timeout_ms: this.toPositiveInteger(raw.timeout_ms),
      retry_budget: this.toNonNegativeInteger(raw.retry_budget),
      backoff_initial_ms: this.toNonNegativeInteger(raw.backoff_initial_ms),
      backoff_factor: this.toPositiveNumber(raw.backoff_factor),
      backoff_max_ms: this.toNonNegativeInteger(raw.backoff_max_ms),
      pacing_ms: this.toNonNegativeInteger(raw.pacing_ms),
    };
  }

  private toNonEmptyString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private toPositiveInteger(value: unknown): number | undefined {
    const numeric = this.toNumber(value);
    if (numeric === null || numeric <= 0) {
      return undefined;
    }

    return Math.round(numeric);
  }

  private toNonNegativeInteger(value: unknown): number | undefined {
    const numeric = this.toNumber(value);
    if (numeric === null || numeric < 0) {
      return undefined;
    }

    return Math.round(numeric);
  }

  private toPositiveNumber(value: unknown): number | undefined {
    const numeric = this.toNumber(value);
    if (numeric === null || numeric <= 0) {
      return undefined;
    }

    return numeric;
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

  private toBoolean(value: unknown): boolean | undefined {
    if (typeof value === 'boolean') {
      return value;
    }

    if (value === 'true') {
      return true;
    }

    if (value === 'false') {
      return false;
    }

    return undefined;
  }

  private toWaitState(value: unknown): BrowserAutomationWaitState | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const normalized = value.trim();
    if (
      normalized === 'load' ||
      normalized === 'domcontentloaded' ||
      normalized === 'networkidle' ||
      normalized === 'attached' ||
      normalized === 'detached' ||
      normalized === 'visible' ||
      normalized === 'hidden'
    ) {
      return normalized;
    }

    return undefined;
  }

  private isActionType(value: string): value is BrowserAutomationActionType {
    return ACTIONS.has(value as BrowserAutomationActionType);
  }

  private isLoadState(
    waitState: BrowserAutomationWaitState | undefined,
  ): boolean {
    return (
      waitState === 'load' ||
      waitState === 'domcontentloaded' ||
      waitState === 'networkidle'
    );
  }
}

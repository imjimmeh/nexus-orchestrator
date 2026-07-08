import { Injectable } from '@nestjs/common';
import type {
  IBrowserSelectorCandidate,
  IBrowserSelectorTrace,
} from '@nexus/core';
import type {
  BrowserAutomationAliasMap,
  BrowserAutomationResolvedRequest,
} from './web-automation.types';

const DEFAULT_ALIAS_MAP: BrowserAutomationAliasMap = {
  primary_button: ['button[type="submit"]', 'button:has-text("Submit")'],
  confirm_button: [
    'button:has-text("Confirm")',
    'button:has-text("OK")',
    'button:has-text("Continue")',
  ],
  search_input: [
    'input[type="search"]',
    'input[placeholder*="Search"]',
    '[role="searchbox"]',
  ],
};

@Injectable()
export class WebAutomationSelectorResolverService {
  resolve(request: BrowserAutomationResolvedRequest): IBrowserSelectorTrace {
    const trace: IBrowserSelectorTrace = {
      alias: this.toNonEmptyString(request.selector_alias),
      candidates: [],
      attempted_selectors: [],
    };

    const seenSelectors = new Set<string>();

    this.addCandidate(trace, seenSelectors, {
      selector: this.toNonEmptyString(request.selector),
      source: 'explicit',
      reason: 'inputs.selector',
    });

    this.addAliasCandidates(trace, seenSelectors, request);
    this.addHeuristicCandidates(trace, seenSelectors, request);

    return trace;
  }

  private addAliasCandidates(
    trace: IBrowserSelectorTrace,
    seenSelectors: Set<string>,
    request: BrowserAutomationResolvedRequest,
  ): void {
    const alias = trace.alias;
    if (!alias) {
      return;
    }

    const aliasMap = this.buildAliasMap(request.selector_aliases);
    const selectors = aliasMap[alias] ?? [];

    for (const selector of selectors) {
      this.addCandidate(trace, seenSelectors, {
        selector,
        source: 'alias',
        reason: `selector_alias:${alias}`,
      });
    }
  }

  private addHeuristicCandidates(
    trace: IBrowserSelectorTrace,
    seenSelectors: Set<string>,
    request: BrowserAutomationResolvedRequest,
  ): void {
    const testId = this.toNonEmptyString(request.test_id);
    if (testId) {
      this.addCandidate(trace, seenSelectors, {
        selector: `[data-testid="${this.escapeCss(testId)}"]`,
        source: 'heuristic',
        reason: 'inputs.test_id[data-testid]',
      });
      this.addCandidate(trace, seenSelectors, {
        selector: `[data-test="${this.escapeCss(testId)}"]`,
        source: 'heuristic',
        reason: 'inputs.test_id[data-test]',
      });
    }

    const role = this.toNonEmptyString(request.role);
    const name = this.toNonEmptyString(request.name);
    if (role && name) {
      this.addCandidate(trace, seenSelectors, {
        selector: `role=${role}[name="${this.escapeQuotes(name)}"]`,
        source: 'heuristic',
        reason: 'inputs.role+inputs.name',
      });
    }

    const targetText = this.toNonEmptyString(request.target_text);
    if (targetText) {
      const escapedText = this.escapeQuotes(targetText);
      this.addCandidate(trace, seenSelectors, {
        selector: `text=${targetText}`,
        source: 'heuristic',
        reason: 'inputs.target_text[text=]',
      });
      this.addCandidate(trace, seenSelectors, {
        selector: `button:has-text("${escapedText}")`,
        source: 'heuristic',
        reason: 'inputs.target_text[button]',
      });
      this.addCandidate(trace, seenSelectors, {
        selector: `a:has-text("${escapedText}")`,
        source: 'heuristic',
        reason: 'inputs.target_text[anchor]',
      });
    }

    const placeholder = this.toNonEmptyString(request.placeholder);
    if (placeholder) {
      const escapedPlaceholder = this.escapeCss(placeholder);
      this.addCandidate(trace, seenSelectors, {
        selector: `input[placeholder="${escapedPlaceholder}"]`,
        source: 'heuristic',
        reason: 'inputs.placeholder[input]',
      });
      this.addCandidate(trace, seenSelectors, {
        selector: `textarea[placeholder="${escapedPlaceholder}"]`,
        source: 'heuristic',
        reason: 'inputs.placeholder[textarea]',
      });
    }

    if (name) {
      this.addCandidate(trace, seenSelectors, {
        selector: `[name="${this.escapeCss(name)}"]`,
        source: 'heuristic',
        reason: 'inputs.name[name=]',
      });
      this.addCandidate(trace, seenSelectors, {
        selector: `[aria-label="${this.escapeCss(name)}"]`,
        source: 'heuristic',
        reason: 'inputs.name[aria-label]',
      });
    }
  }

  private addCandidate(
    trace: IBrowserSelectorTrace,
    seenSelectors: Set<string>,
    input: {
      selector?: string;
      source: IBrowserSelectorCandidate['source'];
      reason: string;
    },
  ): void {
    const selector = this.toNonEmptyString(input.selector);
    if (!selector || seenSelectors.has(selector)) {
      return;
    }

    seenSelectors.add(selector);
    trace.candidates.push({
      selector,
      source: input.source,
      reason: input.reason,
      rank: trace.candidates.length + 1,
    });
  }

  private buildAliasMap(
    rawAliasMap: BrowserAutomationResolvedRequest['selector_aliases'],
  ): BrowserAutomationAliasMap {
    const merged: BrowserAutomationAliasMap = {
      ...DEFAULT_ALIAS_MAP,
    };

    if (!rawAliasMap) {
      return merged;
    }

    for (const [alias, rawSelectors] of Object.entries(rawAliasMap)) {
      const normalizedAlias = this.toNonEmptyString(alias);
      if (!normalizedAlias) {
        continue;
      }

      const selectors = this.normalizeSelectors(rawSelectors);
      if (selectors.length > 0) {
        merged[normalizedAlias] = selectors;
      }
    }

    return merged;
  }

  private normalizeSelectors(value: unknown): string[] {
    if (typeof value === 'string') {
      const normalized = this.toNonEmptyString(value);
      return normalized ? [normalized] : [];
    }

    if (Array.isArray(value)) {
      const selectors: string[] = [];
      for (const entry of value) {
        if (typeof entry !== 'string') {
          continue;
        }

        const normalized = this.toNonEmptyString(entry);
        if (normalized) {
          selectors.push(normalized);
        }
      }

      return selectors;
    }

    return [];
  }

  private toNonEmptyString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private escapeCss(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  private escapeQuotes(value: string): string {
    return value.replace(/"/g, '\\"');
  }
}

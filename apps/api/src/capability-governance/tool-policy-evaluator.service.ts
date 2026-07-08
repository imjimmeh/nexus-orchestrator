import { Injectable } from '@nestjs/common';
import {
  ToolPolicyDocument,
  ToolPolicyDecision,
  ToolPolicyAbsentArgumentMatcher,
  parseStringRule,
} from '@nexus/core';

@Injectable()
export class ToolPolicyEvaluatorService {
  private regexCache = new Map<string, RegExp>();

  evaluate(
    tool: string,
    args: Record<string, unknown>,
    policy: ToolPolicyDocument,
  ): ToolPolicyDecision {
    for (const rawRule of policy.rules) {
      const rule =
        typeof rawRule === 'string' ? parseStringRule(rawRule) : rawRule;

      if (this.matchesTool(tool, rule.tool)) {
        if (this.matchesArguments(args, rule.arguments)) {
          return {
            effect: rule.effect,
            matchedRuleId: rule.id,
            explanation: `Matched rule for tool ${rule.tool}`,
          };
        }
      }
    }

    return {
      effect: policy.default,
      explanation: 'No rules matched. Using default effect.',
    };
  }

  private matchesTool(actual: string, pattern: string): boolean {
    if (pattern === '*') return true;
    if (pattern.includes('*')) {
      let regex = this.regexCache.get(pattern);
      if (!regex) {
        regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        this.regexCache.set(pattern, regex);
      }
      return regex.test(actual);
    }
    return actual === pattern;
  }

  private matchesArguments(
    actualArgs: Record<string, unknown>,
    ruleArgs?: Record<string, unknown>,
  ): boolean {
    if (!ruleArgs) return true;

    for (const key of Object.keys(ruleArgs)) {
      const ruleVal = ruleArgs[key];
      const actualVal = actualArgs[key];

      if (this.isAbsentMatcher(ruleVal)) {
        if (Object.prototype.hasOwnProperty.call(actualArgs, key)) {
          return false;
        }
        continue;
      }

      if (ruleVal === '*') {
        continue;
      }

      if (typeof ruleVal === 'string' && typeof actualVal === 'string') {
        if (!this.matchesTool(actualVal, ruleVal)) {
          return false;
        }
      } else {
        if (!this.deepEqual(actualVal, ruleVal)) {
          return false;
        }
      }
    }

    return true;
  }

  private isAbsentMatcher(
    value: unknown,
  ): value is ToolPolicyAbsentArgumentMatcher {
    return (
      !!value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (value as { operator?: unknown }).operator === 'absent'
    );
  }

  private deepEqual(obj1: unknown, obj2: unknown): boolean {
    if (obj1 === obj2) return true;

    if (
      typeof obj1 !== 'object' ||
      obj1 === null ||
      typeof obj2 !== 'object' ||
      obj2 === null
    ) {
      return false;
    }

    const o1 = obj1 as Record<string, unknown>;
    const o2 = obj2 as Record<string, unknown>;

    const keys1 = Object.keys(o1);
    const keys2 = Object.keys(o2);

    if (keys1.length !== keys2.length) return false;

    for (const key of keys1) {
      if (
        !Object.prototype.hasOwnProperty.call(o2, key) ||
        !this.deepEqual(o1[key], o2[key])
      ) {
        return false;
      }
    }

    return true;
  }
}

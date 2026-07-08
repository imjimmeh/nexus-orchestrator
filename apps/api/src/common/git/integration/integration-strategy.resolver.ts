import { Injectable } from '@nestjs/common';
import type { IntegrationStrategy, MergeMethod } from './merge-provider.types';
import type { ResolvedIntegrationConfig } from './integration-strategy.resolver.types';

export type { ResolvedIntegrationConfig };

const STRATEGY_INPUT_KEY = 'integration_strategy';
const MERGE_METHOD_INPUT_KEY = 'integration_merge_method';
const AUTO_MERGE_INPUT_KEY = 'integration_auto_merge';
const PREFLIGHT_GATE_INPUT_KEY = 'integration_preflight_gate';

const DEFAULT_STRATEGY: IntegrationStrategy = 'direct-push';
const DEFAULT_MERGE_METHOD: MergeMethod = 'merge';
const DEFAULT_AUTO_MERGE = false;
const DEFAULT_PREFLIGHT_GATE = true;

const VALID_STRATEGIES: ReadonlySet<IntegrationStrategy> = new Set([
  'direct-push',
  'pull-request',
]);
const VALID_MERGE_METHODS: ReadonlySet<MergeMethod> = new Set([
  'merge',
  'squash',
  'rebase',
]);

/**
 * Reads neutral, possibly-undefined step inputs and resolves a fully-defaulted
 * integration config. Never throws on absent or unknown input; unknown values
 * fall back to the direct-push defaults so an unparseable trigger payload can
 * never break the merge path.
 */
@Injectable()
export class IntegrationStrategyResolver {
  resolve(
    inputs: Record<string, unknown> | undefined,
  ): ResolvedIntegrationConfig {
    const source = inputs ?? {};
    return {
      strategy: this.resolveStrategy(source[STRATEGY_INPUT_KEY]),
      mergeMethod: this.resolveMergeMethod(source[MERGE_METHOD_INPUT_KEY]),
      autoMerge: this.resolveBoolean(
        source[AUTO_MERGE_INPUT_KEY],
        DEFAULT_AUTO_MERGE,
      ),
      preflightGate: this.resolveBoolean(
        source[PREFLIGHT_GATE_INPUT_KEY],
        DEFAULT_PREFLIGHT_GATE,
      ),
    };
  }

  private resolveStrategy(value: unknown): IntegrationStrategy {
    return typeof value === 'string' &&
      VALID_STRATEGIES.has(value as IntegrationStrategy)
      ? (value as IntegrationStrategy)
      : DEFAULT_STRATEGY;
  }

  private resolveMergeMethod(value: unknown): MergeMethod {
    return typeof value === 'string' &&
      VALID_MERGE_METHODS.has(value as MergeMethod)
      ? (value as MergeMethod)
      : DEFAULT_MERGE_METHOD;
  }

  private resolveBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
    return fallback;
  }
}

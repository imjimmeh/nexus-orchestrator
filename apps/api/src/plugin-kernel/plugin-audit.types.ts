import type { PluginIsolationMode } from '@nexus/plugin-sdk';
import type { PluginLifecycleState } from './plugin-kernel.types';

export type PluginAuditResult = 'success' | 'failure' | 'denied';

export interface PluginLifecycleAuditEvent {
  readonly action: string;
  readonly actorId: string;
  readonly pluginId: string;
  readonly version: string;
  readonly fromState?: PluginLifecycleState;
  readonly toState?: PluginLifecycleState;
  readonly result: PluginAuditResult;
  readonly metadata?: Record<string, unknown>;
}

export interface PluginRuntimeAuditEvent {
  readonly action: string;
  readonly actorId: string;
  readonly pluginId: string;
  readonly version: string;
  readonly mode: PluginIsolationMode;
  readonly operation: string;
  readonly contributionId?: string;
  readonly result: PluginAuditResult;
  readonly metadata?: Record<string, unknown>;
}

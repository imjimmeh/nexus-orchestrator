import { BrowserAutomationActionType, IJob } from '@nexus/core';
import { RESERVED_SPECIAL_STEP_TYPES } from '@nexus/plugin-sdk';

export const CORE_SPECIAL_STEP_TYPES = [
  'register_tool',
  'invoke_workflow',
  'run_command',
  'web_automation',
  'emit_event',
  'http_webhook',
  'mcp_tool_call',
  'git_operation',
  'manage_tool_candidate',
] as const;

export type CoreSpecialStepType = (typeof CORE_SPECIAL_STEP_TYPES)[number];

export type SupportedSpecialStepType = string;

export function isCoreSpecialStepType(
  value: string,
): value is CoreSpecialStepType {
  return (CORE_SPECIAL_STEP_TYPES as readonly string[]).includes(value);
}

export function isReservedSpecialStepType(value: string): boolean {
  return (RESERVED_SPECIAL_STEP_TYPES as readonly string[]).includes(value);
}

export type SpecialStepOwningDomain = 'core' | 'chat' | 'plugin';

export interface SpecialStepHandlerDescriptor {
  type: string;
  inputContract: string;
  owningDomain: SpecialStepOwningDomain;
  pluginId?: string;
  pluginVersion?: string;
  contributionId?: string;
  displayName?: string;
  description?: string;
}

export type CoreSpecialStepExecutionResult =
  | {
      status: 'completed';
      mode: 'tool_registration';
      toolId: string;
    }
  | {
      status: 'completed';
      mode: 'workflow_invocation';
      childRunId: string;
    }
  | {
      status: 'completed';
      mode: 'run_command';
      exitCode: number;
    }
  | {
      status: 'completed';
      mode: 'web_automation';
      action: BrowserAutomationActionType;
      success: boolean;
      artifactId?: string;
      sessionId: string;
    }
  | {
      status: 'completed';
      mode: 'emit_event';
      eventName: string;
    }
  | {
      status: 'completed';
      mode: 'http_webhook';
      method: string;
      statusCode?: number;
    }
  | {
      status: 'completed';
      mode: 'mcp_tool_call';
      serverId: string;
      toolName: string;
    }
  | {
      status: 'completed';
      mode: 'git_operation';
      action: string;
    }
  | {
      status: 'completed';
      mode: 'manage_tool_candidate';
      action: string;
      artifactId: string;
    }
  | {
      status: 'completed';
      mode: 'for_each';
      iterations: number;
      errorCount: number;
    };

export type PluginSpecialStepExecutionResult = {
  status: 'completed';
  source: 'plugin';
  mode: string;
  [key: string]: unknown;
};

export type SpecialStepExecutionResult =
  | CoreSpecialStepExecutionResult
  | PluginSpecialStepExecutionResult;

export interface SpecialStepExecutionContext {
  workflowRunId: string;
  stepId: string;
  step: IJob;
  resolvedStepInputs: Record<string, unknown>;
}

export interface SpecialStepHandlerResult {
  result: SpecialStepExecutionResult;
  output: Record<string, unknown>;
}

export interface ISpecialStepHandler {
  readonly type: string;
  readonly descriptor: SpecialStepHandlerDescriptor;
  execute(
    context: SpecialStepExecutionContext,
  ): Promise<SpecialStepHandlerResult>;
}

export interface SpecialStepHandlerLookup {
  getHandler(stepType: string): ISpecialStepHandler | null;
}

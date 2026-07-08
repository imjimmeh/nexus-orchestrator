import type { IJob } from "@nexus/core";

export type SpecialStepPluginPermission =
  | { kind: "network"; hosts: string[] }
  | { kind: "filesystem"; access: "read" | "write"; paths: string[] }
  | { kind: "environment"; variables: string[] }
  | { kind: "secrets"; names: string[] };

export interface SpecialStepPluginHandlerManifest {
  type: string;
  displayName: string;
  description?: string;
  inputContract: string;
}

export interface SpecialStepPluginManifest {
  id: string;
  name: string;
  version: string;
  entrypoint: string;
  specialSteps: SpecialStepPluginHandlerManifest[];
  permissions?: SpecialStepPluginPermission[];
}

export interface SpecialStepPluginExecutionContext {
  workflowRunId: string;
  stepId: string;
  step: IJob;
  resolvedStepInputs: Record<string, unknown>;
}

export type SpecialStepPluginExecutionResult = {
  status: "completed";
  source: "plugin";
  mode: string;
  [key: string]: unknown;
};

export interface SpecialStepPluginHandlerResult {
  result: SpecialStepPluginExecutionResult;
  output: Record<string, unknown>;
}

export interface SpecialStepPluginHandler {
  readonly type: string;
  execute(
    context: SpecialStepPluginExecutionContext,
  ): Promise<SpecialStepPluginHandlerResult>;
}

export interface SpecialStepPlugin {
  readonly manifest: SpecialStepPluginManifest;
  readonly handlers: SpecialStepPluginHandler[];
}

export function defineSpecialStepPlugin(
  plugin: SpecialStepPlugin,
): SpecialStepPlugin {
  return plugin;
}

import type { ChildProcess } from 'node:child_process';

export interface PluginWorkerProcessFactoryOptions {
  readonly pluginId: string;
  readonly version: string;
  readonly env: NodeJS.ProcessEnv;
  readonly bootstrapPath?: string;
}

export type PluginWorkerProcessFactory = (
  options: PluginWorkerProcessFactoryOptions,
) => ChildProcess;

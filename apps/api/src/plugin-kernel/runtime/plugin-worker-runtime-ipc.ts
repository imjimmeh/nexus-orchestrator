import { fork } from 'node:child_process';
import { PLUGIN_RUNTIME_PROTOCOL_VERSION } from '@nexus/plugin-sdk';
import type { PluginWorkerProcessFactory } from './plugin-worker-runtime-ipc.types';

export const PLUGIN_WORKER_PROCESS_FACTORY = Symbol(
  'PLUGIN_WORKER_PROCESS_FACTORY',
);

export const PLUGIN_WORKER_SOURCE_ENV = Symbol('PLUGIN_WORKER_SOURCE_ENV');

export function createPluginWorkerEnvironment(
  pluginId: string,
  version: string,
  sourceEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...(sourceEnv.NODE_ENV ? { NODE_ENV: sourceEnv.NODE_ENV } : {}),
    NEXUS_PLUGIN_ID: pluginId,
    NEXUS_PLUGIN_VERSION: version,
    NEXUS_PLUGIN_RUNTIME_MODE: 'worker_process',
    NEXUS_PLUGIN_PROTOCOL_VERSION: PLUGIN_RUNTIME_PROTOCOL_VERSION,
  };
}

export const defaultPluginWorkerProcessFactory: PluginWorkerProcessFactory = ({
  bootstrapPath,
  env,
}) => {
  if (!bootstrapPath) {
    throw new Error('Plugin worker bootstrap is not configured.');
  }

  return fork(bootstrapPath, [], {
    env,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
};

let nextCorrelationId = 0;

export function createPluginWorkerCorrelationId(): string {
  nextCorrelationId += 1;
  return `worker-${Date.now()}-${nextCorrelationId}`;
}

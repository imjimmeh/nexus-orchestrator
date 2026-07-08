import type { PluginRuntimeProtocolMessage } from '@nexus/plugin-sdk';
import type { PluginRuntimeBaseRequest } from './plugin-runtime.types';

export type CorrelatedProtocolMessage = Extract<
  PluginRuntimeProtocolMessage,
  { readonly correlationId: string }
>;

export type RuntimeProcessIdentity = Pick<
  PluginRuntimeBaseRequest,
  'pluginId' | 'version'
>;

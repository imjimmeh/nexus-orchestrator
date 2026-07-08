import { ContainerTier, type IContainerConfig } from '@nexus/core';
import type {
  PluginRuntimeBaseRequest,
  PluginRuntimeEventDeliveryRequest,
  PluginRuntimeHealthCheckResult,
  PluginRuntimeInvokeRequest,
  PluginRuntimeOperationResult,
  PluginRuntimeShutdownRequest,
} from './plugin-runtime.types';

export interface PluginContainerRuntimeClient {
  startSession(
    request: PluginContainerRuntimeSessionRequest,
  ): Promise<PluginRuntimeOperationResult>;
  invoke(
    containerId: string,
    request: PluginRuntimeInvokeRequest,
  ): Promise<PluginRuntimeOperationResult>;
  deliverEvent(
    containerId: string,
    request: PluginRuntimeEventDeliveryRequest,
  ): Promise<PluginRuntimeOperationResult>;
  healthCheck(
    containerId: string,
    request: PluginRuntimeBaseRequest,
  ): Promise<PluginRuntimeHealthCheckResult>;
  shutdown(
    containerId: string,
    request: PluginRuntimeShutdownRequest,
  ): Promise<PluginRuntimeOperationResult>;
}

export interface PluginContainerRuntimeSessionRequest {
  readonly containerId: string;
  readonly pluginId: string;
  readonly version: string;
  readonly timeoutMs?: number;
}

export interface PluginContainerRuntimeConfig {
  readonly image?: string;
  readonly tier?: ContainerTier;
  readonly env?: Record<string, string>;
  readonly volumes?: IContainerConfig['volumes'];
  readonly allowNetwork?: boolean;
  readonly timeoutMs?: number;
}

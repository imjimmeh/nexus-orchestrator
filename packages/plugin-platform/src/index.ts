// Plugin Platform — public API
// Re-exports will be filled in as the package grows across milestones.

export type {
  IsolationMode,
  PluginIsolationMode,
  PluginLifecycleActionResult,
  PluginManifestDiscoveryResult,
  PluginPlatformConfig,
  PluginPlatformHealthCheckConfig,
} from "./plugin-platform.types";

export { isolationModes } from "./plugin-platform.types";

export { PluginManifestDiscoveryService } from "./manifest/plugin-manifest-discovery.service";

export type {
  ManifestReadError,
  PluginManifestDiscoveryOptions,
  PluginManifestDiscoveryScanResult,
} from "./manifest/plugin-manifest-discovery.types";

export { PluginPlatformService } from "./service/plugin-platform-service";

export type {
  PluginPlatformServiceHealth,
  PluginPlatformServiceEvents,
} from "./service/plugin-platform-service.types";

export { PluginLifecycleService } from "./api/plugin-lifecycle.service";

export { PluginLifecycleController } from "./api/plugin-lifecycle.controller";

export type {
  PluginLifecycleOperation,
  PluginLifecycleRequest,
  PluginLifecycleResponse,
  PluginLifecycleListResponse,
} from "./api/plugin-lifecycle.types";

// Runtime module
export { NoneRuntimeAdapter } from "./runtime/none-runtime.adapter";

export { ContainerRuntimeAdapter } from "./runtime/container-runtime.adapter";

export { WorkerProcessRuntimeAdapter } from "./runtime/worker-process-runtime.adapter";

export { RuntimeManager } from "./runtime/runtime-manager";

export type {
  RuntimeAdapter,
  RuntimeAdapterConfig,
  RuntimeAdapterHealth,
  RuntimeIsolationMode,
} from "./runtime/runtime-adapter.types";

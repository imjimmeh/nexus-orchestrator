export type {
  HarnessEngine,
  HarnessSession,
  ValidationResult,
} from "./engine/harness-engine.js";
export type {
  HookMaterializer,
  ExtensionMaterializer,
  SettingsMaterializer,
  PluginMaterializer,
} from "./engine/contribution-materializers.types.js";
export {
  isHookMaterializer,
  isExtensionMaterializer,
  isSettingsMaterializer,
  isPluginMaterializer,
} from "./engine/contribution-materializers.js";
export { applyContributions } from "./engine/apply-contributions.js";
export type {
  HarnessSessionContext,
  PermissionDecision,
  CanonicalToolDefinition,
  CanonicalToolSpec,
  CommandExecRequest,
  CommandExecResult,
  ToolCallResult,
} from "./engine/session-context.js";
export { wrapToolWithGovernance } from "./governance/wrap-tool.js";
export { createCheckPermission } from "./governance/check-permission-client.js";
export type {
  CheckPermission,
  CheckPermissionConfig,
} from "./governance/check-permission-client.js";

// Tools
export { resolveHookCommand } from "./tools/hook-command.js";
export {
  loadMountedToolDefinitions,
  extractToolMetadata,
  ensureResultFits,
  TOOL_RESULT_CHAR_THRESHOLD,
  TOOL_RESULT_PREVIEW_CHARS,
  TOOL_RESULTS_DIR,
} from "./tools/mounted-tools.js";
export type { RunnerLocalToolHandler } from "./tools/mounted-tools.js";
export {
  executeApiCallback,
  buildCallbackBody,
  formatApiCallbackResultText,
} from "./tools/api-callback.js";
export { executeExternalMcpCallback } from "./tools/external-mcp-callback.js";
export type { MountedToolExternalMcpCallback } from "./tools/external-mcp-callback.types.js";
export {
  readHostMountScopeManifest,
  applyHostMountScopeGuards,
} from "./tools/host-mount-scope.js";
export type { HostMountScopeBinding } from "./tools/host-mount-scope.types.js";
export {
  normalizeToolNameKey,
  buildCanonicalToolNameResolver,
} from "./tools/tool-name-normalization.js";

// Gateway
export { createOrchestratorClient } from "./gateway/orchestrator-client.js";
export type {
  OrchestratorCommand,
  QuestionAnswer,
  CommandPayload,
  CommandHandler,
  OrchestratorClient,
  WaitForCommandOptions,
  StepCompleteResultPayload,
  SpawnSubagentAsyncResultPayload,
  WaitForSubagentsResultPayload,
  CheckSubagentStatusResultPayload,
} from "./gateway/orchestrator-client.types.js";

// Server
export {
  startServer,
  executeAgentStep,
  defaultExecuteCommand,
} from "./server/server.js";
export type { HarnessServer } from "./server/server.js";

// Config
export { loadConfig, ConfigValidationError } from "./config/config.js";
export type { HarnessEnvConfig } from "./config/config.js";

// Telemetry
export { createTelemetryForwarder } from "./telemetry/forwarder.js";

// Kernel
export {
  registerEngine,
  loadEngine,
  assertTelemetryVersion,
  KERNEL_TELEMETRY_VERSION,
  startKernel,
  resolveSessionContributions,
} from "./kernel.js";

// Checkpoint
export { SessionCheckpointWriter } from "./checkpoint/session-checkpoint-writer.js";
export { FileSidecarSink } from "./checkpoint/file-sidecar-sink.js";
export type {
  CheckpointSink,
  SessionCheckpointWriterOptions,
} from "./checkpoint/session-checkpoint-writer.types.js";

// Session (v3 JSONL writer)
export { V3SessionWriter } from "./session/v3-session-writer.js";
export type {
  V3NodePayload,
  V3Message,
  V3ContentBlock,
  V3Usage,
  V3WriterOptions,
} from "./session/v3-session-writer.types.js";

/**
 * Common Plugin Runtime Module.
 *
 * This module provides shared utilities and base classes for plugin protocol
 * integrations (MCP, ACP, etc.).
 *
 * ## Modules
 *
 * | Module | Description |
 * |--------|-------------|
 * | `base-plugin-runtime-manager.service.ts` | Abstract base class for runtime managers |
 * | `base-plugin-runtime-manager.service.types.ts` | Types for the base runtime manager |
 * | `plugin-filter.utils.ts` | Shared filter/pattern matching utilities |
 * | `plugin-schema.utils.ts` | Shared schema building utilities |
 * | `plugin-tool-name.utils.ts` | Shared tool naming utilities |
 * | `plugin-transport.factory.ts` | Generic transport factory |
 * | `plugin-transport.interface.ts` | Transport interface documentation |
 * | `plugin-transport.types.ts` | Transport type definitions |
 *
 * @module
 */

// Re-export types for convenience
export type {
  PluginInvokeResult,
  PluginRuntimeContext,
  PluginTransportClient,
  PluginTransportFactoryFn,
  PluginTransportHandler,
  PluginTransportRegistry,
} from './plugin-transport.types';

// Re-export generic factory
export {
  PluginTransportFactory,
  createTransportTypeExtractor,
} from './plugin-transport.factory';
export type { TransportTypeExtractor } from './plugin-transport.factory';

// Re-export base runtime manager
export { BasePluginRuntimeManagerService } from './base-plugin-runtime-manager.service';
export type {
  PluginServerRecord,
  PluginReloadSummary,
  PluginRegistryItemRecord,
  PluginRegistryRepository,
  PluginRegistryService,
  PluginTestResultParams,
} from './base-plugin-runtime-manager.service.types';

// Re-export utilities
export {
  normalizePatterns,
  patternToRegex,
  matchesAnyPattern,
  filterByPatterns,
} from './plugin-filter.utils';

export {
  normalizeMcpInputSchema,
  normalizeAcpInputSchema,
  applyDescriptionToSchema,
  buildRegistrySchema,
  buildMcpNexusExtension,
  buildAcpNexusExtension,
} from './plugin-schema.utils';

export {
  hashFragment,
  buildServerNamespace,
  sanitizeToolToken,
  sanitizeAgentToken,
  buildToolPrefix,
  buildRegistryToolName,
  buildMcpInvokePath,
  buildAcpInvokePath,
} from './plugin-tool-name.utils';

import type {
  HarnessHookAsset,
  HarnessExtensionAsset,
  HarnessSettingsContribution,
  HarnessPlugin,
} from "@nexus/core";
import type { HarnessSessionContext } from "./session-context.js";

export interface HookMaterializer {
  materializeHooks(
    hooks: HarnessHookAsset[],
    ctx: HarnessSessionContext,
  ): Promise<void>;
}

export interface ExtensionMaterializer {
  materializeExtensions(
    extensions: HarnessExtensionAsset[],
    ctx: HarnessSessionContext,
  ): Promise<void>;
}

export interface SettingsMaterializer {
  materializeSettings(
    settings: HarnessSettingsContribution,
    ctx: HarnessSessionContext,
  ): Promise<void>;
}

/**
 * SPI for engines that can materialize Nexus plugins into their native runtime
 * format (e.g. Claude Code's `options.plugins` staging path). Engines that
 * declare `supportsPlugins: true` in their capabilities SHOULD implement this
 * interface; the SPI conformance test (Task 4) will assert the pairing.
 *
 * The actual materialization (file staging + SDK option assembly) happens inside
 * `createSession` rather than here — `materializePlugins` is the SPI hook for
 * the `applyContributions` dispatch path. Engines that handle plugins entirely
 * inside `createSession` MAY leave this as a no-op.
 */
export interface PluginMaterializer {
  materializePlugins(
    plugins: HarnessPlugin[],
    ctx: HarnessSessionContext,
  ): Promise<void>;
}

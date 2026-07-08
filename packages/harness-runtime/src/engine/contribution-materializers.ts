import type {
  HookMaterializer,
  ExtensionMaterializer,
  SettingsMaterializer,
  PluginMaterializer,
} from "./contribution-materializers.types.js";

export type {
  HookMaterializer,
  ExtensionMaterializer,
  SettingsMaterializer,
  PluginMaterializer,
} from "./contribution-materializers.types.js";

export function isHookMaterializer(e: object): e is HookMaterializer {
  return (
    typeof (e as Partial<HookMaterializer>).materializeHooks === "function"
  );
}

export function isExtensionMaterializer(e: object): e is ExtensionMaterializer {
  return (
    typeof (e as Partial<ExtensionMaterializer>).materializeExtensions ===
    "function"
  );
}

export function isSettingsMaterializer(e: object): e is SettingsMaterializer {
  return (
    typeof (e as Partial<SettingsMaterializer>).materializeSettings ===
    "function"
  );
}

export function isPluginMaterializer(e: object): e is PluginMaterializer {
  return (
    typeof (e as Partial<PluginMaterializer>).materializePlugins === "function"
  );
}

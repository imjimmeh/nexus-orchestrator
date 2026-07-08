import type { PluginContribution } from "./plugin-contribution.types";

export const pluginIsolationModes = [
  "none",
  "worker_process",
  "container",
] as const;

export type PluginIsolationMode = (typeof pluginIsolationModes)[number];

export const pluginTrustLevels = [
  "bundled",
  "local_trusted",
  "third_party",
  "quarantined",
] as const;

export type PluginTrustLevel = (typeof pluginTrustLevels)[number];

export const pluginLifecycleStates = [
  "discovered",
  "installed",
  "scanned",
  "enabled",
  "disabled",
  "quarantined",
  "uninstalled",
] as const;

export type PluginLifecycleState = (typeof pluginLifecycleStates)[number];

export interface PluginNexusCompatibility {
  pluginApiVersion: string;
  minVersion: string;
  maxVersion?: string;
}

export interface PluginEntrypoints {
  main: string;
  worker?: string;
}

export type PluginPermission =
  | { kind: "network"; hosts: string[] }
  | { kind: "filesystem"; access: "read" | "write"; paths: string[] }
  | { kind: "environment"; variables: string[] }
  | { kind: "secrets"; names: string[] }
  | { kind: "internal_capability"; capabilities: string[] };

export type PluginManifestContribution = PluginContribution;

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  packageName?: string;
  packageVersion?: string;
  checksum?: string;
  signature?: string;
  nexusCompatibility: PluginNexusCompatibility;
  entrypoints: PluginEntrypoints;
  isolationModes: PluginIsolationMode[];
  permissions: PluginPermission[];
  contributions: PluginManifestContribution[];
}

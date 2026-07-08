import type { HarnessCredentialRequirement } from "./harness-credentials.types";
import type { HarnessHookEvent } from "./harness-contributions.types";
import type { HarnessAssetSourceKind } from "./harness-asset.types";

/** Stable harness identity. Built-ins are literal; third-party use the custom: prefix. */
export type HarnessId = "pi" | "claude-code" | `custom:${string}`;

export type HarnessExecutionMode =
  | "agent_turn"
  | "command"
  | "interactive"
  | "background";

/** How an engine enforces per-tool governance. */
export type HarnessToolModel = "execute_wrapped" | "permission_callback";

export type TelemetryContractVersion = "v1";

export interface HarnessCapabilities {
  executionModes: HarnessExecutionMode[];
  toolModel: HarnessToolModel;
  supportsSubagents: boolean;
  supportsWarRoom: boolean;
  supportsBranching: boolean;
  /** Whether the harness can durably suspend and resume an agent session. */
  supportsResume: boolean;
  /** How resume state is restored to the agent. */
  resumeMechanism: "file_injection" | "config_ref";
  supportsThinkingLevels: boolean;
  /**
   * @deprecated Use `requiredCredentials[].authTypes` instead, which provides per-credential
   * granularity and distinguishes between `"oauth_device"` and `"oauth_authcode"`.
   * This field conflates all credential auth types into a coarse top-level list and will be
   * removed in a future release.
   */
  supportedAuthTypes: Array<"api_key" | "oauth">;
  telemetryContractVersion: TelemetryContractVersion;
  requiredCredentials?: HarnessCredentialRequirement[];
  /** When set, only these provider names/ids are valid for this harness. */
  compatibleProviderIds?: string[];
  /** Preferred provider for this harness (the compatibility fallback target). */
  defaultProviderId?: string;
  /** Container path where skills should be mounted. */
  skillsContainerPath?: string;
  /** Whether the harness natively runs lifecycle hooks. */
  supportsHooks?: boolean;
  /** Whether the harness can register MCP-server extensions. */
  supportsExtensions?: boolean;
  /** Whether the harness accepts a native settings bag. */
  supportsSettings?: boolean;
  /** Hook events this harness can natively fire. */
  supportedHookEvents?: HarnessHookEvent[];
  /**
   * Whether the harness supports first-class Nexus plugins (Phase 3 S1).
   * Claude Code: true (PROVISIONAL — Phase 3 spike S1 may flip to false).
   * PI: false.
   */
  supportsPlugins?: boolean;
  /** Whether the harness supports PI-style extension packages. PI: true; Claude Code: false. */
  supportsExtensionPackages?: boolean;
  /** Asset source kinds this harness can resolve at runtime. */
  supportedAssetSources?: HarnessAssetSourceKind[];
}

const BUILTIN_HARNESS_IDS = ["pi", "claude-code"] as const;

export function isHarnessId(value: string): value is HarnessId {
  return (
    (BUILTIN_HARNESS_IDS as readonly string[]).includes(value) ||
    (value.startsWith("custom:") && value.length > "custom:".length)
  );
}

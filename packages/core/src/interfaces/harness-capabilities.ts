import { CONTAINER_AGENT_DIR } from "../common/container-paths";
import type { HarnessCapabilities } from "./harness.types";

/** pi-ai OAuth preset id used for Claude Code's Anthropic credential. */
export const CLAUDE_CODE_OAUTH_PROVIDER_ID = "anthropic";

export const PI_CAPABILITIES: HarnessCapabilities = {
  executionModes: ["agent_turn", "command", "interactive", "background"],
  toolModel: "execute_wrapped",
  supportsSubagents: true,
  supportsWarRoom: true,
  supportsBranching: true,
  supportsResume: true,
  resumeMechanism: "file_injection",
  supportsThinkingLevels: true,
  supportedAuthTypes: ["api_key", "oauth"],
  telemetryContractVersion: "v1",
  requiredCredentials: [
    {
      key: "provider",
      displayName: "LLM Provider",
      authTypes: ["api_key", "oauth_authcode"],
      primary: true,
    },
  ],
  // pi's DefaultResourceLoader natively scans `${agentDir}/skills` and the
  // kernel sets agentDir = CONTAINER_AGENT_DIR. Mounting the assigned-skill
  // bundle here lets pi enumerate it and inject `<available_skills>` into the
  // system prompt — no search tool or static prompt-naming required.
  skillsContainerPath: `${CONTAINER_AGENT_DIR}/skills`,
  // PI materializes contributions natively: hooks via a generated PI extension
  // module (loaded from the session's extensions dir) and MCP-server extensions
  // via an engine-side MCP client bridge whose tools route through PI's existing
  // governed-tool path. Settings have no faithful PI mapping, so they stay off.
  supportsHooks: true,
  supportsExtensions: true,
  supportsSettings: false,
  supportedHookEvents: [
    "session_start",
    "session_end",
    "pre_tool_use",
    "post_tool_use",
    "user_prompt_submit",
  ],
  supportsExtensionPackages: true,
  supportsPlugins: false,
  supportedAssetSources: ["authored", "git", "registry"],
};

export const CLAUDE_CODE_CAPABILITIES: HarnessCapabilities = {
  executionModes: ["agent_turn", "command", "interactive", "background"],
  toolModel: "permission_callback",
  supportsSubagents: true,
  supportsWarRoom: true,
  supportsBranching: false,
  supportsResume: true,
  resumeMechanism: "config_ref",
  supportsThinkingLevels: false,
  supportedAuthTypes: ["api_key", "oauth"],
  telemetryContractVersion: "v1",
  requiredCredentials: [
    {
      key: "anthropic",
      displayName: "Anthropic API Key / OAuth",
      authTypes: ["api_key", "oauth_authcode"],
      primary: true,
      oauthProviderId: CLAUDE_CODE_OAUTH_PROVIDER_ID,
    },
  ],
  // Dedicated provider identity for the Claude Code harness, kept distinct from
  // the generic "anthropic" provider the PI runner uses so harness selection is
  // unambiguous (no overlap with PI). The OAuth login flow still uses the
  // "anthropic" pi-ai preset (CLAUDE_CODE_OAUTH_PROVIDER_ID).
  compatibleProviderIds: ["anthropic-claude-code"],
  defaultProviderId: "anthropic-claude-code",
  skillsContainerPath: "/root/.claude/skills",
  supportsHooks: true,
  supportsExtensions: true,
  supportsSettings: true,
  supportedHookEvents: [
    "session_start",
    "session_end",
    "pre_tool_use",
    "post_tool_use",
    "user_prompt_submit",
  ],
  // S1-confirmed (Phase 3 spike complete): the SDK exposes a first-class
  // programmatic `plugins` option; engine implements PluginMaterializer SPI.
  supportsPlugins: true,
  supportsExtensionPackages: false,
  supportedAssetSources: ["authored", "git"],
};

import type { HarnessId } from "./harness.types";
import type { HarnessSessionRef } from "./agent-await.types";
import type { HarnessContributions } from "./harness-contributions.types";
import type {
  RunnerProviderAuth,
  RunnerProviderRegistrationConfig,
  RunnerThinkingLevel,
} from "./runner-config.types";

export interface HarnessModelConfig {
  provider: string;
  model: string;
  auth: RunnerProviderAuth;
  baseUrl?: string;
  providerConfig?: RunnerProviderRegistrationConfig;
  temperature?: number;
  /** Ignored by harnesses whose capabilities.supportsThinkingLevels is false. */
  thinkingLevel?: RunnerThinkingLevel;
}

export interface HarnessPromptConfig {
  systemPrompt: string;
  initialPrompt?: string;
}

export interface HarnessSessionConfig {
  resumeNodeId?: string;
  interactive?: boolean;
  /**
   * Engine-agnostic reference to a prior session to resume. PI consumes the
   * `pi` variant via file injection; Claude Code consumes the `claude_code`
   * variant by passing `sessionId` to the SDK's `query({ options: { resume } })`.
   */
  resume?: HarnessSessionRef;
}

export interface HarnessRuntimeConfig {
  harnessId: HarnessId;
  model: HarnessModelConfig;
  prompt: HarnessPromptConfig;
  session?: HarnessSessionConfig;
  /** Engine-specific; validated by the owning engine; opaque to kernel/API. */
  harnessOptions?: Record<string, unknown>;
  /** Resolved, capability-validated author contributions for this session. */
  contributions?: HarnessContributions;
}

export function isHarnessRuntimeConfig(
  value: unknown,
): value is HarnessRuntimeConfig {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.harnessId !== "string") return false;
  const model = v.model as Record<string, unknown> | undefined;
  if (
    !model ||
    typeof model.provider !== "string" ||
    typeof model.model !== "string"
  )
    return false;
  if (typeof model.auth !== "object" || model.auth === null) return false;
  const prompt = v.prompt as Record<string, unknown> | undefined;
  if (!prompt || typeof prompt.systemPrompt !== "string") return false;
  return true;
}

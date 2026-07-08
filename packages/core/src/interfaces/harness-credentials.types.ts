import type { RunnerProviderAuth } from "./runner-config.types";

/** Authentication mechanism that can satisfy a harness credential requirement. */
export type HarnessAuthType = "api_key" | "oauth_device" | "oauth_authcode";

/** A credential a harness needs in order to run. */
export interface HarnessCredentialRequirement {
  /** Stable id within the harness, e.g. "anthropic". */
  key: string;
  /** Human label, e.g. "Anthropic API Key / OAuth". */
  displayName: string;
  /** Which methods satisfy this requirement. */
  authTypes: HarnessAuthType[];
  /** The requirement that populates HarnessRuntimeConfig.model.auth. */
  primary?: boolean;
  /** When true the requirement may be unbound without blocking launch. */
  optional?: boolean;
  /**
   * pi-ai OAuth preset id used to drive the unified OAuth login when an
   * `oauth_*` auth type is selected (e.g. "anthropic"). The login modality
   * (device-code vs authorization-code) is decided by the SDK at runtime.
   */
  oauthProviderId?: string;
}

/** A requirement resolved to a concrete, decrypted auth payload. */
export interface ResolvedHarnessCredential {
  key: string;
  /**
   * Records how the credential was obtained (origin), not the runtime delivery format.
   * Device-flow tokens (`"oauth_device"`) are always delivered as `{ type: "api_key" }` —
   * the SDK consumes them as bearer tokens. Use `auth.type` for the runtime delivery shape.
   */
  authType: HarnessAuthType;
  /** api_key | oauth shape — see runner-config.types.ts. */
  auth: RunnerProviderAuth;
}

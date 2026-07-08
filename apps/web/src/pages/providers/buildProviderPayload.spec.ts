import { describe, expect, it } from "vitest";
import { buildProviderPayload } from "./ProviderSubcomponents";
import type { ProviderFormData } from "./ProviderForm";

const base: ProviderFormData = {
  name: "OpenAI",
  provider_id: "openai",
  auth_type: "api_key",
  credential_mode: "create",
  api_key: "",
  secret_id: "",
  owner_type: "global",
  owner_id: "",
  oauth_authorization_url: "",
  oauth_token_url: "",
  oauth_client_id: "",
  oauth_client_secret_id: "",
  oauth_scopes: "",
  oauth_redirect_uri: "",
  runtime_env: "",
  headers: [],
  extra_values: [],
};

describe("buildProviderPayload credential", () => {
  it("emits a credential in create mode", () => {
    const payload = buildProviderPayload({
      ...base,
      api_key: "sk-test",
      headers: [{ name: "X-Title", value: "nexus" }],
      extra_values: [{ name: "ORG_ID", value: "org_1" }],
    });
    expect(payload.credential).toEqual({
      api_key: "sk-test",
      extra: { ORG_ID: "org_1" },
      headers: [{ name: "X-Title", value: "nexus" }],
    });
    expect(payload.secret_id).toBeNull();
  });

  it("omits a blank api_key (keep-existing on edit) but keeps other credential fields", () => {
    const payload = buildProviderPayload({
      ...base,
      api_key: "",
      extra_values: [{ name: "ORG_ID", value: "org_2" }],
    });
    expect(payload.credential?.api_key).toBeUndefined();
    expect(payload.credential?.extra).toEqual({ ORG_ID: "org_2" });
  });

  it("emits secret_id (no credential) in existing mode", () => {
    const payload = buildProviderPayload({
      ...base,
      credential_mode: "existing",
      secret_id: "secret-1",
    });
    expect(payload.credential).toBeUndefined();
    expect(payload.secret_id).toBe("secret-1");
  });

  it("strips providerConfig.headers from runtime_env in create mode so the PairList is authoritative", () => {
    const runtimeEnv = JSON.stringify({
      providerConfig: {
        headers: { "X-Old-Header": "stale" },
        baseURL: "https://api.example.com",
      },
    });
    const payload = buildProviderPayload({
      ...base,
      credential_mode: "create",
      api_key: "sk-test",
      headers: [{ name: "X-New-Header", value: "fresh" }],
      runtime_env: runtimeEnv,
    });
    const config = (payload.runtime_env as Record<string, unknown>)
      ?.providerConfig as Record<string, unknown> | undefined;
    expect(config?.headers).toBeUndefined();
    expect(config?.baseURL).toBe("https://api.example.com");
    expect(payload.credential?.headers).toEqual([
      { name: "X-New-Header", value: "fresh" },
    ]);
  });

  it("does not strip providerConfig.headers when in existing mode", () => {
    const runtimeEnv = JSON.stringify({
      providerConfig: {
        headers: { "X-Retained": "yes" },
      },
    });
    const payload = buildProviderPayload({
      ...base,
      credential_mode: "existing",
      secret_id: "secret-1",
      runtime_env: runtimeEnv,
    });
    const config = (payload.runtime_env as Record<string, unknown>)
      ?.providerConfig as Record<string, unknown> | undefined;
    expect(config?.headers).toEqual({ "X-Retained": "yes" });
  });
});

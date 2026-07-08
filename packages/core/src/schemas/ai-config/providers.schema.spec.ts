import { describe, expect, it } from "vitest";
import {
  CreateProviderSchema,
  ProviderReferenceSchema,
  providerOwnerTypeSchema,
  providerOAuthStatusSchema,
  ProviderOAuthAuthorizeRequestSchema,
  ProviderOAuthAuthorizeResponseSchema,
  ProviderOAuthCallbackRequestSchema,
  ProviderOAuthStatusSchema,
  UpdateProviderSchema,
} from "./providers.schema";

describe("provider schemas", () => {
  it("accepts scoped OAuth provider registration", () => {
    const parsed = CreateProviderSchema.parse({
      name: "openai",
      owner_type: "user",
      owner_id: "user-1",
      auth_type: "oauth",
      secret_id: "00000000-0000-4000-8000-000000000001",
      oauth_authorization_url: "https://provider.example/oauth/authorize",
      oauth_token_url: "https://provider.example/oauth/token",
      oauth_client_id: "client-id",
      oauth_client_secret_id: "00000000-0000-4000-8000-000000000002",
      oauth_scopes: ["model.read", "model.write"],
      oauth_redirect_uri: "http://localhost:3120/providers/oauth/callback",
    });

    expect(parsed.owner_type).toBe("user");
    expect(parsed.oauth_scopes).toEqual(["model.read", "model.write"]);
  });

  it("exports canonical owner and status enums", () => {
    expect(providerOwnerTypeSchema.parse("global")).toBe("global");
    expect(providerOAuthStatusSchema.parse("connected")).toBe("connected");
  });

  it("defaults owner_type to global when omitted", () => {
    const parsed = CreateProviderSchema.parse({ name: "openai" });

    expect(parsed.owner_type).toBe("global");
  });

  it("accepts null for nullable provider fields", () => {
    const parsed = CreateProviderSchema.parse({
      name: "openai",
      secret_id: null,
      oauth_authorization_url: null,
      oauth_token_url: null,
      oauth_client_id: null,
      oauth_client_secret_id: null,
      oauth_scopes: null,
      oauth_redirect_uri: null,
      owner_id: null,
    });

    expect(parsed.secret_id).toBeNull();
    expect(parsed.oauth_authorization_url).toBeNull();
    expect(parsed.oauth_token_url).toBeNull();
    expect(parsed.oauth_client_id).toBeNull();
    expect(parsed.oauth_client_secret_id).toBeNull();
    expect(parsed.oauth_scopes).toBeNull();
    expect(parsed.oauth_redirect_uri).toBeNull();
    expect(parsed.owner_id).toBeNull();
  });
});

describe("UpdateProviderSchema", () => {
  it("accepts null for clearing nullable provider fields", () => {
    const parsed = UpdateProviderSchema.parse({
      secret_id: null,
      oauth_authorization_url: null,
      oauth_token_url: null,
      oauth_client_id: null,
      oauth_client_secret_id: null,
      oauth_scopes: null,
      oauth_redirect_uri: null,
      owner_id: null,
    });

    expect(parsed.secret_id).toBeNull();
    expect(parsed.oauth_authorization_url).toBeNull();
    expect(parsed.oauth_token_url).toBeNull();
    expect(parsed.oauth_client_id).toBeNull();
    expect(parsed.oauth_client_secret_id).toBeNull();
    expect(parsed.oauth_scopes).toBeNull();
    expect(parsed.oauth_redirect_uri).toBeNull();
    expect(parsed.owner_id).toBeNull();
  });
});

describe("ProviderReferenceSchema", () => {
  it("accepts a separated provider reference", () => {
    const parsed = ProviderReferenceSchema.parse({
      provider_source: "user",
      provider_name: "openai",
      model_name: "gpt-5.5",
    });

    expect(parsed.provider_source).toBe("user");
    expect(parsed.provider_name).toBe("openai");
    expect(parsed.model_name).toBe("gpt-5.5");
  });

  it("rejects an invalid UUID in provider_id", () => {
    const result = ProviderReferenceSchema.safeParse({
      provider_id: "not-a-uuid",
    });

    expect(result.success).toBe(false);
  });
});

describe("ProviderOAuthAuthorizeRequestSchema", () => {
  it("accepts a valid redirect_uri", () => {
    const parsed = ProviderOAuthAuthorizeRequestSchema.parse({
      redirect_uri: "http://localhost:3120/callback",
    });

    expect(parsed.redirect_uri).toBe("http://localhost:3120/callback");
  });

  it("allows omitted redirect_uri", () => {
    const parsed = ProviderOAuthAuthorizeRequestSchema.parse({});

    expect(parsed.redirect_uri).toBeUndefined();
  });
});

describe("ProviderOAuthAuthorizeResponseSchema", () => {
  it("accepts valid authorization URL and state", () => {
    const parsed = ProviderOAuthAuthorizeResponseSchema.parse({
      authorizationUrl:
        "https://provider.example/oauth/authorize?client_id=123",
      state: "abcdefghijklmnopqrstuvwxyz123456",
    });

    expect(parsed.authorizationUrl).toBe(
      "https://provider.example/oauth/authorize?client_id=123",
    );
    expect(parsed.state).toBe("abcdefghijklmnopqrstuvwxyz123456");
  });

  it("rejects state shorter than 32 characters", () => {
    const result = ProviderOAuthAuthorizeResponseSchema.safeParse({
      authorizationUrl: "https://provider.example/auth",
      state: "short",
    });

    expect(result.success).toBe(false);
  });
});

describe("ProviderOAuthCallbackRequestSchema", () => {
  it("accepts valid code and state", () => {
    const parsed = ProviderOAuthCallbackRequestSchema.parse({
      code: "auth-code-123",
      state: "abcdefghijklmnopqrstuvwxyz123456",
    });

    expect(parsed.code).toBe("auth-code-123");
    expect(parsed.state).toBe("abcdefghijklmnopqrstuvwxyz123456");
  });

  it("rejects empty code", () => {
    const result = ProviderOAuthCallbackRequestSchema.safeParse({
      code: "",
      state: "abcdefghijklmnopqrstuvwxyz123456",
    });

    expect(result.success).toBe(false);
  });

  it("rejects state shorter than 32 characters", () => {
    const result = ProviderOAuthCallbackRequestSchema.safeParse({
      code: "auth-code-123",
      state: "short",
    });

    expect(result.success).toBe(false);
  });
});

describe("providerOAuthStatusSchema", () => {
  it("rejects 'error' status", () => {
    const result = providerOAuthStatusSchema.safeParse("error");

    expect(result.success).toBe(false);
  });

  it("accepts 'connected' status", () => {
    expect(providerOAuthStatusSchema.parse("connected")).toBe("connected");
  });
});

describe("ProviderOAuthStatusSchema", () => {
  it("accepts a valid status object", () => {
    const parsed = ProviderOAuthStatusSchema.parse({ status: "connected" });

    expect(parsed.status).toBe("connected");
  });

  it("rejects an invalid status value", () => {
    const result = ProviderOAuthStatusSchema.safeParse({ status: "error" });

    expect(result.success).toBe(false);
  });
});

describe("CreateProviderSchema credential", () => {
  it("accepts a credential with api_key, extra and headers", () => {
    const parsed = CreateProviderSchema.parse({
      name: "OpenAI",
      provider_id: "openai",
      auth_type: "api_key",
      credential: {
        api_key: "sk-test",
        extra: { ORG_ID: "org_1" },
        headers: [{ name: "X-Title", value: "nexus" }],
      },
    });
    expect(parsed.credential?.api_key).toBe("sk-test");
  });

  it("rejects credential together with secret_id", () => {
    const result = CreateProviderSchema.safeParse({
      name: "OpenAI",
      auth_type: "api_key",
      secret_id: "11111111-1111-1111-1111-111111111111",
      credential: { api_key: "sk-test" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects credential when auth_type is oauth", () => {
    const result = CreateProviderSchema.safeParse({
      name: "OpenAI",
      auth_type: "oauth",
      credential: { api_key: "sk-test" },
    });
    expect(result.success).toBe(false);
  });

  it("UpdateProviderSchema allows a credential-only patch", () => {
    const parsed = UpdateProviderSchema.parse({
      credential: { api_key: "sk-new" },
    });
    expect(parsed.credential?.api_key).toBe("sk-new");
  });
});

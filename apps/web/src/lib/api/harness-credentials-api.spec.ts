import { describe, expect, it, vi } from "vitest";
import {
  bindCredential,
  getCredentialOAuthStatus,
  getCredentialRequirements,
  getScopedDefault,
  setScopedDefault,
  startCredentialOAuth,
  submitCredentialOAuthCode,
  unbindCredential,
} from "./harness-credentials-api";
import type { ApiClient } from "./client";

function createClientMock() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  };
}

describe("harness-credentials-api", () => {
  it("getCredentialRequirements GETs the credentials route with no scope param", async () => {
    const client = createClientMock();
    client.get.mockResolvedValueOnce({
      harnessId: "claude-code",
      requirements: [],
    });

    await getCredentialRequirements(
      client as unknown as ApiClient,
      "claude-code",
    );

    expect(client.get).toHaveBeenCalledWith(
      "/harness/claude-code/credentials",
      {
        params: {},
      },
    );
  });

  it("getCredentialRequirements passes scopeNodeId as a query param", async () => {
    const client = createClientMock();
    client.get.mockResolvedValueOnce({
      harnessId: "claude-code",
      requirements: [],
    });

    await getCredentialRequirements(
      client as unknown as ApiClient,
      "claude-code",
      "scope-1",
    );

    expect(client.get).toHaveBeenCalledWith(
      "/harness/claude-code/credentials",
      {
        params: { scopeNodeId: "scope-1" },
      },
    );
  });

  it("bindCredential PUTs to the per-key route", async () => {
    const client = createClientMock();
    client.put.mockResolvedValueOnce({ ok: true });

    await bindCredential(
      client as unknown as ApiClient,
      "claude-code",
      "anthropic",
      {
        authType: "api_key",
        secretId: "secret-1",
        scopeNodeId: "scope-1",
      },
    );

    expect(client.put).toHaveBeenCalledWith(
      "/harness/claude-code/credentials/anthropic",
      { authType: "api_key", secretId: "secret-1", scopeNodeId: "scope-1" },
    );
  });

  it("unbindCredential DELETEs the per-key route with scope query", async () => {
    const client = createClientMock();
    client.delete.mockResolvedValueOnce(undefined);

    await unbindCredential(
      client as unknown as ApiClient,
      "claude-code",
      "anthropic",
      "scope-1",
    );

    expect(client.delete).toHaveBeenCalledWith(
      "/harness/claude-code/credentials/anthropic?scopeNodeId=scope-1",
    );
  });

  it("unbindCredential DELETEs without query when scope omitted", async () => {
    const client = createClientMock();
    client.delete.mockResolvedValueOnce(undefined);

    await unbindCredential(
      client as unknown as ApiClient,
      "claude-code",
      "anthropic",
    );

    expect(client.delete).toHaveBeenCalledWith(
      "/harness/claude-code/credentials/anthropic",
    );
  });

  it("startCredentialOAuth POSTs to the oauth start route", async () => {
    const client = createClientMock();
    client.post.mockResolvedValueOnce({
      sessionId: "sess-1",
      modality: "device",
      userCode: "ABCD-EFGH",
      verificationUri: "https://example/device",
      intervalSeconds: 5,
      expiresAt: "2026-06-12T00:00:00.000Z",
    });

    await startCredentialOAuth(
      client as unknown as ApiClient,
      "claude-code",
      "anthropic",
      { scopeNodeId: "scope-1" },
    );

    expect(client.post).toHaveBeenCalledWith(
      "/harness/claude-code/credentials/anthropic/oauth/start",
      { scopeNodeId: "scope-1" },
    );
  });

  it("submitCredentialOAuthCode POSTs to the submit-code route", async () => {
    const client = createClientMock();
    client.post.mockResolvedValueOnce({ accepted: true });

    await submitCredentialOAuthCode(
      client as unknown as ApiClient,
      "claude-code",
      "anthropic",
      { sessionId: "sess-1", code: "auth-code-123" },
    );

    expect(client.post).toHaveBeenCalledWith(
      "/harness/claude-code/credentials/anthropic/oauth/submit-code",
      { sessionId: "sess-1", code: "auth-code-123" },
    );
  });

  it("getCredentialOAuthStatus GETs the oauth session path segment", async () => {
    const client = createClientMock();
    client.get.mockResolvedValueOnce({ status: "pending" });

    await getCredentialOAuthStatus(
      client as unknown as ApiClient,
      "claude-code",
      "anthropic",
      "sess-1",
    );

    expect(client.get).toHaveBeenCalledWith(
      "/harness/claude-code/credentials/anthropic/oauth/session/sess-1",
    );
  });

  it("getScopedDefault GETs the platform route when scope omitted", async () => {
    const client = createClientMock();
    client.get.mockResolvedValueOnce({ scopeNodeId: null });

    await getScopedDefault(client as unknown as ApiClient);

    expect(client.get).toHaveBeenCalledWith("/harness/scoped-defaults");
  });

  it("getScopedDefault GETs the per-scope route", async () => {
    const client = createClientMock();
    client.get.mockResolvedValueOnce({ scopeNodeId: "scope-1" });

    await getScopedDefault(client as unknown as ApiClient, "scope-1");

    expect(client.get).toHaveBeenCalledWith("/harness/scoped-defaults/scope-1");
  });

  it("setScopedDefault PUTs the per-scope route with the body", async () => {
    const client = createClientMock();
    client.put.mockResolvedValueOnce({ scopeNodeId: "scope-1" });

    await setScopedDefault(client as unknown as ApiClient, "scope-1", {
      harnessId: "claude-code",
      modelName: "claude-3-5-sonnet",
      providerName: "anthropic",
    });

    expect(client.put).toHaveBeenCalledWith(
      "/harness/scoped-defaults/scope-1",
      {
        harnessId: "claude-code",
        modelName: "claude-3-5-sonnet",
        providerName: "anthropic",
      },
    );
  });
});

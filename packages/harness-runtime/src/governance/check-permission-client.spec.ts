import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCheckPermission,
  GOVERNANCE_AUTH_FAILED_CODE,
} from "./check-permission-client.js";

const config = { apiBaseUrl: "http://api", agentJwt: "jwt" };

describe("createCheckPermission auth failures", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("exports the auth-failed code constant", () => {
    expect(GOVERNANCE_AUTH_FAILED_CODE).toBe("governance_auth_failed");
  });

  it("tags HTTP 401 with the auth-failed code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve("Unauthorized"),
      }),
    );
    const decision = await createCheckPermission(config)("step_complete", {});
    expect(decision.status).toBe("denied");
    expect((decision as { code?: string }).code).toBe("governance_auth_failed");
    expect((decision as { reason?: string }).reason).toContain("HTTP 401");
  });

  it("tags HTTP 403 with the auth-failed code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve("Forbidden"),
      }),
    );
    const decision = await createCheckPermission(config)("step_complete", {});
    expect((decision as { code?: string }).code).toBe("governance_auth_failed");
  });

  it("leaves other non-OK statuses as an untagged denial", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("boom"),
      }),
    );
    const decision = await createCheckPermission(config)("step_complete", {});
    expect(decision.status).toBe("denied");
    expect((decision as { code?: string }).code).toBeUndefined();
  });
});

import { describe, expect, it, vi } from "vitest";
import { sendJsonRequest } from "./http-request";

describe("sendJsonRequest", () => {
  it("does not retry auth config failures — rejects after exactly 1 attempt", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const AUTH_ERROR_MSG =
      "Core auth requires CORE_BEARER_TOKEN or CORE_JWT_SECRET";
    const authorizationHeaderResolver = vi.fn(() => {
      throw new Error(AUTH_ERROR_MSG);
    });

    await expect(
      sendJsonRequest(
        {
          baseUrl: "http://core.local:3010",
          fetchImpl: fetchMock,
          authorizationHeaderResolver,
        },
        { path: "/internal/core/workflow-runs", method: "POST" },
      ),
    ).rejects.toThrow(AUTH_ERROR_MSG);

    // fetch must never have been called — auth failed before the HTTP request
    expect(fetchMock).not.toHaveBeenCalled();
    // Auth resolver is called exactly once — no retries
    expect(authorizationHeaderResolver).toHaveBeenCalledTimes(1);
  });
});

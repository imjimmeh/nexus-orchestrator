import { describe, expect, it } from "vitest";
import { retryWithBackoff } from "./retry-with-backoff";

describe("retryWithBackoff", () => {
  it("retries the configured number of times then succeeds", async () => {
    let calls = 0;
    const result = await retryWithBackoff(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("ECONNREFUSED");
        return "ok";
      },
      {
        maxAttempts: 5,
        baseDelayMs: 1,
        maxDelayMs: 4,
        shouldRetry: () => true,
      },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("stops retrying when shouldRetry returns false", async () => {
    let calls = 0;
    await expect(
      retryWithBackoff(
        async () => {
          calls += 1;
          throw new Error("400 bad request");
        },
        {
          maxAttempts: 5,
          baseDelayMs: 1,
          maxDelayMs: 4,
          shouldRetry: () => false,
        },
      ),
    ).rejects.toThrow("400");
    expect(calls).toBe(1);
  });
});

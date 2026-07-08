import { describe, expect, it } from "vitest";

import { BaseRequestContextService } from "./base-request-context.service";

class TestRequestContextService extends BaseRequestContextService {
  setUserId(userId: string): void {
    this.setContextValue("userId", userId);
  }
}

describe("BaseRequestContextService", () => {
  it("provides request and causation IDs within a run scope", () => {
    const service = new BaseRequestContextService();

    service.run({ requestId: "req-1", causationId: "cause-1" }, () => {
      expect(service.getContext()).toEqual({
        requestId: "req-1",
        causationId: "cause-1",
      });
      expect(service.getRequestId()).toBe("req-1");
      expect(service.getCausationId()).toBe("cause-1");
    });

    expect(service.getContext()).toBeUndefined();
  });

  it("mutates optional context values within a run scope", () => {
    const service = new TestRequestContextService();

    service.run({ requestId: "req-1" }, () => {
      service.setUserId("user-1");

      expect(service.getContext()?.userId).toBe("user-1");
    });

    expect(service.getContext()).toBeUndefined();
  });
});

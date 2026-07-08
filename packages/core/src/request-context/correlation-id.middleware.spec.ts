import { describe, expect, it, vi } from "vitest";

import { BaseRequestContextService } from "./base-request-context.service";
import {
  CAUSATION_ID_HEADER,
  CORRELATION_ID_HEADER,
  CorrelationIdMiddleware,
  REQUEST_ID_HEADER,
} from "./correlation-id.middleware";

describe("CorrelationIdMiddleware", () => {
  it("sets response headers and runs the next callback inside request context", () => {
    const contextService = new BaseRequestContextService();
    const middleware = new CorrelationIdMiddleware(contextService);
    const setHeader = vi.fn<(name: string, value: string) => void>();
    const next = vi.fn(() => {
      expect(contextService.getRequestId()).toBe("incoming-correlation");
      expect(contextService.getCausationId()).toBe("incoming-cause");
    });

    middleware.use(
      {
        headers: {
          "x-request-id": "incoming-request",
          "x-correlation-id": "incoming-correlation",
          "x-causation-id": "incoming-cause",
        },
      },
      { setHeader },
      next,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      "incoming-correlation",
    );
    expect(setHeader).toHaveBeenCalledWith(
      CORRELATION_ID_HEADER,
      "incoming-correlation",
    );
    expect(setHeader).toHaveBeenCalledWith(
      CAUSATION_ID_HEADER,
      "incoming-cause",
    );
    expect(contextService.getContext()).toBeUndefined();
  });
});

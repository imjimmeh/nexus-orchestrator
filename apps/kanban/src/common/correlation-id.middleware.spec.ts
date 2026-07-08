import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BaseRequestContextService,
  CAUSATION_ID_HEADER,
  CORRELATION_ID_HEADER,
  CorrelationIdMiddleware,
  REQUEST_ID_HEADER,
} from "@nexus/core";

describe("CorrelationIdMiddleware", () => {
  let middleware: CorrelationIdMiddleware;
  let contextService: BaseRequestContextService;

  beforeEach(() => {
    contextService = new BaseRequestContextService();
    middleware = new CorrelationIdMiddleware(contextService);
  });

  it("generates request and correlation IDs when headers are absent", () => {
    const req = { headers: {} } as Request;
    const setHeader = vi.fn<(key: string, value: string) => void>();
    const res = {
      setHeader,
    } as unknown as Response;

    let capturedRequestId: string | undefined;
    const next: NextFunction = () => {
      capturedRequestId = contextService.getRequestId();
    };

    middleware.use(req, res, next);

    expect(capturedRequestId).toBeDefined();
    expect(setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      capturedRequestId,
    );
    expect(setHeader).toHaveBeenCalledWith(
      CORRELATION_ID_HEADER,
      capturedRequestId,
    );
  });

  it("uses incoming correlation and causation IDs", () => {
    const req = {
      headers: {
        "x-correlation-id": "corr-42",
        "x-causation-id": "cause-42",
      },
    } as unknown as Request;
    const setHeader = vi.fn<(key: string, value: string) => void>();
    const res = {
      setHeader,
    } as unknown as Response;

    let requestId: string | undefined;
    let causationId: string | undefined;
    const next: NextFunction = () => {
      requestId = contextService.getRequestId();
      causationId = contextService.getCausationId();
    };

    middleware.use(req, res, next);

    expect(requestId).toBe("corr-42");
    expect(causationId).toBe("cause-42");
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, "corr-42");
    expect(setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, "corr-42");
    expect(setHeader).toHaveBeenCalledWith(CAUSATION_ID_HEADER, "cause-42");
  });
});

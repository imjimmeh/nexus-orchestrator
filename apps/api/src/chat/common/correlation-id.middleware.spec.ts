import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAUSATION_ID_HEADER,
  CORRELATION_ID_HEADER,
  CorrelationIdMiddleware,
  REQUEST_ID_HEADER,
} from '@nexus/core';
import { RequestContextService } from './request-context.service';

describe('CorrelationIdMiddleware', () => {
  let middleware: CorrelationIdMiddleware;
  let contextService: RequestContextService;

  beforeEach(() => {
    contextService = new RequestContextService();
    middleware = new CorrelationIdMiddleware(contextService);
  });

  it('generates request and correlation IDs when headers are not present', () => {
    const req = { headers: {} } as Request;
    const setHeader = vi.fn<(key: string, value: string) => void>();
    const res = {
      setHeader,
    } as unknown as Response;

    let capturedRequestId: string | undefined;
    const next = vi.fn(() => {
      capturedRequestId = contextService.getRequestId();
    }) as unknown as NextFunction;

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(capturedRequestId).toBeDefined();
    expect(capturedRequestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      capturedRequestId,
    );
    expect(setHeader).toHaveBeenCalledWith(
      CORRELATION_ID_HEADER,
      capturedRequestId,
    );
  });

  it('honors incoming correlation and causation IDs', () => {
    const req = {
      headers: {
        'x-correlation-id': 'corr-123',
        'x-causation-id': 'cause-123',
      },
    } as unknown as Request;
    const setHeader = vi.fn<(key: string, value: string) => void>();
    const res = {
      setHeader,
    } as unknown as Response;

    let capturedRequestId: string | undefined;
    let capturedCausationId: string | undefined;
    const next = vi.fn(() => {
      capturedRequestId = contextService.getRequestId();
      capturedCausationId = contextService.getCausationId();
    }) as unknown as NextFunction;

    middleware.use(req, res, next);

    expect(capturedRequestId).toBe('corr-123');
    expect(capturedCausationId).toBe('cause-123');
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, 'corr-123');
    expect(setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, 'corr-123');
    expect(setHeader).toHaveBeenCalledWith(CAUSATION_ID_HEADER, 'cause-123');
  });
});

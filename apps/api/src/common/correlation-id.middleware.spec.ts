import {
  CAUSATION_ID_HEADER,
  CORRELATION_ID_HEADER,
  CorrelationIdMiddleware,
  REQUEST_ID_HEADER,
} from '@nexus/core';
import { RequestContextService } from './request-context.service';
import { Request, Response } from 'express';

// Prevent RequestContextLogger.init from running during tests
vi.mock('./logger.config', () => ({
  RequestContextLogger: {
    init: vi.fn(),
  },
}));

describe('CorrelationIdMiddleware', () => {
  let middleware: CorrelationIdMiddleware;
  let contextService: RequestContextService;

  beforeEach(() => {
    contextService = new RequestContextService();
    middleware = new CorrelationIdMiddleware(contextService);
  });

  it('should generate a request ID when none is provided', () => {
    const req = { headers: {} } as Request;
    const res = {
      setHeader: vi.fn(),
    } as unknown as Response;

    let capturedRequestId: string | undefined;
    const next = vi.fn(() => {
      capturedRequestId = contextService.getRequestId();
    });

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(capturedRequestId).toBeDefined();
    expect(capturedRequestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      capturedRequestId,
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      CORRELATION_ID_HEADER,
      capturedRequestId,
    );
  });

  it('should honour an incoming X-Correlation-ID header over X-Request-ID', () => {
    const req = {
      headers: {
        'x-request-id': 'incoming-id-123',
        'x-correlation-id': 'incoming-correlation-123',
      },
    } as unknown as Request;
    const res = {
      setHeader: vi.fn(),
    } as unknown as Response;

    let capturedRequestId: string | undefined;
    const next = vi.fn(() => {
      capturedRequestId = contextService.getRequestId();
    });

    middleware.use(req, res, next);

    expect(capturedRequestId).toBe('incoming-correlation-123');
    expect(res.setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      'incoming-correlation-123',
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      CORRELATION_ID_HEADER,
      'incoming-correlation-123',
    );
  });

  it('should preserve an incoming X-Causation-ID header', () => {
    const req = {
      headers: {
        'x-request-id': 'incoming-id-456',
        'x-causation-id': 'cause-456',
      },
    } as unknown as Request;
    const res = {
      setHeader: vi.fn(),
    } as unknown as Response;

    let capturedCausationId: string | undefined;
    const next = vi.fn(() => {
      capturedCausationId = contextService.getCausationId();
    });

    middleware.use(req, res, next);

    expect(capturedCausationId).toBe('cause-456');
    expect(res.setHeader).toHaveBeenCalledWith(
      CAUSATION_ID_HEADER,
      'cause-456',
    );
  });

  it('should not leak context after the middleware completes', () => {
    const req = { headers: {} } as Request;
    const res = { setHeader: vi.fn() } as unknown as Response;
    const next = vi.fn();

    middleware.use(req, res, next);

    // Outside the middleware scope, context should be undefined
    expect(contextService.getRequestId()).toBeUndefined();
  });
});

import { BadRequestException, RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RuntimeFeedbackController } from './runtime-feedback.controller';
import {
  RuntimeFeedbackDiagnosticsQueryDto,
  runtimeFeedbackDiagnosticsQuerySchema,
} from './runtime-feedback-diagnostics.service';

describe('RuntimeFeedbackController', () => {
  const getDiagnostics = vi.fn();
  let controller: RuntimeFeedbackController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new RuntimeFeedbackController({
      getDiagnostics,
    } as never);
  });

  it('delegates diagnostics queries to the diagnostics service', async () => {
    const diagnostics = {
      total: 0,
      limit: 20,
      offset: 0,
      signalCounts: [],
      candidateCounts: [],
      skippedReasonCounts: [],
      recentGroups: [],
    };
    const query: RuntimeFeedbackDiagnosticsQueryDto = {
      signalType: 'memory_miss',
      candidateCreated: true,
      limit: 20,
      offset: 0,
    };
    getDiagnostics.mockResolvedValue(diagnostics);

    const response = await controller.getDiagnostics(query);

    expect(getDiagnostics).toHaveBeenCalledWith(query);
    expect(response).toEqual({ success: true, data: diagnostics });
  });

  it('validates diagnostics query filters', () => {
    const pipe = new ZodValidationPipe(runtimeFeedbackDiagnosticsQuerySchema);

    expect(() =>
      pipe.transform(
        {
          signalType: 'not-a-signal',
          candidateCreated: 'maybe',
          limit: '0',
          offset: '-1',
        },
        { type: 'query', metatype: RuntimeFeedbackDiagnosticsQueryDto },
      ),
    ).toThrow(BadRequestException);

    expect(
      pipe.transform(
        {
          signalType: 'memory_miss',
          candidateCreated: 'false',
          limit: '25',
          offset: '5',
        },
        { type: 'query', metatype: RuntimeFeedbackDiagnosticsQueryDto },
      ),
    ).toEqual({
      signalType: 'memory_miss',
      candidateCreated: false,
      limit: 25,
      offset: 5,
    });
  });

  it('protects diagnostics with JwtAuthGuard', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      RuntimeFeedbackController,
    ) as unknown[];

    expect(guards).toEqual([JwtAuthGuard]);
  });

  it('wires GET /runtime-feedback/diagnostics with query validation', () => {
    const handler = RuntimeFeedbackController.prototype.getDiagnostics;
    const routeArgs = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      RuntimeFeedbackController,
      'getDiagnostics',
    ) as Record<string, { index: number; pipes: unknown[] }>;
    const queryParam = Object.values(routeArgs).find(
      (metadata) => metadata.index === 0,
    );

    expect(Reflect.getMetadata(PATH_METADATA, RuntimeFeedbackController)).toBe(
      'runtime-feedback',
    );
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('diagnostics');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.GET,
    );
    expect(queryParam?.pipes).toEqual([
      expect.objectContaining({
        schema: runtimeFeedbackDiagnosticsQuerySchema,
      }),
    ]);
  });
});

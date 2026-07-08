import { BadRequestException, RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { SelfImprovementController } from './self-improvement.controller';
import {
  type PromotedLessonsQuery,
  promotedLessonsQuerySchema,
} from './promoted-lessons.service.types';

describe('SelfImprovementController', () => {
  const getPromotedLessons = vi.fn();
  let controller: SelfImprovementController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new SelfImprovementController({
      getPromotedLessons,
    } as never);
  });

  it('delegates to the service and wraps the response in a success envelope', async () => {
    const serviceResponse = {
      promoted: [
        {
          id: 'segment-1',
          sourceSignalId: 'signal-group-1',
          promotedAt: '2026-07-01T12:00:00.000Z',
          confidence: 0.8,
          workflowSkillBindingIds: ['binding-1'],
        },
      ],
      bindings: [
        {
          id: 'binding-1',
          mostSpecificSource: 'workflow' as const,
          reuseCount7d: 2,
          workflowStepIds: [],
        },
      ],
    };
    getPromotedLessons.mockResolvedValue(serviceResponse);
    const query: PromotedLessonsQuery = { since: new Date() };

    const response = await controller.getPromotedLessons(query);

    expect(getPromotedLessons).toHaveBeenCalledWith(query);
    expect(response).toEqual({ success: true, data: serviceResponse });
  });

  it('protects the route with JwtAuthGuard AND PermissionsGuard', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      SelfImprovementController,
    ) as unknown[];

    expect(guards).toEqual([JwtAuthGuard, PermissionsGuard]);
  });

  it('requires the improvements:read permission on the route handler', () => {
    const required = Reflect.getMetadata(
      'required_permission',
      SelfImprovementController.prototype.getPromotedLessons,
    ) as string;

    expect(required).toBe('improvements:read');
  });

  it('wires GET /self-improvement/promoted-lessons with Zod query validation', () => {
    const handler = SelfImprovementController.prototype.getPromotedLessons;
    const routeArgs = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      SelfImprovementController,
      'getPromotedLessons',
    ) as Record<string, { index: number; pipes: unknown[] }>;
    const queryParam = Object.values(routeArgs).find(
      (metadata) => metadata.index === 0,
    );

    expect(Reflect.getMetadata(PATH_METADATA, SelfImprovementController)).toBe(
      'self-improvement',
    );
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(
      'promoted-lessons',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.GET,
    );
    expect(queryParam?.pipes).toEqual([
      expect.objectContaining({
        schema: promotedLessonsQuerySchema,
      }),
    ]);
  });

  it('rejects an invalid `since` value through the Zod pipe (since=abc)', () => {
    const pipe = new ZodValidationPipe(promotedLessonsQuerySchema);

    expect(() =>
      pipe.transform({ since: 'abc' }, { type: 'query', metatype: Object }),
    ).toThrow(BadRequestException);
  });

  it('rejects an empty `since` value through the Zod pipe (since=)', () => {
    const pipe = new ZodValidationPipe(promotedLessonsQuerySchema);

    expect(() =>
      pipe.transform({ since: '' }, { type: 'query', metatype: Object }),
    ).toThrow(BadRequestException);
  });

  it('accepts a 7-day `since` value through the Zod pipe (since=7d)', () => {
    const pipe = new ZodValidationPipe(promotedLessonsQuerySchema);

    const parsed = pipe.transform(
      { since: '7d' },
      { type: 'query', metatype: Object },
    ) as { since: Date };

    expect(parsed.since).toBeInstanceOf(Date);
  });

  it('accepts a 30-minute `since` value through the Zod pipe (since=30m)', () => {
    const pipe = new ZodValidationPipe(promotedLessonsQuerySchema);

    const parsed = pipe.transform(
      { since: '30m' },
      { type: 'query', metatype: Object },
    ) as { since: Date };

    expect(parsed.since).toBeInstanceOf(Date);
    // 30 minutes back from "now" — the schema transforms at validation
    // time, so the result is always within the last 31 minutes.
    const now = Date.now();
    expect(now - parsed.since.getTime()).toBeGreaterThanOrEqual(30 * 60 * 1000);
    expect(now - parsed.since.getTime()).toBeLessThan(31 * 60 * 1000);
  });
});

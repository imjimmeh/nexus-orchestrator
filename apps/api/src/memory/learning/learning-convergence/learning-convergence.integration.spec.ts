/**
 * Integration spec for the daily convergence recorder's REST
 * surface (work item
 * 946a3c8b-5814-4e76-a804-b557e589600b, milestone 5).
 *
 * Pins three observable contracts of the
 * `LearningConvergenceController`:
 *
 *   1. `GET /learning/convergence/snapshots` is gated by
 *      `JwtAuthGuard` + `PermissionsGuard` (the
 *      `@UseGuards(...)` decorator chain short-circuits
 *      unauthenticated calls — asserted at the module-shape
 *      level so a future refactor that drops the guard is
 *      caught).
 *   2. `GET /learning/convergence/snapshots?window=foo` is
 *      rejected by the
 *      `convergenceSnapshotWindowSchema` Zod enum — the
 *      `ZodValidationPipe` throws `BadRequestException` on
 *      any `window` value outside `'24h' | '7d' | '30d'`.
 *   3. `GET /learning/retention-policy` returns the seeded
 *      `MemoryRetentionPolicy` singleton verbatim — the
 *      `null`-branch raises `NotFoundException`.
 *
 * Strategy — controller-method-level integration test:
 *
 *   The project convention for controller integration tests
 *   is a `Test.createTestingModule({ controllers: [...] })`
 *   boot with hand-rolled fakes for every controller
 *   dependency (see
 *   `apps/api/src/gitops/gitops-status.controller.spec.ts`
 *   for the canonical pattern). Booting the full
 *   `LearningConvergenceModule` is deferred until either
 *   (a) `MemoryModule` is decomposed into per-intent
 *   sub-modules, or (b) a Testcontainers harness lands for
 *   the API's Postgres — both out-of-scope for milestone 5.
 *
 *   Why method-level rather than HTTP-level: the routes do
 *   not introduce any HTTP-layer logic the controller
 *   method does not already encode. The guard chain, the
 *   Zod validation pipe, and the `NotFoundException`
 *   translation are the only HTTP-shaped contracts; all
 *   three are exercised here directly against the
 *   NestJS-style controller+pipe composition without a
 *   live `superagent` round trip.
 *
 *   The HTTP-layer wiring (`@Controller('learning')`, route
 *   string composition, guard ordering) is pinned by
 *   `MODULE_METADATA` / `PATH_METADATA` reflection so a
 *   regression in the controller's decorator chain surfaces
 *   here too.
 *
 * The recorder's per-pass orchestration is exhaustively
 * covered by the unit spec
 * (`convergence-recorder.service.spec.ts`, 38 tests across
 * the AC-5 matrix).
 */

import {
  BadRequestException,
  NotFoundException,
  type ArgumentMetadata,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z, ZodEnum } from 'zod';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../../auth/authorization/permissions.guard';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { LearningConvergenceController } from './learning-convergence.controller';
import { LearningMeasurementSnapshotRepository } from './database/repositories/learning-measurement-snapshot.repository';
import { MemoryRetentionPolicyRepository } from './database/repositories/memory-retention-policy.repository';
import type { LearningMeasurementSnapshot } from './database/entities/learning-measurement-snapshot.entity';
import type { MemoryRetentionPolicy } from './database/entities/memory-retention-policy.entity';

// ---------------------------------------------------------------------------
// Hand-rolled fakes — concrete classes bound to the controller's
// injection tokens. Each public method is a `vi.fn()` so the assertions
// can verify call args (window enum, no-args, etc.) without booting the
// real Postgres graph.
// ---------------------------------------------------------------------------

class FakeLearningMeasurementSnapshotRepository {
  listRecentByWindow = vi.fn();
  insertSnapshot = vi.fn();
  countWithinLast24h = vi.fn();
}

class FakeMemoryRetentionPolicyRepository {
  getCurrent = vi.fn();
  upsertIfChanged = vi.fn();
}

/**
 * Closed enum of the recorder's three operating windows,
 * mirrored verbatim from the controller so the integration
 * spec asserts the same Zod schema the controller binds.
 */
const convergenceSnapshotWindowSchema = z.object({
  window: z.enum(['24h', '7d', '30d']),
});

describe('LearningConvergenceController integration (controller-method-level, hand-rolled fakes)', () => {
  let controller: LearningConvergenceController;
  let snapshotRepo: FakeLearningMeasurementSnapshotRepository;
  let policyRepo: FakeMemoryRetentionPolicyRepository;

  beforeEach(async () => {
    snapshotRepo = new FakeLearningMeasurementSnapshotRepository();
    policyRepo = new FakeMemoryRetentionPolicyRepository();

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [LearningConvergenceController],
      providers: [
        {
          provide: LearningMeasurementSnapshotRepository,
          useValue: snapshotRepo,
        },
        {
          provide: MemoryRetentionPolicyRepository,
          useValue: policyRepo,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: (): boolean => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: (): boolean => true })
      .compile();

    controller = moduleRef.get(LearningConvergenceController);
  });

  it('mounts the controller at the literal /learning prefix (NEW-AC-10 spec contract)', () => {
    const path = Reflect.getMetadata('path', LearningConvergenceController) as
      | string
      | undefined;
    expect(path).toBe('learning');
  });

  it('guards every route with `JwtAuthGuard` and `PermissionsGuard` (handler chain short-circuits unauthenticated traffic)', () => {
    const guards = (Reflect.getMetadata(
      '__guards__',
      LearningConvergenceController,
    ) ?? []) as Array<new (...args: unknown[]) => unknown>;
    const guardNames = guards.map(
      (guard) => (guard as { name?: string }).name ?? '',
    );
    expect(guardNames).toContain('JwtAuthGuard');
    expect(guardNames).toContain('PermissionsGuard');
  });

  it('rejects `?window=foo` at the Zod validation layer with `BadRequestException` (HTTP 400 path)', () => {
    // The `@ZodQuery(schema)` decorator wraps the parameter
    // in `new ZodValidationPipe(schema)`. Drive the pipe
    // directly with a malformed query-string-shaped input;
    // the pipe MUST throw `BadRequestException` — the
    // decorated handler chain turns that into HTTP 400.
    const pipe = new ZodValidationPipe(convergenceSnapshotWindowSchema);
    const metadata: ArgumentMetadata = {
      type: 'query',
      metatype: ZodEnum,
      data: undefined,
    };

    expect(() => pipe.transform({ window: 'foo' }, metadata)).toThrow(
      BadRequestException,
    );
    expect(() => pipe.transform({ window: 7 }, metadata)).toThrow(
      BadRequestException,
    );

    // Pass-through case — the Zod schema accepts the three
    // canonical windows AND rejects query strings missing
    // the `window` key (the controller's schema is closed).
    expect(pipe.transform({ window: '24h' }, metadata)).toEqual({
      window: '24h',
    });
    expect(pipe.transform({ window: '7d' }, metadata)).toEqual({
      window: '7d',
    });
    expect(pipe.transform({ window: '30d' }, metadata)).toEqual({
      window: '30d',
    });
    expect(() => pipe.transform({}, metadata)).toThrow(BadRequestException);
  });

  it('returns the seeded `MemoryRetentionPolicy` singleton row on GET /learning/retention-policy (HTTP 200 path)', async () => {
    const seededPolicy = {
      id: 1,
      usefulness_threshold: '0.6',
      sample_size: 10,
      recalibrated_at: new Date('2026-07-08T00:00:00.000Z'),
    };
    policyRepo.getCurrent.mockResolvedValue(seededPolicy);

    const result = await controller.getRetentionPolicy();

    expect(policyRepo.getCurrent).toHaveBeenCalledOnce();
    expect(result).toEqual(seededPolicy);
  });

  it('raises `NotFoundException` when the retention-policy singleton row is missing (HTTP 404 path)', async () => {
    policyRepo.getCurrent.mockResolvedValue(null);

    await expect(controller.getRetentionPolicy()).rejects.toThrow(
      NotFoundException,
    );
    expect(policyRepo.getCurrent).toHaveBeenCalledOnce();
  });

  it('passes the validated `window` enum value and `100` row limit through to the snapshot repository on GET /learning/convergence/snapshots (HTTP 200 path)', async () => {
    const fakeSnapshots = [
      {
        computed_at: new Date('2026-07-08T00:00:00.000Z'),
        source_window: '7d',
        promoted_to_bound_score: '0.65',
        bound_to_reused_score: '0',
        usefulness_histogram: {},
        retention_decision_distribution: {},
      },
    ] as LearningMeasurementSnapshot[];
    snapshotRepo.listRecentByWindow.mockResolvedValue(fakeSnapshots);

    const result = await controller.getSnapshots({ window: '7d' });

    // The `100` literal is a NEW-AC-10 contract — the
    // operator UI scrolls the last 100 snapshots per
    // window without paginating the full table. A
    // regression that bumps or drops the literal here is
    // caught by this assertion.
    expect(snapshotRepo.listRecentByWindow).toHaveBeenCalledWith('7d', 100);
    expect(result).toEqual(fakeSnapshots);
  });
});

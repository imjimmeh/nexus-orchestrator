import { Controller, Get, NotFoundException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../../auth/authorization/permissions.guard';
import { RequirePermission } from '../../../auth/authorization/require-permission.decorator';
import { ZodQuery } from '../../../common/decorators/zod-query.decorator';
import { LearningMeasurementSnapshot } from './database/entities/learning-measurement-snapshot.entity';
import { MemoryRetentionPolicy } from './database/entities/memory-retention-policy.entity';
import { LearningMeasurementSnapshotRepository } from './database/repositories/learning-measurement-snapshot.repository';
import { MemoryRetentionPolicyRepository } from './database/repositories/memory-retention-policy.repository';

/**
 * Closed enum of the recorder's three operating windows,
 * mirrored verbatim from
 * `learning-measurement-snapshot.entity.types`
 * (`LearningMeasurementSnapshotSourceWindow`). The
 * controller declares its own copy so the OpenAPI surface is
 * self-contained — a follow-up that adds `'90d'` to the
 * entity type forces a matching bump in this Zod schema.
 */
const convergenceSnapshotWindowSchema = z.object({
  window: z.enum(['24h', '7d', '30d']),
});

type ConvergenceSnapshotWindowQuery = z.infer<
  typeof convergenceSnapshotWindowSchema
>;

/**
 * REST surface for the daily convergence recorder's read-side
 * (work item 946a3c8b-5814-4e76-a804-b557e589600b,
 * milestone 5).
 *
 * The controller is the operator UI's read window into the
 * recorder's persistence:
 *
 *   - `GET /learning/convergence/snapshots?window={24h|7d|30d}`
 *     returns the most recent 100 `LearningMeasurementSnapshot`
 *     rows for the requested window (newest first, bounded by
 *     the `(computed_at DESC)` index the migration created).
 *   - `GET /learning/retention-policy` returns the
 *     recorder-calibrated `MemoryRetentionPolicy` singleton
 *     (the row the recorder rewrites on every pass).
 *
 * Mounted at the literal `@Controller('learning')` prefix per
 * the milestone-5 spec — NOT under `memory/learning` like the
 * sibling `LearningController` because the convergence
 * surfaces are owned by the recorder, not the learning
 * candidate pipeline, and the operator UI hits them via the
 * neutral `/learning/...` base. The two routes (`memory/learning/*`
 * and `learning/*`) co-exist without conflict because NestJS
 * route resolution is full-prefix.
 *
 * Decorator contract mirrors `LearningController` /
 * `SystemMemoryController` exactly: `@UseGuards(JwtAuthGuard,
 * PermissionsGuard)` at the class level, `@RequirePermission('memory:read')`
 * at the method level (these are operator-UI reads, not
 * candidate-management writes), and `@ZodQuery(...)` for the
 * query-string validation so the Zod `window` enum and the
 * entity's `LearningMeasurementSnapshotSourceWindow` enum
 * stay in lockstep.
 *
 * The controller is intentionally write-free (the recorder
 * owns the write path via the BullMQ-scheduled pass). The
 * `GET /learning/retention-policy` handler returns 404 when
 * the singleton row is missing — a defensive guard for a
 * developer-mode DB whose seed migration did not run; in
 * production the migration is always-applied so the row is
 * always present.
 */
@ApiTags('learning')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('learning')
export class LearningConvergenceController {
  constructor(
    private readonly snapshotRepo: LearningMeasurementSnapshotRepository,
    private readonly policyRepo: MemoryRetentionPolicyRepository,
  ) {}

  /**
   * List the most recent 100 convergence snapshots for the
   * requested operator-visible window. The window is the
   * recorder's three-value enum (`'24h' | '7d' | '30d'`) —
   * any other value yields a `ZodValidationPipe` 400.
   *
   * Delegates to the entity-local
   * {@link LearningMeasurementSnapshotRepository.listRecentByWindow}
   * so the controller stays a pure transport shim — no SQL,
   * no filtering, no pagination logic in the handler body.
   */
  @Get('convergence/snapshots')
  @RequirePermission('memory:read')
  @ApiOperation({
    summary:
      'List the most recent 100 convergence measurement snapshots for a window',
  })
  async getSnapshots(
    @ZodQuery(convergenceSnapshotWindowSchema)
    query: ConvergenceSnapshotWindowQuery,
  ): Promise<LearningMeasurementSnapshot[]> {
    return this.snapshotRepo.listRecentByWindow(query.window, 100);
  }

  /**
   * Return the recorder-calibrated retention-policy singleton
   * row. The recorder writes the row on every pass via
   * `MemoryRetentionPolicyRepository.upsertIfChanged`, so the
   * `getCurrent()` call should always hit a row in production.
   *
   * Throws `NotFoundException` (HTTP 404) when the singleton
   * is missing — a defensive guard for a developer-mode DB
   * whose seed migration has not run yet. The 404 carries an
   * operator-readable message so the UI can render a
   * meaningful "policy not yet calibrated" placeholder while
   * the cron recorder warms up.
   */
  @Get('retention-policy')
  @RequirePermission('memory:read')
  @ApiOperation({
    summary: 'Get the recorder-calibrated memory retention policy singleton',
  })
  async getRetentionPolicy(): Promise<MemoryRetentionPolicy> {
    const row = await this.policyRepo.getCurrent();
    if (!row) {
      throw new NotFoundException('Retention policy not yet calibrated.');
    }
    return row;
  }
}

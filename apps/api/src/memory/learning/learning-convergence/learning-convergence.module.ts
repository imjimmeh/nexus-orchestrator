import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../../../auth/auth.module';
import { AuthorizationModule } from '../../../auth/authorization/authorization.module';
import { DatabaseModule } from '../../../database/database.module';
import { ObservabilityModule } from '../../../observability/observability.module';
import { MemoryModule } from '../../memory.module';
import { LearningConvergenceController } from './learning-convergence.controller';

/**
 * Module for the daily convergence recorder's read-side REST
 * surface (work item
 * 946a3c8b-5814-4e76-a804-b557e589600b, milestone 5).
 *
 * The module owns exactly one thing:
 * {@link LearningConvergenceController}. The write-side
 * (recorder service, BullMQ processor, cron scheduler)
 * continues to live on `MemoryModule` because the cron /
 * BullMQ scaffold is owned by the three sibling reapers
 * (`MemoryEvictionReaperService`, `MemoryDecayReaperService`,
 * `MemoryDriftDetectionService`) — the M5 milestone
 * deliberately does NOT split the cron scaffold off the
 * recorder just to move the controller.
 *
 * `forwardRef(() => MemoryModule)` is wired even though the
 * controller does not currently inject anything from
 * `MemoryModule`. The forwardRef is the same defensive
 * shape `LearningModule` uses on its edge into `MemoryModule`
 * — a future milestone that adds a write-from-controller
 * endpoint (manual recorder trigger, AC-4's operator
 * trigger) will need to inject the recorder service, and the
 * `MemoryModule` -> `LearningConvergenceModule` edge that the
 * M5 spec adds on the parent side is exactly the bidirectional
 * `forwardRef` pair that handles the cycle without renames.
 *
 * The repositories the controller depends on
 * ({@link LearningMeasurementSnapshotRepository},
 * {@link MemoryRetentionPolicyRepository}) are provided and
 * exported by `DatabaseModule` (which already imports
 * `MemoryModule` indirectly via `MemorySignalsModule`'s
 * imports — see `apps/api/src/database/database.module.ts`
 * lines 147-150 / 349-350 for the M1 repository registration).
 * Injecting them here does not require any new wiring on
 * `DatabaseModule`.
 *
 * `AuthModule` / `AuthorizationModule` / `ObservabilityModule`
 * are imported so the controller's
 * `@UseGuards(JwtAuthGuard, PermissionsGuard)` /
 * `@RequirePermission('memory:read')` decorators resolve the
 * same guards the sibling `LearningController` /
 * `SystemMemoryController` resolve. Mirroring the sibling
 * controllers' module-graph exactly avoids an "Auth guard not
 * resolved from this module" surprises during testing.
 */
@Module({
  imports: [
    AuthModule,
    AuthorizationModule,
    DatabaseModule,
    ObservabilityModule,
    forwardRef(() => MemoryModule),
  ],
  controllers: [LearningConvergenceController],
  providers: [],
  exports: [],
})
export class LearningConvergenceModule {}

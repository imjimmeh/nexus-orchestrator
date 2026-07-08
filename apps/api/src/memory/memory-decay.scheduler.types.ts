/**
 * Type surface for the memory-decay BullMQ scheduler helper
 * (`memory-decay.scheduler.ts`).
 */
import type { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { SystemSettingsService } from '../settings/system-settings.service';

/**
 * Dependencies required to register the memory-decay repeatable
 * job. All collaborators are passed explicitly so the helper is
 * trivially unit-testable (no DI container, no `this` indirection).
 */
export interface MemoryDecaySchedulerDeps {
  readonly queue?: Queue;
  readonly settings: SystemSettingsService;
  readonly logger: Logger;
}

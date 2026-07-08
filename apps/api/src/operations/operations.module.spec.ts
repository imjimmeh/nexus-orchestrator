import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { DoctorWorkflowRepairService } from './doctor-workflow-repair.service';
import { OperationsModule } from './operations.module';

describe('OperationsModule', () => {
  it('registers workflow repair dependency required by doctor repair executor', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      OperationsModule,
    ) as unknown[];

    expect(providers).toContain(DoctorWorkflowRepairService);
  });
});

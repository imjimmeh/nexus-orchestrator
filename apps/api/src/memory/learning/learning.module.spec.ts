import { Module } from '@nestjs/common';
import { MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { AuthModule } from '../../auth/auth.module';
import { DatabaseModule } from '../../database/database.module';
import { LearningCandidateRepository } from '../database/repositories/learning-candidate.repository';
import { MemorySegmentCrudRepository } from '../database/repositories/memory-segment.crud.repository';
import { MemorySegmentLearningCandidateRepository } from '../database/repositories/memory-segment.learning-candidate.repository';
import { MemoryManagerService } from '../memory-manager.service';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { ObservabilityModule } from '../../observability/observability.module';
import { AiConfigModule } from '../../ai-config/ai-config.module';
import { AuthorizationModule } from '../../auth/authorization/authorization.module';
import { SystemSettingsModule } from '../../settings/system-settings.module';
import { LearningController } from './learning.controller';
import { LearningModule } from './learning.module';
import { LearningService } from './learning.service';
import { LearningPromotionPolicyService } from './learning-promotion-policy.service';
import { LearningPromotionService } from './learning-promotion.service';
import { MemoryModule } from '../memory.module';
import { RecordLearningService } from './record-learning.service';
import {
  WORKFLOW_ENGINE_SERVICE,
  WORKFLOW_PARSER_SERVICE,
  STATE_MACHINE_SERVICE,
  WORKFLOW_PERSISTENCE_SERVICE,
} from '../../workflow/kernel/interfaces/workflow-kernel.ports';
import { WorkflowCoreModule } from '../../workflow/workflow-core.module';
import { MockWorkflowCoreModule } from '../../testing/mock-workflow-core.module';

@Module({
  providers: [{ provide: MemoryManagerService, useValue: {} }],
  exports: [MemoryManagerService],
})
class MockMemoryModule {
  private readonly moduleName = MockMemoryModule.name;
}

@Module({})
class MockAuthorizationModule {
  private readonly moduleName = MockAuthorizationModule.name;
}

@Module({})
class MockAuthModule {}

@Module({})
class MockAiConfigModule {}

@Module({})
class MockSystemSettingsModule {}

@Module({})
class MockDatabaseModule {}

@Module({
  providers: [{ provide: EventLedgerService, useValue: {} }],
  exports: [EventLedgerService],
})
class MockObservabilityModule {}

describe('LearningModule', () => {
  it('declares the learning controller', () => {
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      LearningModule,
    );

    expect(controllers).toEqual(expect.arrayContaining([LearningController]));
  });

  it('pins the controller route base', () => {
    expect(Reflect.getMetadata(PATH_METADATA, LearningController)).toBe(
      'memory/learning',
    );
  });

  it('registers the learning controller', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [LearningModule],
    })
      .overrideModule(AuthModule)
      .useModule(MockAuthModule)
      .overrideModule(AuthorizationModule)
      .useModule(MockAuthorizationModule)
      .overrideModule(MemoryModule)
      .useModule(MockMemoryModule)
      .overrideModule(AiConfigModule)
      .useModule(MockAiConfigModule)
      .overrideModule(SystemSettingsModule)
      .useModule(MockSystemSettingsModule)
      .overrideModule(WorkflowCoreModule)
      .useModule(MockWorkflowCoreModule)
      .overrideModule(DatabaseModule)
      .useModule(MockDatabaseModule)
      .overrideModule(ObservabilityModule)
      .useModule(MockObservabilityModule)
      .overrideProvider(LearningService)
      .useValue({})
      .overrideProvider(RecordLearningService)
      .useValue({})
      .overrideProvider(LearningPromotionPolicyService)
      .useValue({})
      .overrideProvider(LearningPromotionService)
      .useValue({})
      .overrideProvider(WORKFLOW_ENGINE_SERVICE)
      .useValue({})
      .overrideProvider(WORKFLOW_PARSER_SERVICE)
      .useValue({})
      .overrideProvider(STATE_MACHINE_SERVICE)
      .useValue({})
      .overrideProvider(WORKFLOW_PERSISTENCE_SERVICE)
      .useValue({})
      .useMocker(() => ({}))
      .compile();

    expect(moduleRef.get(LearningController)).toBeInstanceOf(
      LearningController,
    );

    await moduleRef.close();
  });

  it('registers and exports the learning promotion service for controller tasks', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      LearningModule,
    );
    const exports = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      LearningModule,
    );

    expect(providers).toEqual(
      expect.arrayContaining([
        LearningPromotionPolicyService,
        LearningPromotionService,
      ]),
    );
    expect(exports).toEqual(expect.arrayContaining([LearningPromotionService]));
  });

  it('resolves the learning promotion service with memory manager dependency available', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [LearningModule],
    })
      .overrideModule(AuthModule)
      .useModule(MockAuthModule)
      .overrideModule(AuthorizationModule)
      .useModule(MockAuthorizationModule)
      .overrideModule(MemoryModule)
      .useModule(MockMemoryModule)
      .overrideModule(AiConfigModule)
      .useModule(MockAiConfigModule)
      .overrideModule(SystemSettingsModule)
      .useModule(MockSystemSettingsModule)
      .overrideModule(WorkflowCoreModule)
      .useModule(MockWorkflowCoreModule)
      .overrideModule(DatabaseModule)
      .useModule(MockDatabaseModule)
      .overrideModule(ObservabilityModule)
      .useModule(MockObservabilityModule)
      .overrideProvider(LearningService)
      .useValue({})
      .overrideProvider(RecordLearningService)
      .useValue({})
      .overrideProvider(LearningCandidateRepository)
      .useValue({})
      .overrideProvider(MemorySegmentCrudRepository)
      .useValue({})
      .overrideProvider(MemorySegmentLearningCandidateRepository)
      .useValue({})
      .overrideProvider(EventLedgerService)
      .useValue({})
      .overrideProvider(MemoryManagerService)
      .useValue({})
      .overrideProvider(WORKFLOW_ENGINE_SERVICE)
      .useValue({})
      .overrideProvider(WORKFLOW_PARSER_SERVICE)
      .useValue({})
      .overrideProvider(STATE_MACHINE_SERVICE)
      .useValue({})
      .overrideProvider(WORKFLOW_PERSISTENCE_SERVICE)
      .useValue({})
      .useMocker((token) => {
        if (token === LearningCandidateRepository) {
          return {};
        }

        if (
          token === MemorySegmentCrudRepository ||
          token === MemorySegmentLearningCandidateRepository
        ) {
          return {};
        }

        if (token === EventLedgerService) {
          return {};
        }

        return vi.fn();
      })
      .compile();

    expect(moduleRef.get(LearningPromotionService)).toBeInstanceOf(
      LearningPromotionService,
    );

    await moduleRef.close();
  });
});

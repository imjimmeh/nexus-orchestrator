import { forwardRef, Module, OnModuleInit } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { AuthorizationModule } from '../../auth/authorization/authorization.module';
import { DatabaseModule } from '../../database/database.module';
import { MemoryModule } from '../memory.module';
import { ObservabilityModule } from '../../observability/observability.module';
import { AiConfigModule } from '../../ai-config/ai-config.module';
import { SystemSettingsModule } from '../../settings/system-settings.module';
import { WorkflowCoreModule } from '../../workflow/workflow-core.module';
import { WorkflowKernelModule } from '../../workflow/kernel/workflow-kernel.module';
import { LearningController } from './learning.controller';
import { LearningService } from './learning.service';
import { LearningPromotionPolicyService } from './learning-promotion-policy.service';
import { LearningPromotionService } from './learning-promotion.service';
import { PromotionGovernancePolicyService } from './promotion-governance-policy.service';
import { LearningCandidateDecisionService } from './learning-candidate-decision.service';
import { LearningCandidateProposalListener } from './learning-candidate-proposal.listener';
import { RecordLearningService } from './record-learning.service';

@Module({
  imports: [
    AuthModule,
    AuthorizationModule,
    DatabaseModule,
    forwardRef(() => MemoryModule),
    ObservabilityModule,
    AiConfigModule,
    SystemSettingsModule,
    forwardRef(() => WorkflowCoreModule),
    WorkflowKernelModule,
  ],
  controllers: [LearningController],
  providers: [
    LearningService,
    RecordLearningService,
    LearningCandidateProposalListener,
    LearningPromotionPolicyService,
    LearningPromotionService,
    PromotionGovernancePolicyService,
    LearningCandidateDecisionService,
  ],
  exports: [
    RecordLearningService,
    LearningPromotionService,
    PromotionGovernancePolicyService,
  ],
})
export class LearningModule implements OnModuleInit {
  onModuleInit(): void {
    return undefined;
  }
}

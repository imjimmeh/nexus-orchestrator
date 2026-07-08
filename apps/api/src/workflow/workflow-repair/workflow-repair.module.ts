import { forwardRef, Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { MemoryModule } from '../../memory/memory.module';
import { ObservabilityModule } from '../../observability/observability.module';
import { RuntimeFeedbackModule } from '../../runtime-feedback/runtime-feedback.module';
import { SystemSettingsModule } from '../../settings/system-settings.module';
import { WorkflowCoreModule } from '../workflow-core.module';
import { WorkflowHostMountModule } from '../workflow-host-mount/workflow-host-mount.module';
import { RepairExecutorRegistryService } from './repair-executor-registry.service';
import { RepairPolicyService } from './repair-policy.service';
import { SysadminRepairCompletionListener } from './sysadmin-repair-completion.listener';
import { WorkflowFailureClassificationListener } from './workflow-failure-classification.listener';
import { WorkflowFailureClassificationService } from './workflow-failure-classification.service';
import { WorkflowFailureEvidenceCollectorService } from './workflow-failure-evidence.collector';
import { WorkflowFailurePostmortemListener } from './workflow-failure-postmortem.listener';
import { WorkflowPostmortemLearningAggregatorService } from './workflow-failure-postmortem-learning-aggregator.service';
import { PostmortemMemoryBackfiller } from './postmortem-memory-backfiller.service';
import { PostmortemSettingsResolver } from './postmortem-settings-resolver.service';
import { PostmortemWriter } from './postmortem-writer.service';
import { WorkflowRepairContinuationPolicyService } from './workflow-repair-continuation-policy.service';
import { WorkflowRepairCompletionListener } from './workflow-repair-completion.listener';
import { WorkflowRepairDispatchService } from './workflow-repair-dispatch.service';
import { WorkflowFailureDoctorCompletionListener } from './workflow-failure-doctor-completion.listener';
import { WorkflowRunOutcomeAfterLessonListener } from './workflow-run-outcome-after-lesson.listener';

@Module({
  imports: [
    DatabaseModule,
    ObservabilityModule,
    SystemSettingsModule,
    RuntimeFeedbackModule,
    forwardRef(() => WorkflowCoreModule),
    WorkflowHostMountModule,
    forwardRef(() => MemoryModule),
  ],
  providers: [
    RepairExecutorRegistryService,
    RepairPolicyService,
    WorkflowFailureEvidenceCollectorService,
    WorkflowFailureClassificationService,
    WorkflowFailureClassificationListener,
    WorkflowFailurePostmortemListener,
    WorkflowPostmortemLearningAggregatorService,
    PostmortemSettingsResolver,
    PostmortemWriter,
    PostmortemMemoryBackfiller,
    WorkflowRepairDispatchService,
    WorkflowRepairContinuationPolicyService,
    WorkflowRepairCompletionListener,
    SysadminRepairCompletionListener,
    WorkflowFailureDoctorCompletionListener,
    WorkflowRunOutcomeAfterLessonListener,
  ],
  exports: [
    WorkflowFailureClassificationService,
    WorkflowRepairDispatchService,
  ],
})
export class WorkflowRepairModule {}

import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { AiConfigModule } from '../../ai-config/ai-config.module';
import { DatabaseModule } from '../../database/database.module';
import { ExecutionLifecycleModule } from '../../execution-lifecycle/execution-lifecycle.module';
import { ImprovementModule } from '../../improvement/improvement.module';
import { LearningModule } from '../../memory/learning/learning.module';
import { MemoryModule } from '../../memory/memory.module';
import { MemorySignalsModule } from '../../memory/signals/memory-signals.module';
import { ObservabilityModule } from '../../observability/observability.module';
import { RuntimeFeedbackModule } from '../../runtime-feedback/runtime-feedback.module';
import { SystemSettingsModule } from '../../settings/system-settings.module';
import { WorkflowCoreModule } from '../workflow-core.module';
import { WorkflowKernelModule } from '../kernel/workflow-kernel.module';
import { RetrospectiveQueue } from './database/entities/retrospective-queue.entity';
import { RetrospectiveQueueRepository } from './retrospective-queue.repository';
import { RetrospectiveEnqueueListener } from './retrospective-enqueue.listener';
import { RetrospectiveEnqueueService } from './retrospective-enqueue.service';
import { RetrospectiveGateService } from './retrospective-gate.service';
import { RETROSPECTIVE_DRAIN_QUEUE } from './retrospective-drain.constants';
import { RetrospectiveDrainService } from './retrospective-drain.service';
import { RetrospectiveDrainScheduler } from './retrospective-drain.scheduler';
import { RetrospectiveDrainProcessor } from './retrospective-drain.processor';
import { RunTranscriptDigestService } from './run-transcript-digest.service';
import { ChatTranscriptDigestService } from './chat-transcript-digest.service';
import { RetrospectiveAnalysisService } from './retrospective-analysis.service';
import { RetrospectiveFindingsListener } from './retrospective-findings.listener';
import { RetrospectiveOutputRouter } from './retrospective-output-router.service';
import { RetrospectiveTraceService } from './retrospective-trace.service';
import { RETROSPECTIVE_ANALYSIS_PORT } from './retrospective-analysis.port';
import { RETROSPECTIVE_ROUTER_PORT } from './retrospective-router.port';

/**
 * `WorkflowRetrospectiveModule` — scope-neutral home for the EPIC-212
 * Phase-2 retrospective analyst pipeline.
 *
 * Task 1 stood up the durable hand-off: the `retrospective_queue` repository
 * and the terminal-event enqueue listener. Task 2 adds the cheap deterministic
 * `RetrospectiveGateService` that scores queued rows (zero LLM calls) by
 * reusing `MemorySignalsModule`'s `StruggleDetectorService`, the
 * `EventLedgerRepository` exported by `DatabaseModule`, and the operator-tunable
 * weights resolved through `SystemSettingsModule`. Task 3 adds the budget-capped
 * `RetrospectiveDrainService` + its BullMQ scheduler/processor: the windowed
 * cost governor that claims the top-N highest-interest rows and hands each to
 * the analysis PORT (`RETROSPECTIVE_ANALYSIS_PORT`, bound by Task 6 — NOT here).
 * Later tasks add the token-bounded digest and the LLM analyst.
 *
 * The `RetrospectiveQueue` entity is registered with the shared connection in
 * `DatabaseModule`; this module owns the feature-scoped repository binding, the
 * listener, the gate, and the drain trio. The drain depends on the analysis
 * abstraction only; no concrete analysis provider is bound here.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([RetrospectiveQueue]),
    BullModule.registerQueue({ name: RETROSPECTIVE_DRAIN_QUEUE }),
    AiConfigModule,
    DatabaseModule,
    forwardRef(() => ExecutionLifecycleModule),
    forwardRef(() => ImprovementModule),
    forwardRef(() => LearningModule),
    forwardRef(() => MemoryModule),
    forwardRef(() => WorkflowCoreModule),
    MemorySignalsModule,
    ObservabilityModule,
    RuntimeFeedbackModule,
    SystemSettingsModule,
    WorkflowKernelModule,
  ],
  providers: [
    RetrospectiveQueueRepository,
    RetrospectiveEnqueueListener,
    RetrospectiveEnqueueService,
    RetrospectiveGateService,
    RetrospectiveDrainService,
    RetrospectiveDrainScheduler,
    RetrospectiveDrainProcessor,
    RunTranscriptDigestService,
    ChatTranscriptDigestService,
    RetrospectiveAnalysisService,
    RetrospectiveFindingsListener,
    RetrospectiveOutputRouter,
    RetrospectiveTraceService,
    // Task 6 binds the concrete analyzer to the drain's DIP seam so claimed
    // rows are actually analysed (the drain injects this `@Optional()`).
    {
      provide: RETROSPECTIVE_ANALYSIS_PORT,
      useExisting: RetrospectiveAnalysisService,
    },
    // Task 7 binds the concrete output router to the analysis service's DIP
    // seam so novel findings actually persist (the analysis service injects
    // this `@Optional()`); absent it would only log "would route".
    {
      provide: RETROSPECTIVE_ROUTER_PORT,
      useExisting: RetrospectiveOutputRouter,
    },
  ],
  exports: [
    RetrospectiveQueueRepository,
    RetrospectiveEnqueueService,
    RetrospectiveGateService,
    RetrospectiveDrainService,
    RunTranscriptDigestService,
    ChatTranscriptDigestService,
    RetrospectiveAnalysisService,
    RetrospectiveTraceService,
  ],
})
export class WorkflowRetrospectiveModule {
  /** EPIC-212 retrospective analyst pipeline module */
  protected readonly _moduleName = 'WorkflowRetrospectiveModule';
}

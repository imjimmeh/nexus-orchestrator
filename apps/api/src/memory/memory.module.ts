import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { AiConfigModule } from '../ai-config/ai-config.module';
import { AuthModule } from '../auth/auth.module';
import { ObservabilityModule } from '../observability/observability.module';
import { AuthorizationModule } from '../auth/authorization/authorization.module';
import { MemoryManagerService } from './memory-manager.service';
import { MemoryContentScannerService } from './memory-content-scanner.service';
import { MemoryListingService } from './memory-listing.service';
import { TokenCounterService } from './token-counter.service';
import { LLMService } from './llm.service';
import { DistillationConsumer } from './distillation.consumer';
import { DatabaseModule } from '../database/database.module';
import { DatabaseModule as ChatDatabaseModule } from '../chat/database/database.module';
import { MEMORY_BACKEND_TOKEN } from './memory-backend.constants';
import { PostgresMemoryBackendService } from './postgres-memory-backend.service';
import { HonchoMemoryBackendService } from './honcho-memory-backend.service';
import { HonchoFallbackMemoryBackendService } from './honcho-fallback-memory-backend.service';
import { MemoryBackendFactory } from './memory-backend.factory';
import { HonchoClientService } from './honcho-client.service';
import { SystemMemoryController } from './system-memory.controller';
import { ChatMemoryAdminService } from './chat-memory-admin.service';
import { ChatMemoryAdminController } from './chat-memory-admin.controller';
import { LearningModule } from './learning/learning.module';
import { PluginKernelModule } from '../plugin-kernel/plugin-kernel.module';
import { AiConfigurationService } from '../ai-config/ai-configuration.service';
import {
  MemoryTokenBudgetResolver,
  DEFAULT_MEMORY_BUDGET_FALLBACK_CONTEXT_WINDOW,
  DEFAULT_MEMORY_BUDGET_MEMORY_PERCENT,
  DEFAULT_MEMORY_BUDGET_RESERVED_PERCENT,
  DEFAULT_MEMORY_BUDGET_WORKING_PERCENT,
} from './memory-token-budget.resolver';
import type {
  MemoryTokenBudgetOptions,
  MemoryTokenBudgetPercents,
} from './memory-token-budget.resolver.types';
import { BuiltInMemoryContextProvidersModule } from './built-in-context-providers';
import { MemoryMetricsService } from './memory-metrics.service';
import { MemoryMetricsRefreshService } from './memory-metrics-refresh.service';
import { BackendInstrumentation } from './backend-instrumentation';
import { MetricsService } from '../observability/metrics.service';
import { MemoryMetricsController } from './memory-metrics.controller';
import { DistillationThresholdService } from './distillation-threshold.service';
import { MemorySegmentFeedbackService } from './memory-segment-feedback.service';
import {
  NoopProjectGoalOverrideAccessor,
  PROJECT_GOAL_OVERRIDE_ACCESSOR,
} from './project-goal-override.types';
import { SystemSettingsModule } from '../settings/system-settings.module';
import { MemoryEvictionReaperService } from './memory-eviction.reaper';
import { MemoryEvictionProcessor } from './memory-eviction.processor';
import { MEMORY_EVICTION_QUEUE } from './memory-eviction.constants';
import { MemoryDecayReaperService } from './memory-decay.reaper';
import { MemoryDecayProcessor } from './memory-decay.processor';
import { MEMORY_DECAY_QUEUE } from './memory-decay.constants';
import { MemoryDecaySettingsResolver } from './memory-decay.settings.resolver';
import { MemoryDriftDetectionService } from './memory-drift-detection.service';
import { MemoryDriftProcessor } from './memory-drift.processor';
import { MemoryDriftReferenceParser } from './memory-drift-reference.parser';
import { MemoryDriftCheckers } from './memory-drift-checkers';
import { MEMORY_DRIFT_QUEUE } from './memory-drift.constants';
import { MemoryCronScheduler } from './memory-cron.scheduler';
import { ConvergenceRecorderService } from './learning/learning-convergence/convergence-recorder.service';
import { ConvergenceSnapshotProcessor } from './learning/learning-convergence/convergence-snapshot.processor';
import { MEMORY_CONVERGENCE_SNAPSHOT_QUEUE } from './learning/learning-convergence/convergence.constants';
import { LearningConvergenceModule } from './learning/learning-convergence/learning-convergence.module';
import { MemorySignalsModule } from './signals/memory-signals.module';
import { StruggleDetectorService } from './signals/struggle-detector.service';
import { MemoryProbationEvaluatorService } from './learning/memory-probation-evaluator.service';

@Module({
  imports: [
    AiConfigModule,
    AuthModule,
    AuthorizationModule,
    DatabaseModule,
    ChatDatabaseModule,
    ObservabilityModule,
    BullModule.registerQueue({
      name: 'distillation',
    }),
    BullModule.registerQueue({
      name: MEMORY_EVICTION_QUEUE,
    }),
    BullModule.registerQueue({
      name: MEMORY_DECAY_QUEUE,
    }),
    BullModule.registerQueue({
      name: MEMORY_DRIFT_QUEUE,
    }),
    BullModule.registerQueue({
      name: MEMORY_CONVERGENCE_SNAPSHOT_QUEUE,
    }),
    forwardRef(() => BuiltInMemoryContextProvidersModule),
    forwardRef(() => LearningConvergenceModule),
    MemorySignalsModule,
    forwardRef(() => LearningModule),
    PluginKernelModule,
    SystemSettingsModule,
  ],
  providers: [
    MemoryManagerService,
    MemoryListingService,
    TokenCounterService,
    LLMService,
    DistillationConsumer,
    HonchoClientService,
    PostgresMemoryBackendService,
    HonchoMemoryBackendService,
    HonchoFallbackMemoryBackendService,
    ChatMemoryAdminService,
    MemoryBackendFactory,
    MemoryMetricsService,
    MemoryMetricsRefreshService,
    // Factory provider: BackendInstrumentation takes two concrete service
    // args (not an interface-typed deps object) so NestJS reflection works.
    {
      provide: BackendInstrumentation,
      inject: [MemoryMetricsService, MetricsService],
      useFactory: (
        memoryMetrics: MemoryMetricsService,
        metricsService: MetricsService,
      ) => new BackendInstrumentation(memoryMetrics, metricsService),
    },
    MemoryProbationEvaluatorService,
    DistillationThresholdService,
    MemorySegmentFeedbackService,
    MemoryEvictionReaperService,
    MemoryEvictionProcessor,
    MemoryDecayReaperService,
    MemoryDecayProcessor,
    // Work item 946a3c8b-5814-4e76-a804-b557e589600b, milestone 4:
    // resolves the `memory_decay_usefulness_threshold` value the
    // reaper should use on the next pass via the
    // recorder-calibrated > operator SystemSetting > hardcoded
    // default priority chain. Injected into the reaper as an
    // `@Optional()` dep so test harnesses that omit the resolver
    // still hit the inline `SystemSettingsService.get(...)` path.
    MemoryDecaySettingsResolver,
    MemoryDriftDetectionService,
    MemoryDriftReferenceParser,
    MemoryDriftCheckers,
    MemoryDriftProcessor,
    // Daily convergence recorder (work item
    // 946a3c8b-5814-4e76-a804-b557e589600b, milestone 3).
    // The recorder service owns the daily pass; the
    // processor is the BullMQ `@Processor` shim that
    // dispatches the cron tick into `recorder.tick()`.
    // Registered alongside the three sibling reapers
    // (eviction / decay / drift) so the bootstrap wiring
    // (BullModule.registerQueue + MemoryCronScheduler) is
    // uniform across all four nightly / daily jobs.
    ConvergenceRecorderService,
    ConvergenceSnapshotProcessor,
    // Sole owner of the cron/BullMQ registration scaffold for the
    // three memory reapers (eviction, decay, drift). Replaces the
    // three legacy per-reaper scheduler classes removed in M3 of
    // work item 4ed37f14-073f-420b-97b6-9069356ad408
    // (see `docs/architecture/decisions/ADR-memory-cron-scheduler-extraction.md`).
    // The provider is registered AFTER the `BullModule.registerQueue`
    // imports above so the three `@InjectQueue` tokens
    // (`MEMORY_EVICTION_QUEUE`, `MEMORY_DECAY_QUEUE`,
    // `MEMORY_DRIFT_QUEUE`) are available for injection.
    MemoryCronScheduler,
    StruggleDetectorService,
    MemoryContentScannerService,
    // Per-intent `MemorySegment*` repositories (strangler split of work item
    // b8c754af-9037-45fb-91ed-278752284b0f) are registered and exported by
    // `DatabaseModule` (imported above) alongside the sibling segment
    // repositories, so cross-module consumers resolve them uniformly.
    NoopProjectGoalOverrideAccessor,
    {
      // Default ProjectGoal override accessor. The followup bridge
      // work item will rebind this token to a concrete accessor that
      // delegates to the upstream goal repository. Until then the
      // noop accessor returns null and the resolver falls through to
      // the global SystemSetting / hardcoded default.
      provide: PROJECT_GOAL_OVERRIDE_ACCESSOR,
      useExisting: NoopProjectGoalOverrideAccessor,
    },
    {
      provide: MEMORY_BACKEND_TOKEN,
      inject: [
        MemoryBackendFactory,
        PostgresMemoryBackendService,
        HonchoMemoryBackendService,
        HonchoFallbackMemoryBackendService,
      ],
      useFactory: (
        factory: MemoryBackendFactory,
        postgres: PostgresMemoryBackendService,
        honcho: HonchoMemoryBackendService,
        dual: HonchoFallbackMemoryBackendService,
      ) => factory.create({ postgres, honcho, dual }),
    },
    {
      provide: MemoryTokenBudgetResolver,
      inject: [AiConfigurationService, ConfigService],
      useFactory: (
        aiConfig: AiConfigurationService,
        config: ConfigService,
      ): MemoryTokenBudgetResolver =>
        MemoryTokenBudgetResolver.create(aiConfig, readBudgetOptions(config)),
    },
  ],
  controllers: [
    SystemMemoryController,
    ChatMemoryAdminController,
    MemoryMetricsController,
  ],
  exports: [
    MemoryManagerService,
    MemoryContentScannerService,
    MemoryListingService,
    TokenCounterService,
    LLMService,
    MemoryTokenBudgetResolver,
    MemoryMetricsService,
    DistillationThresholdService,
    MemoryEvictionReaperService,
    MemoryDecayReaperService,
    ConvergenceRecorderService,
    MemorySegmentFeedbackService,
    MemoryDriftDetectionService,
    PROJECT_GOAL_OVERRIDE_ACCESSOR,
    BackendInstrumentation,
    StruggleDetectorService,
    MemorySignalsModule,
  ],
})
/**
 * Memory management and token distillation module.
 *
 * Module-graph wiring uses `forwardRef` on the edge into
 * `BuiltInMemoryContextProvidersModule` to break the bidirectional
 * cycle that the new wiring introduces. Once the stub providers
 * under that module are rewired to `MemoryListingService` and
 * `MemoryManagerService` in milestones M3–M6 (see
 * `docs/architecture/decisions/ADR-built-in-context-provider-stub-wiring.md`),
 * they will need `MemoryModule`'s exports, so `forwardRef` on this
 * edge mirrors the `forwardRef(() => MemoryModule)` that
 * `BuiltInMemoryContextProvidersModule` adds on the opposite edge.
 *
 * This is the same pattern documented in
 * `ADR-0001 — API Module Dependency Inversion & forwardRef Policy`
 * for genuine, tightly-coupled cycles, and the same first-step
 * mitigation applied to the `SessionModule` <-> `TelemetryModule`
 * forwardRef precedent (now removed in favour of lazy `ModuleRef`
 * resolution per ADR-0001).
 */
export class MemoryModule {
  /** Memory management and token distillation module */
  protected readonly _moduleName = 'MemoryModule';
}

/**
 * Build resolver options from the NestJS ConfigService, layering
 * environment overrides on top of the documented defaults.
 *
 * Configuration is intentionally read with loose `get` calls and
 * `??` fallbacks: the validation schema for the API env does not (yet)
 * declare these keys, so they must remain optional. The
 * `MemoryTokenBudgetResolver` constructor performs its own defensive
 * validation of percentages.
 */
function readBudgetOptions(config: ConfigService): MemoryTokenBudgetOptions {
  const percents: MemoryTokenBudgetPercents = {
    memoryPercent: readPercent(
      config,
      'MEMORY_BUDGET_MEMORY_PERCENT',
      DEFAULT_MEMORY_BUDGET_MEMORY_PERCENT,
    ),
    workingPercent: readPercent(
      config,
      'MEMORY_BUDGET_WORKING_PERCENT',
      DEFAULT_MEMORY_BUDGET_WORKING_PERCENT,
    ),
    reservedPercent: readPercent(
      config,
      'MEMORY_BUDGET_RESERVED_PERCENT',
      DEFAULT_MEMORY_BUDGET_RESERVED_PERCENT,
    ),
  };
  const fallback = config.get<number>('MEMORY_BUDGET_FALLBACK_CONTEXT_WINDOW');

  return {
    ...percents,
    fallbackContextWindow:
      typeof fallback === 'number' && fallback > 0
        ? fallback
        : DEFAULT_MEMORY_BUDGET_FALLBACK_CONTEXT_WINDOW,
  };
}

function readPercent(
  config: ConfigService,
  key: string,
  fallback: number,
): number {
  const raw = config.get<number | string>(key);
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === 'string') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

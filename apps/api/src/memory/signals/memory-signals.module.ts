import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AiConfigModule } from '../../ai-config/ai-config.module';
import { DatabaseModule } from '../../database/database.module';
import { ObservabilityModule } from '../../observability/observability.module';
import { SystemSettingsModule } from '../../settings/system-settings.module';
import { EMBEDDING_WRITE_QUEUE } from './embedding-write.constants';
import { CANDIDATE_CLUSTERING_QUEUE } from './candidate-clusterer.constants';
import { FEEDBACK_WEIGHT_TUNER_QUEUE } from './feedback-weight-tuner.constants';
import { TemplateNoiseClassifier } from './template-noise.classifier';
import { EmbeddingProviderService } from './embedding-provider.service';
import { EmbeddingWriteEnqueueService } from './embedding-write-enqueue.service';
import { EmbeddingWriteConsumer } from './embedding-write.consumer';
import { EmbeddingBackfillService } from './embedding-backfill.service';
import { LexicalSimilarityService } from './lexical-similarity.service';
import { EmbeddingSimilarityService } from './embedding-similarity.service';
import { CANDIDATE_SIMILARITY } from './candidate-similarity.interface';
import { CandidateClustererService } from './candidate-clusterer.service';
import { CandidateClustererScheduler } from './candidate-clusterer.scheduler';
import { CandidateClustererProcessor } from './candidate-clusterer.processor';
import { CandidatePipelineService } from './candidate-pipeline.service';
import { CandidateScoringService } from './candidate-scoring.service';
import { MemoryRetrievalService } from './memory-retrieval.service';
import { EmbeddingReindexService } from './embedding-reindex.service';
import { LearningRouterService } from '../learning/learning-router.service';
import { MemoryContradictionService } from '../learning/memory-contradiction.service';
import { MemorySegmentFeedbackService } from '../memory-segment-feedback.service';
import { FeedbackWeightTunerService } from './feedback-weight-tuner.service';
import { FeedbackWeightTunerScheduler } from './feedback-weight-tuner.scheduler';
import { FeedbackWeightTunerProcessor } from './feedback-weight-tuner.processor';

@Module({
  imports: [
    AiConfigModule,
    DatabaseModule,
    ObservabilityModule,
    SystemSettingsModule,
    BullModule.registerQueue({ name: EMBEDDING_WRITE_QUEUE }),
    BullModule.registerQueue({ name: CANDIDATE_CLUSTERING_QUEUE }),
    BullModule.registerQueue({ name: FEEDBACK_WEIGHT_TUNER_QUEUE }),
  ],
  providers: [
    TemplateNoiseClassifier,
    EmbeddingProviderService,
    EmbeddingWriteEnqueueService,
    EmbeddingWriteConsumer,
    EmbeddingBackfillService,
    LexicalSimilarityService,
    EmbeddingSimilarityService,
    {
      provide: CANDIDATE_SIMILARITY,
      useExisting: EmbeddingSimilarityService,
    },
    CandidateClustererService,
    CandidateClustererScheduler,
    CandidateClustererProcessor,
    CandidatePipelineService,
    CandidateScoringService,
    MemoryRetrievalService,
    EmbeddingReindexService,
    LearningRouterService,
    MemoryContradictionService,
    MemorySegmentFeedbackService,
    FeedbackWeightTunerService,
    FeedbackWeightTunerScheduler,
    FeedbackWeightTunerProcessor,
  ],
  exports: [
    TemplateNoiseClassifier,
    EmbeddingWriteEnqueueService,
    EmbeddingBackfillService,
    EmbeddingProviderService,
    LexicalSimilarityService,
    EmbeddingSimilarityService,
    CANDIDATE_SIMILARITY,
    CandidateClustererService,
    CandidateScoringService,
    MemoryRetrievalService,
    LearningRouterService,
    MemoryContradictionService,
    FeedbackWeightTunerService,
  ],
})
export class MemorySignalsModule {}

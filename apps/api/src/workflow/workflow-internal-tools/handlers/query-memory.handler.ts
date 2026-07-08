import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  IMemorySegment,
  InternalToolExecutionContext,
  QueryMemoryFeedbackBody,
} from '@nexus/core';
import { MemoryManagerService } from '../../../memory/memory-manager.service';
import { MemorySegmentFeedbackService } from '../../../memory/memory-segment-feedback.service';
import { requireNonEmptyString } from '../../workflow-runtime/workflow-runtime-tools.helpers';
import {
  readAgentProfileId,
  readWorkflowRunId,
  toQueryMemorySegmentProjection,
  validateQueryMemoryResponse,
} from './query-memory.helpers';
import type {
  QueryMemoryFeedbackAck,
  QueryMemoryLearningProjection,
  QueryMemorySegmentProjection,
} from './query-memory.types';

/**
 * Extracted handler for the `query_memory` runtime capability
 * (refactoring work item: split `MemoryToolsHandler` per public
 * method). Behaviour is identical to the previous aggregate's
 * `queryMemory` implementation — same input parsing, same service
 * call ordering, same response shape — so the existing handler
 * spec continues to exercise the read path unchanged.
 *
 * The constructor surface is intentionally narrow: only the two
 * services this read path actually touches
 * (`MemoryManagerService` for segment search / listing and
 * `MemorySegmentFeedbackService` for usefulness lookup + feedback
 * write) are injected. All other dependencies the aggregate
 * carries stay on the aggregate, which keeps the wiring graph
 * here honest.
 */
@Injectable()
export class QueryMemoryHandler {
  private readonly logger = new Logger(QueryMemoryHandler.name);

  constructor(
    private readonly memoryManager: MemoryManagerService,
    private readonly feedbackService: MemorySegmentFeedbackService,
  ) {}

  async queryMemory(
    context: InternalToolExecutionContext,
    params: {
      entity_type: string;
      entity_id: string;
      query?: string;
      memory_type?: 'preference' | 'fact' | 'history';
      include_learning?: boolean;
      include_provenance?: boolean;
      feedback?: QueryMemoryFeedbackBody;
    },
  ): Promise<Record<string, unknown>> {
    const entityType = requireNonEmptyString(params.entity_type, 'entity_type');
    const entityId = requireNonEmptyString(params.entity_id, 'entity_id');
    const query =
      typeof params.query === 'string' && params.query.trim().length > 0
        ? params.query.trim()
        : null;
    const includeProvenance = params.include_provenance !== false;

    const feedbackAck = await this.recordFeedbackIfPresent({
      context,
      queryId: randomUUID(),
      feedback: params.feedback,
    });

    const segments = query
      ? await this.memoryManager.searchMemory(entityType, entityId, query)
      : await this.memoryManager.getMemorySegments(entityType, entityId, {
          memory_type: params.memory_type,
        });

    const projectedSegments = await this.projectSegmentsWithUsefulness(
      segments,
      includeProvenance,
    );

    const response: Record<string, unknown> = {
      entity_type: entityType,
      entity_id: entityId,
      query,
      memory_type: params.memory_type ?? null,
      count: segments.length,
      segments: projectedSegments,
      feedback: feedbackAck,
    };

    if (params.include_learning === true) {
      const learningProjection = await this.loadPromotedLearningProjection(
        entityType,
        entityId,
        query,
        includeProvenance,
      );
      if (learningProjection !== null) {
        response.learning =
          await this.attachUsefulnessToLearning(learningProjection);
      } else {
        response.learning = null;
      }
    }

    validateQueryMemoryResponse(response, this.logger);

    return response;
  }

  private async recordFeedbackIfPresent(params: {
    context: InternalToolExecutionContext;
    queryId: string;
    feedback: QueryMemoryFeedbackBody | undefined;
  }): Promise<QueryMemoryFeedbackAck | null> {
    if (params.feedback === undefined) {
      return null;
    }

    const agentProfile = readAgentProfileId(params.context);
    const workflowRunId = readWorkflowRunId(params.context);
    const persisted = await this.feedbackService.recordFeedback({
      segmentId: params.feedback.segment_id,
      queryId: params.queryId,
      agentProfileId: agentProfile,
      workflowRunId,
      useful: params.feedback.useful,
      reason: params.feedback.reason ?? null,
    });

    return {
      id: persisted.id,
      segment_id: persisted.segment_id,
      useful: persisted.useful,
    };
  }

  private async projectSegmentsWithUsefulness(
    segments: IMemorySegment[],
    includeProvenance: boolean,
  ): Promise<QueryMemorySegmentProjection[]> {
    if (segments.length === 0) {
      return [];
    }

    const segmentIds = segments.map((segment) => segment.id);
    const usefulnessBySegment =
      await this.feedbackService.computeUsefulnessForSegments(segmentIds);

    return segments.map((segment) => {
      const projection = toQueryMemorySegmentProjection(
        segment,
        includeProvenance,
      );
      const usefulness = usefulnessBySegment.get(segment.id);
      return {
        ...projection,
        usefulness: usefulness?.usefulness ?? null,
      };
    });
  }

  private async attachUsefulnessToLearning(
    learning: QueryMemoryLearningProjection,
  ): Promise<QueryMemoryLearningProjection> {
    if (learning.segments.length === 0) {
      return learning;
    }
    const segmentIds = learning.segments.map((segment) => segment.id);
    const usefulnessBySegment =
      await this.feedbackService.computeUsefulnessForSegments(segmentIds);
    return {
      ...learning,
      segments: learning.segments.map((segment) => {
        const usefulness = usefulnessBySegment.get(segment.id);
        return {
          ...segment,
          usefulness: usefulness?.usefulness ?? null,
        };
      }),
    };
  }

  private async loadPromotedLearningProjection(
    entityType: string,
    entityId: string,
    query: string | null,
    includeProvenance: boolean,
  ): Promise<QueryMemoryLearningProjection | null> {
    try {
      const learningSegments =
        await this.memoryManager.searchPromotedLessonsByScope({
          entity_type: entityType,
          entity_id: entityId,
          ...(query !== null ? { query } : {}),
        });

      return {
        query: query ?? '',
        count: learningSegments.length,
        segments: learningSegments.map((segment) =>
          toQueryMemorySegmentProjection(segment, includeProvenance),
        ),
      };
    } catch (error) {
      this.logger.warn(
        `queryMemory include_learning lookup failed for ${entityType}:${entityId}: ${(error as Error).message}`,
      );
      return null;
    }
  }
}

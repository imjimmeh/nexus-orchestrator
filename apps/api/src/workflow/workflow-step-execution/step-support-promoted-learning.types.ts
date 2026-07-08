import type { MemoryRetrievalService } from '../../memory/signals/memory-retrieval.service';
import type { MemoryManagerService } from '../../memory/memory-manager.service';
import type { SystemSettingsService } from '../../settings/system-settings.service';

export interface PromotedLearningSegmentLike {
  content: string;
  metadata_json?: Record<string, unknown> | null;
}

export interface ResolvedEntityScope {
  entityType: string;
  entityId: string;
}

/**
 * Optional recall identity threaded into promoted-lesson lookups so an
 * agent/workflow's own scoped memories (not just the project/global pools)
 * can surface in the injected context (Epic C).
 */
export interface PromotedLearningRecallIdentity {
  readonly agentProfileName?: string;
  readonly workflowName?: string;
}

/** Service dependencies for `resolvePromotedLessonsForInjection`. */
export interface PromotedLearningInjectionDeps {
  readonly systemSettings: Pick<SystemSettingsService, 'get'>;
  readonly memoryRetrieval: Pick<MemoryRetrievalService, 'retrieve'>;
  readonly memoryManager: Pick<
    MemoryManagerService,
    'searchPromotedLessonsByScope'
  >;
}

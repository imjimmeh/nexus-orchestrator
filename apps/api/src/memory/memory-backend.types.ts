import { IMemorySegment } from '@nexus/core';

/**
 * Local alias for the `memory_type` union. `strategic_intent` was added
 * in EPIC-208 (Milestone 1) to support the CEO long-term planning
 * refresh loop; its structured payload (horizon, priority_themes,
 * focus_areas, constraints, updated_at, updated_by) is stored in
 * `metadata_json` per `strategicIntentBodySchema`.
 */
export type MemoryType = 'preference' | 'fact' | 'history' | 'strategic_intent';
export type MemorySegmentMetadata = Record<string, unknown>;

export interface MemorySegmentFilters {
  entity_id?: string;
  memory_type?: MemoryType;
}

export interface MemoryBackend {
  createMemorySegment(
    entityType: string,
    entityId: string,
    content: string,
    memoryType?: MemoryType,
    metadata?: MemorySegmentMetadata,
  ): Promise<IMemorySegment>;

  getMemorySegments(
    entityType: string,
    entityId: string,
    filters?: MemorySegmentFilters,
  ): Promise<IMemorySegment[]>;

  getMemorySegmentsByType(
    entityType: string,
    filters?: MemorySegmentFilters,
  ): Promise<IMemorySegment[]>;

  updateMemorySegment(
    id: string,
    content: string,
  ): Promise<IMemorySegment | null>;

  /**
   * EPIC-208 (Milestone 1): replace both the textual `content` and the
   * structured `metadata_json` of an existing memory segment in one
   * round-trip. Used by the strategic-intent upsert flow so the latest
   * CEO planning payload always replaces the previous one verbatim.
   *
   * All backends MUST implement this method. Missing metadata persistence
   * is a programming error and will surface as an NotImplementedException
   * at upsert time (see MemoryManagerService.upsertMemorySegment).
   */
  updateMemorySegmentWithMetadata(
    id: string,
    content: string,
    metadata?: MemorySegmentMetadata,
  ): Promise<IMemorySegment | null>;

  deleteMemorySegment(id: string): Promise<void>;

  searchMemory(
    entityType: string,
    entityId: string,
    query: string,
  ): Promise<IMemorySegment[]>;

  searchMemoryByType(
    entityType: string,
    query: string,
    filters?: MemorySegmentFilters,
  ): Promise<IMemorySegment[]>;

  searchPromotedLessonsByScope(opts: {
    entity_type: string;
    entity_id?: string;
    query?: string;
    limit?: number;
  }): Promise<IMemorySegment[]>;
}

export type MemoryBackendMode = 'postgres' | 'honcho' | 'dual';

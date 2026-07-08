import { Injectable } from '@nestjs/common';
import { IMemorySegment } from '@nexus/core';
import { MemorySegmentCrudRepository } from './database/repositories/memory-segment.crud.repository';
import { MemorySegmentSearchRepository } from './database/repositories/memory-segment.search.repository';
import { MemorySegmentLearningCandidateRepository } from './database/repositories/memory-segment.learning-candidate.repository';
import { BackendInstrumentation } from './backend-instrumentation';
import {
  MemoryBackend,
  MemorySegmentMetadata,
  MemorySegmentFilters,
  MemoryType,
} from './memory-backend.types';

@Injectable()
export class PostgresMemoryBackendService implements MemoryBackend {
  constructor(
    private readonly crudRepo: MemorySegmentCrudRepository,
    private readonly searchRepo: MemorySegmentSearchRepository,
    private readonly learningCandidateRepo: MemorySegmentLearningCandidateRepository,
    private readonly backendInstrumentation: BackendInstrumentation,
  ) {}

  async createMemorySegment(
    entityType: string,
    entityId: string,
    content: string,
    memoryType: MemoryType = 'fact',
    metadata?: MemorySegmentMetadata,
  ): Promise<IMemorySegment> {
    return this.backendInstrumentation.recordWrite(
      { backend: 'postgres', operation: 'createMemorySegment' },
      () =>
        this.crudRepo.create({
          entity_type: entityType,
          entity_id: entityId,
          content,
          memory_type: memoryType,
          version: 1,
          ...(metadata === undefined ? {} : { metadata_json: metadata }),
        }),
    );
  }

  async getMemorySegments(
    entityType: string,
    entityId: string,
    filters?: MemorySegmentFilters,
  ): Promise<IMemorySegment[]> {
    return this.backendInstrumentation.recordRead(
      { backend: 'postgres', operation: 'getMemorySegments' },
      async () => {
        let segments = await this.crudRepo.findByEntity(entityType, entityId);
        if (filters?.memory_type) {
          segments = segments.filter(
            (s) => s.memory_type === filters.memory_type,
          );
        }
        return segments;
      },
    );
  }

  async getMemorySegmentsByType(
    entityType: string,
    filters?: MemorySegmentFilters,
  ): Promise<IMemorySegment[]> {
    return this.backendInstrumentation.recordRead(
      { backend: 'postgres', operation: 'getMemorySegmentsByType' },
      async () => {
        let segments = await this.crudRepo.findByEntityType(
          entityType,
          filters?.entity_id,
        );
        if (filters?.memory_type) {
          segments = segments.filter(
            (s) => s.memory_type === filters.memory_type,
          );
        }
        return segments;
      },
    );
  }

  async updateMemorySegment(
    id: string,
    content: string,
  ): Promise<IMemorySegment | null> {
    return this.backendInstrumentation.recordWrite(
      { backend: 'postgres', operation: 'updateMemorySegment' },
      async () => {
        const existing = await this.crudRepo.findById(id);
        if (!existing) {
          return null;
        }

        return this.crudRepo.update(id, {
          content,
          version: existing.version + 1,
        });
      },
    );
  }

  async updateMemorySegmentWithMetadata(
    id: string,
    content: string,
    metadata?: MemorySegmentMetadata,
  ): Promise<IMemorySegment | null> {
    const existing = await this.crudRepo.findById(id);
    if (!existing) {
      return null;
    }

    return this.crudRepo.update(id, {
      content,
      version: existing.version + 1,
      metadata_json: metadata ?? null,
    } as unknown as Parameters<typeof this.crudRepo.update>[1]);
  }

  async deleteMemorySegment(id: string): Promise<void> {
    await this.backendInstrumentation.recordWrite(
      { backend: 'postgres', operation: 'deleteMemorySegment' },
      async () => {
        await this.crudRepo.remove(id);
      },
    );
  }

  async searchMemory(
    entityType: string,
    entityId: string,
    query: string,
  ): Promise<IMemorySegment[]> {
    return this.backendInstrumentation.recordRead(
      { backend: 'postgres', operation: 'searchMemory' },
      () => this.searchRepo.search(entityType, entityId, query),
    );
  }

  async searchMemoryByType(
    entityType: string,
    query: string,
    filters?: MemorySegmentFilters,
  ): Promise<IMemorySegment[]> {
    return this.backendInstrumentation.recordRead(
      { backend: 'postgres', operation: 'searchMemoryByType' },
      async () => {
        let segments = await this.searchRepo.searchByEntityType(
          entityType,
          query,
          filters?.entity_id,
        );
        if (filters?.memory_type) {
          segments = segments.filter(
            (s) => s.memory_type === filters.memory_type,
          );
        }
        return segments;
      },
    );
  }

  async searchPromotedLessonsByScope(opts: {
    entity_type: string;
    entity_id?: string;
    query?: string;
    limit?: number;
  }): Promise<IMemorySegment[]> {
    return this.learningCandidateRepo.findPromotedSegmentsByScope(opts);
  }
}

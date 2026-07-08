import { Injectable } from '@nestjs/common';
import type { IMemorySegment } from '@nexus/core';
import { plan } from './memory-query-planner';
import type { PlannerParams } from './memory-query-planner.types';
import { MemoryManagerService } from './memory-manager.service';
import type {
  ListScopedMemorySegmentsParams,
  MemorySegmentListItem,
  MemorySegmentsPage,
} from './memory-listing.types';

@Injectable()
export class MemoryListingService {
  constructor(private readonly memoryManager: MemoryManagerService) {}

  async listSegments(
    params: ListScopedMemorySegmentsParams,
  ): Promise<MemorySegmentsPage> {
    const query = params.query?.trim();
    const segments = await this.loadSegments({
      ...params,
      query,
    });

    const filteredSegments = params.memoryType
      ? segments.filter((segment) => segment.memory_type === params.memoryType)
      : segments;

    const items = filteredSegments
      .slice(params.offset, params.offset + params.limit)
      .map((segment) => toMemorySegmentListItem(segment));

    return {
      items,
      total: filteredSegments.length,
      limit: params.limit,
      offset: params.offset,
    };
  }

  private async loadSegments(
    params: ListScopedMemorySegmentsParams,
  ): Promise<IMemorySegment[]> {
    const plannerParams: PlannerParams = {
      entityType: params.entityType,
      entityId: params.entityId,
      query: params.query,
      memoryType: params.memoryType,
    };
    const planned = plan(plannerParams);
    switch (planned.method) {
      case 'searchMemory':
        return this.memoryManager.searchMemory(
          ...(planned.args as Parameters<MemoryManagerService['searchMemory']>),
        );
      case 'getMemorySegments':
        return this.memoryManager.getMemorySegments(
          ...(planned.args as Parameters<
            MemoryManagerService['getMemorySegments']
          >),
        );
      case 'searchMemoryByType':
        return this.memoryManager.searchMemoryByType(
          ...(planned.args as Parameters<
            MemoryManagerService['searchMemoryByType']
          >),
        );
      case 'getMemorySegmentsByType':
        return this.memoryManager.getMemorySegmentsByType(
          ...(planned.args as Parameters<
            MemoryManagerService['getMemorySegmentsByType']
          >),
        );
      default: {
        const exhaustive: never = planned.method;
        throw new Error(`Unhandled planner method: ${String(exhaustive)}`);
      }
    }
  }
}

function toMemorySegmentListItem(
  segment: IMemorySegment,
): MemorySegmentListItem {
  return {
    id: segment.id,
    entity_type: segment.entity_type,
    entity_id: segment.entity_id,
    content: segment.content,
    memory_type: segment.memory_type,
    version: segment.version,
    metadata: segment.metadata_json ?? null,
    created_at: toIsoString(segment.created_at),
    updated_at: toIsoString(segment.updated_at),
  };
}

function toIsoString(value: Date | string): string {
  if (typeof value === 'string') {
    return value;
  }

  return value.toISOString();
}

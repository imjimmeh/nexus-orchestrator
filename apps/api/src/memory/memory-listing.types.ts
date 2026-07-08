import type { MemoryType } from './memory-backend.types';

export interface MemorySegmentListItem {
  id: string;
  entity_type: string;
  entity_id: string;
  content: string;
  memory_type: MemoryType;
  version: number;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface MemorySegmentsPage {
  items: MemorySegmentListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListScopedMemorySegmentsParams {
  entityType: string;
  entityId?: string;
  memoryType?: MemoryType;
  query?: string;
  limit: number;
  offset: number;
}

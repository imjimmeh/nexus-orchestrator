export type { OwnerType, EmbeddingWriteJobData } from './embedding-write.types';

export const OWNER_TYPES = {
  memory_segment: 'memory_segment',
  learning_candidate: 'learning_candidate',
} as const;

export const EMBEDDING_WRITE_QUEUE = 'embedding-write';
export const EMBEDDING_WRITE_JOB = 'embed-owner';

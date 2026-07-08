export type OwnerType = 'memory_segment' | 'learning_candidate';

export interface EmbeddingWriteJobData {
  ownerType: OwnerType;
  ownerId: string;
}

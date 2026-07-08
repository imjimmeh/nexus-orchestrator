export * from './learning-candidate.repository';
export * from './memory-embedding.repository';
export * from './memory-segment-feedback.repository';
// Per-intent `MemorySegment*` re-exports added in the strangler
// refactor of work item b8c754af-9037-45fb-91ed-278752284b0f.
// The original `MemorySegmentRepository` was deleted in milestone 4;
// the per-intent classes below are now the canonical import path.
export * from './memory-segment.crud.repository';
export * from './memory-segment.search.repository';
export * from './memory-segment.learning-candidate.repository';
export * from './memory-segment.postmortem.repository';
export * from './memory-segment.decay.repository';
export * from './memory-segment.eviction.repository';
export * from './memory-segment.drift.repository';
export * from './memory-segment.aggregation.repository';
// Daily convergence recorder repositories (work item
// 946a3c8b-5814-4e76-a804-b557e589600b, milestone 1). Mirror the
// per-intent `MemorySegment*` sibling pattern: domain-local
// `database/repositories/` folder with a narrow repository class
// plus a sibling `.repository.types.ts` for the input/output
// shapes that `no-restricted-syntax` keeps off the repository file.
export * from '../../learning/learning-convergence/database/repositories';

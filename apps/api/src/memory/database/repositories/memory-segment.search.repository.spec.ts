import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Like, type Repository } from 'typeorm';
import type { MemorySegment } from '../entities/memory-segment.entity';
import { MemorySegmentSearchRepository } from './memory-segment.search.repository';

// ---------------------------------------------------------------------------
// Substring-search surface for `memory_segments`.
//
// Both methods default to `archived_at IS NULL` (delegated to
// `buildReadWhere`) so the nightly `MemoryDecayReaper` cannot
// silently surface confidence-decayed material through
// `MemoryManagerService.searchMemory`.
//
// The `Like('%query%')` substring shape is preserved verbatim from
// the original — callers (notably the chat memory manager) rely on
// the SQL-LIKE wildcard semantics. Switching to a full-text index
// would change observable behaviour for callers passing raw query
// strings containing `_` or `%`.
// ---------------------------------------------------------------------------

describe('MemorySegmentSearchRepository', () => {
  const find = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('search', () => {
    it('wraps the query in Like(%query%) and applies the archived_at IS NULL default', async () => {
      find.mockResolvedValue([]);
      const repository = new MemorySegmentSearchRepository({
        find,
      } as unknown as Repository<MemorySegment>);

      await repository.search('user', 'user-1', 'preference');

      expect(find).toHaveBeenCalledWith({
        where: {
          entity_type: 'user',
          entity_id: 'user-1',
          content: Like('%preference%'),
          archived_at: expect.anything(),
        },
        order: { created_at: 'DESC' },
      });
    });

    it('honours includeArchived: true by dropping the archived_at filter', async () => {
      find.mockResolvedValue([]);
      const repository = new MemorySegmentSearchRepository({
        find,
      } as unknown as Repository<MemorySegment>);

      await repository.search('user', 'user-1', 'preference', {
        includeArchived: true,
      });

      expect(find).toHaveBeenCalledWith({
        where: {
          entity_type: 'user',
          entity_id: 'user-1',
          content: Like('%preference%'),
        },
        order: { created_at: 'DESC' },
      });
    });
  });

  describe('searchByEntityType', () => {
    it('applies the entity_id branch when entity_id is provided', async () => {
      find.mockResolvedValue([]);
      const repository = new MemorySegmentSearchRepository({
        find,
      } as unknown as Repository<MemorySegment>);

      await repository.searchByEntityType('user', 'preference', 'user-1');

      expect(find).toHaveBeenCalledWith({
        where: expect.objectContaining({
          entity_type: 'user',
          entity_id: 'user-1',
          content: Like('%preference%'),
          archived_at: expect.anything(),
        }),
        order: { created_at: 'DESC' },
      });
    });

    it('omits entity_id when not provided', async () => {
      find.mockResolvedValue([]);
      const repository = new MemorySegmentSearchRepository({
        find,
      } as unknown as Repository<MemorySegment>);

      await repository.searchByEntityType('user', 'preference');

      const whereArg = find.mock.calls[0]?.[0]?.where as Record<
        string,
        unknown
      >;
      expect(whereArg).not.toHaveProperty('entity_id');
      expect(whereArg).toEqual({
        entity_type: 'user',
        content: Like('%preference%'),
        archived_at: expect.anything(),
      });
    });

    it('honours includeArchived: true', async () => {
      find.mockResolvedValue([]);
      const repository = new MemorySegmentSearchRepository({
        find,
      } as unknown as Repository<MemorySegment>);

      await repository.searchByEntityType('user', 'preference', 'user-1', {
        includeArchived: true,
      });

      expect(find).toHaveBeenCalledWith({
        where: {
          entity_type: 'user',
          entity_id: 'user-1',
          content: Like('%preference%'),
        },
        order: { created_at: 'DESC' },
      });
    });

    it('preserves the Like(%query%) substring shape for special characters', async () => {
      // SQL LIKE wildcards (`%`, `_`) MUST be passed through as raw
      // substring matches — the contract is "substring contains",
      // not "interpreted full-text pattern".
      find.mockResolvedValue([]);
      const repository = new MemorySegmentSearchRepository({
        find,
      } as unknown as Repository<MemorySegment>);

      await repository.search('user', 'user-1', '50%_discount');

      expect(find).toHaveBeenCalledWith({
        where: expect.objectContaining({
          content: Like('%50%_discount%'),
        }),
        order: { created_at: 'DESC' },
      });
    });
  });
});

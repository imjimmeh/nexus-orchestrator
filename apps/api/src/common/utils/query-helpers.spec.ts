import { describe, it, expect, vi } from 'vitest';
import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import {
  applyPagination,
  applySearch,
  applySort,
  buildPaginatedMeta,
} from './query-helpers';

function createMockQb(alias = 'e') {
  const qb = {
    alias,
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    take: vi.fn().mockReturnThis(),
  };
  return qb as typeof qb & SelectQueryBuilder<ObjectLiteral>;
}

describe('query-helpers', () => {
  describe('applyPagination', () => {
    it('clamps limit to a max of 100 and computes skip from the clamped limit', () => {
      const qb = createMockQb();
      applyPagination(qb, 2, 500);
      expect(qb.take).toHaveBeenCalledWith(100);
      expect(qb.skip).toHaveBeenCalledWith(100);
    });

    it('clamps limit and page to a min of 1', () => {
      const qb = createMockQb();
      applyPagination(qb, 0, -5);
      expect(qb.take).toHaveBeenCalledWith(1);
      expect(qb.skip).toHaveBeenCalledWith(0);
    });
  });

  describe('applySort', () => {
    it('uses the requested column when allowed', () => {
      const qb = createMockQb('provider');
      applySort(qb, 'name', 'asc', ['name', 'created_at']);
      expect(qb.orderBy).toHaveBeenCalledWith('provider.name', 'ASC');
    });

    it('falls back to created_at desc when the column is not allowed', () => {
      const qb = createMockQb('provider');
      applySort(qb, 'evil_column', undefined, ['name', 'created_at']);
      expect(qb.orderBy).toHaveBeenCalledWith('provider.created_at', 'DESC');
    });
  });

  describe('applySearch', () => {
    it('builds an OR-ed ILIKE clause across the searchable columns', () => {
      const qb = createMockQb('cs');
      applySearch(qb, 'hello', ['display_name', 'initial_message']);
      expect(qb.andWhere).toHaveBeenCalledWith(
        '(cs.display_name ILIKE :searchTerm OR cs.initial_message ILIKE :searchTerm)',
        { searchTerm: '%hello%' },
      );
    });

    it('is a no-op when search is empty', () => {
      const qb = createMockQb('cs');
      applySearch(qb, '', ['display_name']);
      expect(qb.andWhere).not.toHaveBeenCalled();
    });
  });

  describe('buildPaginatedMeta', () => {
    it('computes totalPages correctly', () => {
      const meta = buildPaginatedMeta(150, 2, 20);
      expect(meta.pagination.totalPages).toBe(8);
      expect(meta.pagination.total).toBe(150);
      expect(meta.pagination.page).toBe(2);
      expect(meta.pagination.limit).toBe(20);
    });

    it('handles zero total', () => {
      expect(buildPaginatedMeta(0, 1, 20).pagination.totalPages).toBe(0);
    });
  });
});

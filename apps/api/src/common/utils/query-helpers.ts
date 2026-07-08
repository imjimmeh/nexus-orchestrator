import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

export function applyPagination<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  page: number,
  limit: number,
): SelectQueryBuilder<T> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const safePage = Math.max(page, 1);
  const skip = (safePage - 1) * safeLimit;

  return qb.skip(skip).take(safeLimit);
}

export function applySort<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  sortBy: string | undefined,
  sortDir: 'asc' | 'desc' | undefined,
  allowedColumns: readonly string[],
  defaultSort = 'created_at',
  defaultDir: 'asc' | 'desc' = 'desc',
  entityAlias = qb.alias,
): SelectQueryBuilder<T> {
  const column =
    sortBy && allowedColumns.includes(sortBy) ? sortBy : defaultSort;
  const direction = sortDir ?? defaultDir;

  return qb.orderBy(
    `${entityAlias}.${column}`,
    direction.toUpperCase() as 'ASC' | 'DESC',
  );
}

export function applySearch<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  search: string | undefined,
  searchableColumns: readonly string[],
  entityAlias = qb.alias,
): SelectQueryBuilder<T> {
  if (!search || searchableColumns.length === 0) {
    return qb;
  }

  const searchTerm = `%${search}%`;
  const conditions = searchableColumns.map(
    (col) => `${entityAlias}.${col} ILIKE :searchTerm`,
  );

  return qb.andWhere(`(${conditions.join(' OR ')})`, { searchTerm });
}

export function buildPaginatedMeta(total: number, page: number, limit: number) {
  return {
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export function buildPaginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
) {
  return {
    data,
    meta: buildPaginatedMeta(total, page, limit),
  };
}

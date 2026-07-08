import type { User } from './database/entities/user.entity';

export interface PaginatedUsersResult {
  data: User[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

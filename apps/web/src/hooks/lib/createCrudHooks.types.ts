import type { QueryKey } from "@tanstack/react-query";

export interface CrudQueryKeyFactory {
  all: (params?: Record<string, unknown>) => QueryKey;
  detail: (id: string) => QueryKey;
}

export interface CrudOperations<TItem, TCreate, TUpdate, TParams = void> {
  getAll: (params?: TParams) => Promise<TItem[]>;
  getOne: (id: string) => Promise<TItem>;
  create: (data: TCreate) => Promise<TItem>;
  update: (id: string, data: TUpdate) => Promise<TItem>;
  remove: (id: string) => Promise<void>;
}

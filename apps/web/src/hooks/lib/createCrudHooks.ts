import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type {
  CrudOperations,
  CrudQueryKeyFactory,
} from "./createCrudHooks.types";

export type {
  CrudOperations,
  CrudQueryKeyFactory,
} from "./createCrudHooks.types";

export function createCrudHooks<TItem, TCreate, TUpdate, TParams = void>(
  queryKeys: CrudQueryKeyFactory,
  ops: CrudOperations<TItem, TCreate, TUpdate, TParams>,
) {
  function useList(params?: TParams): UseQueryResult<TItem[], unknown> {
    return useQuery<TItem[], unknown>({
      queryKey: queryKeys.all(params as Record<string, unknown> | undefined),
      queryFn: () => ops.getAll(params),
    });
  }

  function useOne(id: string): UseQueryResult<TItem, unknown> {
    return useQuery<TItem, unknown>({
      queryKey: queryKeys.detail(id),
      queryFn: () => ops.getOne(id),
      enabled: !!id,
    });
  }

  function useCreate(): UseMutationResult<TItem, unknown, TCreate> {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ops.create,
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: queryKeys.all() }),
    });
  }

  function useUpdate(): UseMutationResult<
    TItem,
    unknown,
    { id: string; data: TUpdate }
  > {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ id, data }) => ops.update(id, data),
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: queryKeys.all() }),
    });
  }

  function useRemove(): UseMutationResult<void, unknown, string> {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ops.remove,
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: queryKeys.all() }),
    });
  }

  return { useList, useOne, useCreate, useUpdate, useRemove };
}

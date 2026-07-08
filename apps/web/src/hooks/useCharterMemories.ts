import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type {
  CharterMemoryItem,
  CharterMemoriesByCategory,
} from "@/lib/api/client.projects.types";
import { queryKeys } from "@/lib/queryKeys";

export function useCharterMemories(projectId: string) {
  return useQuery({
    queryKey: queryKeys.charter.memories(projectId),
    queryFn: () => api.getCharterMemories(projectId),
  });
}

export function useCreateCharterMemory(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { category: string; content: string }) =>
      api.createCharterMemory(projectId, data),
    onMutate: async (newItem) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.charter.memories(projectId),
      });
      const previous = queryClient.getQueryData<CharterMemoriesByCategory>(
        queryKeys.charter.memories(projectId),
      );
      queryClient.setQueryData<CharterMemoriesByCategory>(
        queryKeys.charter.memories(projectId),
        (old = {}) => {
          const optimistic: CharterMemoryItem = {
            id: `optimistic-${Date.now()}`,
            content: newItem.content,
            memory_type: "fact",
            metadata: { category: newItem.category, source: "user_edit" },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          return {
            ...old,
            [newItem.category]: [...(old[newItem.category] ?? []), optimistic],
          };
        },
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          queryKeys.charter.memories(projectId),
          context.previous,
        );
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.charter.memories(projectId),
      });
    },
  });
}

export function useUpdateCharterMemory(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      memoryId,
      content,
    }: {
      memoryId: string;
      content: string;
    }) => api.updateCharterMemory(projectId, memoryId, { content }),
    onMutate: async ({ memoryId, content }) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.charter.memories(projectId),
      });
      const previous = queryClient.getQueryData<CharterMemoriesByCategory>(
        queryKeys.charter.memories(projectId),
      );
      queryClient.setQueryData<CharterMemoriesByCategory>(
        queryKeys.charter.memories(projectId),
        (old = {}) => {
          const updated: CharterMemoriesByCategory = {};
          for (const [cat, items] of Object.entries(old)) {
            updated[cat] =
              items?.map((item) =>
                item.id === memoryId ? { ...item, content } : item,
              ) ?? [];
          }
          return updated;
        },
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          queryKeys.charter.memories(projectId),
          context.previous,
        );
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.charter.memories(projectId),
      });
    },
  });
}

export function useDeleteCharterMemory(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (memoryId: string) =>
      api.deleteCharterMemory(projectId, memoryId),
    onMutate: async (memoryId) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.charter.memories(projectId),
      });
      const previous = queryClient.getQueryData<CharterMemoriesByCategory>(
        queryKeys.charter.memories(projectId),
      );
      queryClient.setQueryData<CharterMemoriesByCategory>(
        queryKeys.charter.memories(projectId),
        (old = {}) => {
          const updated: CharterMemoriesByCategory = {};
          for (const [cat, items] of Object.entries(old)) {
            updated[cat] = items?.filter((item) => item.id !== memoryId) ?? [];
          }
          return updated;
        },
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          queryKeys.charter.memories(projectId),
          context.previous,
        );
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.charter.memories(projectId),
      });
    },
  });
}
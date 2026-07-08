// apps/web/src/hooks/useUserSearch.ts
import { useQuery } from "@tanstack/react-query";
import { usersApi } from "@/lib/api/users";
import { queryKeys } from "@/lib/queryKeys";
import type { UserSearchResult } from "./useUserSearch.types";

const MIN_SEARCH_LENGTH = 2;
const USER_SEARCH_RESULT_LIMIT = 10;

export function useUserSearch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: queryKeys.users.search(trimmed),
    queryFn: async (): Promise<UserSearchResult[]> => {
      const res = await usersApi.getUsers({
        search: trimmed,
        limit: USER_SEARCH_RESULT_LIMIT,
      });
      return res.data.map((u) => ({
        id: u.id,
        username: u.username,
        email: u.email,
      }));
    },
    enabled: trimmed.length >= MIN_SEARCH_LENGTH,
    staleTime: 30_000,
  });
}

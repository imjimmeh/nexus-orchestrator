import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { EventLedgerRecord } from "@/lib/api/event-ledger.types";
import type { GitActivityState } from "./SettingsTab.hooks.types";

export const GIT_ACTIVITY_LIMIT = 10;

const isRemoteGitActivity = (event: EventLedgerRecord): boolean =>
  /(clone|push|pull|fetch|ls-remote)/i.test(event.event_name);

export function useGitActivity(projectId: string): GitActivityState {
  const query = useQuery({
    queryKey: queryKeys.projects.gitActivity(projectId, GIT_ACTIVITY_LIMIT),
    queryFn: () =>
      api.getEventLedger({
        projectId,
        domain: "git",
        limit: GIT_ACTIVITY_LIMIT,
      }),
  });

  const events = query.data?.data ?? [];
  const remoteEvents = events.filter(isRemoteGitActivity);
  const activity = remoteEvents.length > 0 ? remoteEvents : events;

  return {
    activity,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

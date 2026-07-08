import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { CreateAutomationHookRequest, CreateHeartbeatProfileRequest, UpdateAutomationHookRequest, UpdateHeartbeatProfileRequest } from "@/lib/api/projects.types";

const DEFAULT_HEARTBEAT_RUN_LIMIT = 25;

async function invalidateAutomationHooks(
  queryClient: QueryClient,
  projectId: string,
) {
  await queryClient.invalidateQueries({
    queryKey: queryKeys.automation.hooks(projectId),
  });
}

async function invalidateHeartbeatProfiles(
  queryClient: QueryClient,
  projectId: string,
) {
  await queryClient.invalidateQueries({
    queryKey: queryKeys.automation.heartbeatProfiles(projectId),
  });
}

async function invalidateHeartbeatRuns(
  queryClient: QueryClient,
  profileId: string,
) {
  await queryClient.invalidateQueries({
    queryKey: queryKeys.automation.heartbeatRunsRoot(profileId),
  });
}

async function invalidateStandingOrders(
  queryClient: QueryClient,
  projectId: string,
) {
  await queryClient.invalidateQueries({
    queryKey: queryKeys.automation.standingOrders(projectId),
  });
}

export function useAutomationHooks(projectId: string) {
  return useQuery({
    queryKey: queryKeys.automation.hooks(projectId),
    queryFn: () =>
      api.getAutomationHooks({
        project_id: projectId,
        limit: 200,
        offset: 0,
      }),
    enabled: Boolean(projectId),
  });
}

export function useCreateAutomationHook(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: Omit<CreateAutomationHookRequest, "project_id">) =>
      api.createAutomationHook({
        ...payload,
        project_id: projectId,
      }),
    onSuccess: async () => {
      await invalidateAutomationHooks(queryClient, projectId);
    },
  });
}

export function useUpdateAutomationHook(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: { id: string; data: UpdateAutomationHookRequest }) =>
      api.updateAutomationHook(payload.id, payload.data),
    onSuccess: async () => {
      await invalidateAutomationHooks(queryClient, projectId);
    },
  });
}

export function useDeleteAutomationHook(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (hookId: string) => api.deleteAutomationHook(hookId),
    onSuccess: async () => {
      await invalidateAutomationHooks(queryClient, projectId);
    },
  });
}

export function useHeartbeatProfiles(projectId: string) {
  return useQuery({
    queryKey: queryKeys.automation.heartbeatProfiles(projectId),
    queryFn: () =>
      api.getHeartbeatProfiles({
        project_id: projectId,
        limit: 200,
        offset: 0,
      }),
    enabled: Boolean(projectId),
  });
}

export function useHeartbeatRuns(
  profileId?: string,
  limit = DEFAULT_HEARTBEAT_RUN_LIMIT,
) {
  return useQuery({
    queryKey: queryKeys.automation.heartbeatRuns(profileId ?? "none", limit),
    queryFn: () => {
      if (!profileId) {
        throw new Error("profileId is required");
      }

      return api.getHeartbeatRuns(profileId, {
        limit,
        offset: 0,
      });
    },
    enabled: Boolean(profileId),
  });
}

export function useCreateHeartbeatProfile(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: Omit<CreateHeartbeatProfileRequest, "project_id">) =>
      api.createHeartbeatProfile({
        ...payload,
        project_id: projectId,
      }),
    onSuccess: async () => {
      await invalidateHeartbeatProfiles(queryClient, projectId);
    },
  });
}

export function useUpdateHeartbeatProfile(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: {
      id: string;
      data: UpdateHeartbeatProfileRequest;
    }) => api.updateHeartbeatProfile(payload.id, payload.data),
    onSuccess: async (_result, payload) => {
      await invalidateHeartbeatProfiles(queryClient, projectId);
      await invalidateHeartbeatRuns(queryClient, payload.id);
    },
  });
}

export function useRunHeartbeatProfileNow(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (profileId: string) => api.runHeartbeatProfileNow(profileId),
    onSuccess: async (_run, profileId) => {
      await invalidateHeartbeatProfiles(queryClient, projectId);
      await invalidateHeartbeatRuns(queryClient, profileId);
    },
  });
}

export function useDeleteHeartbeatProfile(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (profileId: string) => api.deleteHeartbeatProfile(profileId),
    onSuccess: async (_result, profileId) => {
      await invalidateHeartbeatProfiles(queryClient, projectId);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.automation.heartbeatRunsRoot(profileId),
      });
    },
  });
}

export function useStandingOrders(projectId: string) {
  return useQuery({
    queryKey: queryKeys.automation.standingOrders(projectId),
    queryFn: () =>
      api.getStandingOrders({
        project_id: projectId,
        limit: 200,
        offset: 0,
      }),
    enabled: Boolean(projectId),
  });
}

export function useCreateStandingOrder(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: {
      title: string;
      instruction: string;
      priority: number;
      enabled: boolean;
    }) =>
      api.createStandingOrder({
        ...payload,
        project_id: projectId,
      }),
    onSuccess: async () => {
      await invalidateStandingOrders(queryClient, projectId);
    },
  });
}

export function useUpdateStandingOrder(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: {
      id: string;
      data: {
        title?: string;
        instruction?: string;
        priority?: number;
        enabled?: boolean;
      };
    }) => api.updateStandingOrder(payload.id, payload.data),
    onSuccess: async () => {
      await invalidateStandingOrders(queryClient, projectId);
    },
  });
}

export function useDeleteStandingOrder(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.deleteStandingOrder(id),
    onSuccess: async () => {
      await invalidateStandingOrders(queryClient, projectId);
    },
  });
}

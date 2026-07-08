import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { CreateProjectGoalRequest, CreateProjectGoalWorklogRequest, ProjectGoal, ProjectGoalWorklog, UpdateProjectGoalRequest, UpdateProjectGoalStatusRequest } from "@/lib/api/goals.types";
import { queryKeys } from "@/lib/queryKeys";

async function invalidateGoals(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
) {
  await queryClient.invalidateQueries({
    queryKey: queryKeys.goals.list(projectId),
  });
}

export function useProjectGoals(projectId: string, includeArchived = false) {
  return useQuery({
    queryKey: queryKeys.goals.list(projectId, includeArchived),
    queryFn: () => api.getProjectGoals(projectId, { includeArchived }),
    enabled: Boolean(projectId),
  });
}

export function useCreateProjectGoal(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateProjectGoalRequest) =>
      api.createProjectGoal(projectId, payload),
    onSuccess: async () => {
      await invalidateGoals(queryClient, projectId);
    },
  });
}

export function useUpdateProjectGoal(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: { goalId: string; data: UpdateProjectGoalRequest }) =>
      api.updateProjectGoal(projectId, payload.goalId, payload.data),
    onSuccess: async () => {
      await invalidateGoals(queryClient, projectId);
    },
  });
}

export function useUpdateProjectGoalStatus(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: {
      goalId: string;
      data: UpdateProjectGoalStatusRequest;
    }) => api.updateProjectGoalStatus(projectId, payload.goalId, payload.data),
    onSuccess: async (_goal: ProjectGoal, payload) => {
      await invalidateGoals(queryClient, projectId);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.goals.worklogs(projectId, payload.goalId),
      });
    },
  });
}

export function useReorderProjectGoals(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (goalIds: string[]) =>
      api.reorderProjectGoals(projectId, goalIds),
    onSuccess: async () => {
      await invalidateGoals(queryClient, projectId);
    },
  });
}

export function useArchiveProjectGoal(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (goalId: string) => api.archiveProjectGoal(projectId, goalId),
    onSuccess: async () => {
      await invalidateGoals(queryClient, projectId);
    },
  });
}

export function useUnarchiveProjectGoal(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (goalId: string) => api.unarchiveProjectGoal(projectId, goalId),
    onSuccess: async () => {
      await invalidateGoals(queryClient, projectId);
    },
  });
}

export function useProjectGoalWorklogs(projectId: string, goalId?: string) {
  return useQuery({
    queryKey: queryKeys.goals.worklogs(projectId, goalId ?? "none"),
    queryFn: () => {
      if (!goalId) {
        throw new Error("goalId is required");
      }

      return api.getProjectGoalWorklogs(projectId, goalId);
    },
    enabled: Boolean(projectId) && Boolean(goalId),
  });
}

export function useCreateProjectGoalWorklog(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: {
      goalId: string;
      data: CreateProjectGoalWorklogRequest;
    }) => api.createProjectGoalWorklog(projectId, payload.goalId, payload.data),
    onSuccess: async (_worklog: ProjectGoalWorklog, payload) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.goals.worklogs(projectId, payload.goalId),
      });
      await invalidateGoals(queryClient, projectId);
    },
  });
}

export function useLinkProjectGoalWorkItem(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: {
      goalId: string;
      work_item_id: string;
      note?: string;
      author_id?: string;
      author_name?: string;
    }) =>
      api.linkProjectGoalWorkItem(projectId, payload.goalId, {
        work_item_id: payload.work_item_id,
        note: payload.note,
        author_id: payload.author_id,
        author_name: payload.author_name,
      }),
    onSuccess: async (_worklog: ProjectGoalWorklog, payload) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.goals.worklogs(projectId, payload.goalId),
      });
      await invalidateGoals(queryClient, projectId);
    },
  });
}
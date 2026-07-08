import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { CreateScheduledJobRequest, ScheduledJob, ScheduledJobScope, UpdateScheduledJobRequest } from "@/lib/api/scheduled-jobs.types";

const DEFAULT_RUN_HISTORY_LIMIT = 25;

async function invalidateScheduledJobs(queryClient: QueryClient) {
  await queryClient.invalidateQueries({
    queryKey: queryKeys.scheduled.jobs(),
  });
}

async function invalidateScheduledJobRuns(
  queryClient: QueryClient,
  jobId: string,
) {
  await queryClient.invalidateQueries({
    queryKey: queryKeys.scheduled.jobRuns(jobId),
  });
}

export function useScheduledJobs(params: {
  projectId?: string;
  scope?: ScheduledJobScope;
  status?: ScheduledJob["status"];
}) {
  return useQuery({
    queryKey: queryKeys.scheduled.jobs(params),
    queryFn: () =>
      api.getScheduledJobs({
        scopeId: params.projectId,
        scope: params.scope,
        status: params.status,
        limit: 200,
        offset: 0,
      }),
  });
}

export function useScheduledJobRuns(
  jobId?: string,
  limit = DEFAULT_RUN_HISTORY_LIMIT,
) {
  return useQuery({
    queryKey: queryKeys.scheduled.jobRuns(jobId ?? "none", limit),
    queryFn: () => {
      if (!jobId) {
        throw new Error("jobId is required");
      }

      return api.getScheduledJobRuns(jobId, {
        limit,
        offset: 0,
      });
    },
    enabled: Boolean(jobId),
  });
}

export function useCreateScheduledJob(defaultProjectId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateScheduledJobRequest) =>
      api.createScheduledJob({
        ...payload,
        scopeId: payload.scopeId ?? defaultProjectId,
      }),
    onSuccess: async () => {
      await invalidateScheduledJobs(queryClient);
    },
  });
}

export function useUpdateScheduledJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: { id: string; data: UpdateScheduledJobRequest }) =>
      api.updateScheduledJob(payload.id, payload.data),
    onSuccess: async (_updated, payload) => {
      await invalidateScheduledJobs(queryClient);
      await invalidateScheduledJobRuns(queryClient, payload.id);
    },
  });
}

export function usePauseScheduledJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (jobId: string) => api.pauseScheduledJob(jobId),
    onSuccess: async (_updated, jobId) => {
      await invalidateScheduledJobs(queryClient);
      await invalidateScheduledJobRuns(queryClient, jobId);
    },
  });
}

export function useResumeScheduledJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (jobId: string) => api.resumeScheduledJob(jobId),
    onSuccess: async (_updated, jobId) => {
      await invalidateScheduledJobs(queryClient);
      await invalidateScheduledJobRuns(queryClient, jobId);
    },
  });
}

export function useRunScheduledJobNow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (jobId: string) => api.runScheduledJobNow(jobId),
    onSuccess: async (_run, jobId) => {
      await invalidateScheduledJobs(queryClient);
      await invalidateScheduledJobRuns(queryClient, jobId);
    },
  });
}

export function useDeleteScheduledJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (jobId: string) => api.deleteScheduledJob(jobId),
    onSuccess: async (_run, jobId) => {
      await invalidateScheduledJobs(queryClient);
      queryClient.removeQueries({
        queryKey: queryKeys.scheduled.jobRuns(jobId),
      });
    },
  });
}

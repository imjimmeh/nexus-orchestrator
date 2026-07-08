import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { DoctorRepairHistoryStatus, ExecuteDoctorRepairRequest } from "@/lib/api/doctor.types";

interface DoctorHistoryQuery {
  limit?: number;
  offset?: number;
  action_id?: string;
  status?: DoctorRepairHistoryStatus;
}

export function useDoctorReport() {
  return useQuery({
    queryKey: queryKeys.operations.doctorReport(),
    queryFn: () => api.getDoctorReportEnvelope(),
  });
}

export function useLifecycleResumeSummary() {
  return useQuery({
    queryKey: queryKeys.operations.lifecycleResumeSummary(),
    queryFn: () => api.getLifecycleResumeSummary(),
    // Resume summary only changes at service restart — avoid refetch churn.
    staleTime: Infinity,
  });
}

export function useDoctorRepairHistory(params: DoctorHistoryQuery = {}) {
  const normalized = {
    limit: params.limit ?? 20,
    offset: params.offset ?? 0,
    action_id: params.action_id,
    status: params.status,
  };

  return useQuery({
    queryKey: queryKeys.operations.doctorHistory(normalized),
    queryFn: () => api.getDoctorRepairHistory(normalized),
  });
}

export function useExecuteDoctorRepair() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: ExecuteDoctorRepairRequest) =>
      api.executeDoctorRepair(payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.operations.doctorReport(),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.operations.doctorHistoryPrefix(),
        }),
      ]);
    },
  });
}

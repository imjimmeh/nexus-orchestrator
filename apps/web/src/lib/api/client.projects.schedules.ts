import type { ApiClient } from "./client";
import type { ApiClientProjectMethods } from "./client.projects.types";
import type {
  ScheduledJob,
  ScheduledJobListResponse,
  ScheduledJobRun,
  ScheduledJobRunsListResponse,
} from "./scheduled-jobs.types";

type ScheduledProjectApiMethods = Pick<
  ApiClientProjectMethods,
  | "getScheduledJobs"
  | "getScheduledJob"
  | "createScheduledJob"
  | "updateScheduledJob"
  | "pauseScheduledJob"
  | "resumeScheduledJob"
  | "runScheduledJobNow"
  | "deleteScheduledJob"
  | "getScheduledJobRuns"
>;

export const projectScheduledApiMethods: ScheduledProjectApiMethods = {
  async getScheduledJobs(this: ApiClient, params) {
    const query = new URLSearchParams();
    if (params.scopeId) {
      query.append("scopeId", params.scopeId);
    }
    if (params.scope) {
      query.append("scope", params.scope);
    }
    if (params.status) {
      query.append("status", params.status);
    }
    if (params.limit !== undefined) {
      query.append("limit", String(params.limit));
    }
    if (params.offset !== undefined) {
      query.append("offset", String(params.offset));
    }

    return this.get<ScheduledJobListResponse>(
      `/automation/schedules?${query.toString()}`,
    );
  },

  async getScheduledJob(this: ApiClient, id) {
    return this.get<ScheduledJob>(`/automation/schedules/${id}`);
  },

  async createScheduledJob(this: ApiClient, data) {
    return this.post<ScheduledJob>("/automation/schedules", data);
  },

  async updateScheduledJob(this: ApiClient, id, data) {
    return this.patch<ScheduledJob>(`/automation/schedules/${id}`, data);
  },

  async pauseScheduledJob(this: ApiClient, id) {
    return this.post<ScheduledJob>(`/automation/schedules/${id}/pause`, {});
  },

  async resumeScheduledJob(this: ApiClient, id) {
    return this.post<ScheduledJob>(`/automation/schedules/${id}/resume`, {});
  },

  async runScheduledJobNow(this: ApiClient, id) {
    return this.post<ScheduledJobRun>(
      `/automation/schedules/${id}/run-now`,
      {},
    );
  },

  async deleteScheduledJob(this: ApiClient, id) {
    return this.delete(`/automation/schedules/${id}`);
  },

  async getScheduledJobRuns(this: ApiClient, id, params) {
    const query = new URLSearchParams();
    if (params?.limit !== undefined) {
      query.append("limit", String(params.limit));
    }
    if (params?.offset !== undefined) {
      query.append("offset", String(params.offset));
    }

    const suffix = query.toString().length > 0 ? `?${query.toString()}` : "";
    return this.get<ScheduledJobRunsListResponse>(
      `/automation/schedules/${id}/runs${suffix}`,
    );
  },
};

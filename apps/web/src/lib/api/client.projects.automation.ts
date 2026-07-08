import type { ApiClient } from "./client";
import type { ApiClientProjectMethods } from "./client.projects.types";
import type {
  AutomationHook,
  AutomationHookListResponse,
  HeartbeatProfile,
  HeartbeatProfileListResponse,
  HeartbeatRun,
  HeartbeatRunsListResponse,
  StandingOrder,
  StandingOrderListResponse,
} from "./projects.types";

type ProjectAutomationApiMethods = Pick<
  ApiClientProjectMethods,
  | "getAutomationHooks"
  | "getAutomationHook"
  | "createAutomationHook"
  | "updateAutomationHook"
  | "deleteAutomationHook"
  | "getHeartbeatProfiles"
  | "getHeartbeatProfile"
  | "createHeartbeatProfile"
  | "updateHeartbeatProfile"
  | "runHeartbeatProfileNow"
  | "deleteHeartbeatProfile"
  | "getHeartbeatRuns"
  | "getStandingOrders"
  | "getStandingOrder"
  | "createStandingOrder"
  | "updateStandingOrder"
  | "deleteStandingOrder"
>;

export const projectAutomationApiMethods: ProjectAutomationApiMethods = {
  async getAutomationHooks(this: ApiClient, params) {
    const query = new URLSearchParams();
    if (params.project_id) {
      query.append("project_id", params.project_id);
    }
    if (params.trigger_type) {
      query.append("trigger_type", params.trigger_type);
    }
    if (params.limit !== undefined) {
      query.append("limit", String(params.limit));
    }
    if (params.offset !== undefined) {
      query.append("offset", String(params.offset));
    }

    const suffix = query.toString().length > 0 ? `?${query.toString()}` : "";
    return this.get<AutomationHookListResponse>(`/automation/hooks${suffix}`);
  },

  async getAutomationHook(this: ApiClient, id) {
    return this.get<AutomationHook>(`/automation/hooks/${id}`);
  },

  async createAutomationHook(this: ApiClient, data) {
    return this.post<AutomationHook>("/automation/hooks", data);
  },

  async updateAutomationHook(this: ApiClient, id, data) {
    return this.patch<AutomationHook>(`/automation/hooks/${id}`, data);
  },

  async deleteAutomationHook(this: ApiClient, id) {
    return this.delete(`/automation/hooks/${id}`);
  },

  async getHeartbeatProfiles(this: ApiClient, params) {
    const query = new URLSearchParams();
    query.append("project_id", params.project_id);
    if (params.limit !== undefined) {
      query.append("limit", String(params.limit));
    }
    if (params.offset !== undefined) {
      query.append("offset", String(params.offset));
    }

    return this.get<HeartbeatProfileListResponse>(
      `/automation/heartbeat?${query.toString()}`,
    );
  },

  async getHeartbeatProfile(this: ApiClient, id) {
    return this.get<HeartbeatProfile>(`/automation/heartbeat/${id}`);
  },

  async createHeartbeatProfile(this: ApiClient, data) {
    return this.post<HeartbeatProfile>("/automation/heartbeat", data);
  },

  async updateHeartbeatProfile(this: ApiClient, id, data) {
    return this.patch<HeartbeatProfile>(`/automation/heartbeat/${id}`, data);
  },

  async runHeartbeatProfileNow(this: ApiClient, id) {
    return this.post<HeartbeatRun>(`/automation/heartbeat/${id}/run-now`, {});
  },

  async deleteHeartbeatProfile(this: ApiClient, id) {
    return this.delete(`/automation/heartbeat/${id}`);
  },

  async getHeartbeatRuns(this: ApiClient, id, params) {
    const query = new URLSearchParams();
    if (params?.limit !== undefined) {
      query.append("limit", String(params.limit));
    }
    if (params?.offset !== undefined) {
      query.append("offset", String(params.offset));
    }

    const suffix = query.toString().length > 0 ? `?${query.toString()}` : "";
    return this.get<HeartbeatRunsListResponse>(
      `/automation/heartbeat/${id}/runs${suffix}`,
    );
  },

  async getStandingOrders(this: ApiClient, params) {
    const query = new URLSearchParams();
    query.append("project_id", params.project_id);
    if (params.profile_name) {
      query.append("profile_name", params.profile_name);
    }
    if (params.include_disabled !== undefined) {
      query.append("include_disabled", String(params.include_disabled));
    }
    if (params.limit !== undefined) {
      query.append("limit", String(params.limit));
    }
    if (params.offset !== undefined) {
      query.append("offset", String(params.offset));
    }

    return this.get<StandingOrderListResponse>(
      `/automation/standing-orders?${query.toString()}`,
    );
  },

  async getStandingOrder(this: ApiClient, id) {
    return this.get<StandingOrder>(`/automation/standing-orders/${id}`);
  },

  async createStandingOrder(this: ApiClient, data) {
    return this.post<StandingOrder>("/automation/standing-orders", data);
  },

  async updateStandingOrder(this: ApiClient, id, data) {
    return this.patch<StandingOrder>(`/automation/standing-orders/${id}`, data);
  },

  async deleteStandingOrder(this: ApiClient, id) {
    return this.delete(`/automation/standing-orders/${id}`);
  },
};

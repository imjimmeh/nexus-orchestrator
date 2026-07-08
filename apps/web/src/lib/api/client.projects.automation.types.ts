import type { ApiClient } from "./client";
import type {
  AutomationHook,
  AutomationHookListResponse,
  AutomationHookTriggerType,
  CreateAutomationHookRequest,
  CreateHeartbeatProfileRequest,
  CreateStandingOrderRequest,
  HeartbeatProfile,
  HeartbeatProfileListResponse,
  HeartbeatRun,
  HeartbeatRunsListResponse,
  StandingOrder,
  StandingOrderListResponse,
  UpdateAutomationHookRequest,
  UpdateHeartbeatProfileRequest,
  UpdateStandingOrderRequest,
} from "./projects.types";

interface ApiClientProjectAutomationMethods {
  getAutomationHooks(
    this: ApiClient,
    params: {
      project_id?: string;
      trigger_type?: AutomationHookTriggerType;
      limit?: number;
      offset?: number;
    },
  ): Promise<AutomationHookListResponse>;
  getAutomationHook(this: ApiClient, id: string): Promise<AutomationHook>;
  createAutomationHook(
    this: ApiClient,
    data: CreateAutomationHookRequest,
  ): Promise<AutomationHook>;
  updateAutomationHook(
    this: ApiClient,
    id: string,
    data: UpdateAutomationHookRequest,
  ): Promise<AutomationHook>;
  deleteAutomationHook(this: ApiClient, id: string): Promise<void>;
  getHeartbeatProfiles(
    this: ApiClient,
    params: {
      project_id: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<HeartbeatProfileListResponse>;
  getHeartbeatProfile(this: ApiClient, id: string): Promise<HeartbeatProfile>;
  createHeartbeatProfile(
    this: ApiClient,
    data: CreateHeartbeatProfileRequest,
  ): Promise<HeartbeatProfile>;
  updateHeartbeatProfile(
    this: ApiClient,
    id: string,
    data: UpdateHeartbeatProfileRequest,
  ): Promise<HeartbeatProfile>;
  runHeartbeatProfileNow(this: ApiClient, id: string): Promise<HeartbeatRun>;
  deleteHeartbeatProfile(this: ApiClient, id: string): Promise<void>;
  getHeartbeatRuns(
    this: ApiClient,
    id: string,
    params?: {
      limit?: number;
      offset?: number;
    },
  ): Promise<HeartbeatRunsListResponse>;
  getStandingOrders(
    this: ApiClient,
    params: {
      project_id: string;
      profile_name?: string;
      include_disabled?: boolean;
      limit?: number;
      offset?: number;
    },
  ): Promise<StandingOrderListResponse>;
  getStandingOrder(this: ApiClient, id: string): Promise<StandingOrder>;
  createStandingOrder(
    this: ApiClient,
    data: CreateStandingOrderRequest,
  ): Promise<StandingOrder>;
  updateStandingOrder(
    this: ApiClient,
    id: string,
    data: UpdateStandingOrderRequest,
  ): Promise<StandingOrder>;
  deleteStandingOrder(this: ApiClient, id: string): Promise<void>;
}

export type { ApiClientProjectAutomationMethods };

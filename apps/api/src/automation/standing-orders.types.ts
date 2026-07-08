import { StandingOrderOverridePolicy } from '@nexus/core';

export interface StandingOrderSummaryView {
  id: string;
  scopeId: string;
  title: string;
  instruction: string;
  profile_name: string | null;
  enabled: boolean;
  priority: number;
  override_policy: StandingOrderOverridePolicy;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface RuntimeStandingOrderView {
  id: string;
  title: string;
  instruction: string;
  profile_name: string | null;
  priority: number;
  override_policy: StandingOrderSummaryView['override_policy'];
}

export interface CreateStandingOrderParams {
  scopeId: string;
  title: string;
  instruction: string;
  profile_name?: string;
  enabled?: boolean;
  priority?: number;
  override_policy?: StandingOrderOverridePolicy;
  created_by?: string;
}

export interface UpdateStandingOrderParams {
  title?: string;
  instruction?: string;
  profile_name?: string;
  enabled?: boolean;
  priority?: number;
  override_policy?: StandingOrderOverridePolicy;
  updated_by?: string;
}

export interface StandingOrdersPagination {
  limit: number;
  offset: number;
}

export interface ListStandingOrdersResult {
  items: StandingOrderSummaryView[];
  total: number;
  limit: number;
  offset: number;
}

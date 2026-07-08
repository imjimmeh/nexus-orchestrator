import { StandingOrder } from './database/entities/standing-order.entity';
import {
  RuntimeStandingOrderView,
  StandingOrderSummaryView,
} from './standing-orders.types';

export function toStandingOrderSummary(
  standingOrder: StandingOrder,
): StandingOrderSummaryView {
  return {
    id: standingOrder.id,
    scopeId: standingOrder.scopeId,
    title: standingOrder.title,
    instruction: standingOrder.instruction,
    profile_name: standingOrder.profile_name ?? null,
    enabled: standingOrder.enabled,
    priority: standingOrder.priority,
    override_policy: standingOrder.override_policy,
    created_by: standingOrder.created_by ?? null,
    updated_by: standingOrder.updated_by ?? null,
    created_at: standingOrder.created_at,
    updated_at: standingOrder.updated_at,
  };
}

export function toRuntimeStandingOrder(
  standingOrder: StandingOrder,
): RuntimeStandingOrderView {
  return {
    id: standingOrder.id,
    title: standingOrder.title,
    instruction: standingOrder.instruction,
    profile_name: standingOrder.profile_name ?? null,
    priority: standingOrder.priority,
    override_policy: standingOrder.override_policy,
  };
}

import type {
  AutonomyEventCategory,
  AutonomySummaryItem,
} from '../../observability/autonomy-observability.types';

export interface WorkflowRunAutonomyDiagnostics {
  items: AutonomySummaryItem[];
  summary?: {
    total: number;
    byCategory: Record<AutonomyEventCategory, number>;
    latestStatus?: AutonomySummaryItem['status'];
  };
}

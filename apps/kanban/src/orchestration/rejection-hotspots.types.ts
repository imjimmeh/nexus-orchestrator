export interface FailedDeliverableLike {
  failure_type: string;
  affected_files?: string[];
}

export interface RejectionFeedbackLike {
  failedDeliverables?: FailedDeliverableLike[];
  failed_deliverables?: FailedDeliverableLike[];
}

export interface RejectionHotspot {
  area: string;
  count: number;
  failureTypes: Record<string, number>;
}

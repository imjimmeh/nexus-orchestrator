export interface LearningCandidateListItem {
  id: string;
  scope_type: string;
  scope_id: string | null;
  candidate_type: string;
  title: string;
  summary: string;
  fingerprint: string;
  status: string;
  score: number;
  confidence: number;
  recurrence_count: number;
  signals_json: Record<string, unknown>;
  promoted_at: string | null;
  human_approved_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  rejected_at: string | null;
  rejected_by: string | null;
  rejection_reason: string | null;
  archived_at: string | null;
  archived_by: string | null;
  archive_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface LearningCandidateListResponse {
  data: LearningCandidateListItem[];
  meta: {
    pagination: PaginationMeta;
    suppressedCount: number;
  };
}

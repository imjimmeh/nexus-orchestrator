import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/ui/data-table";
import type {
  ColumnDef,
  FilterDef,
  ListQuery,
  ListResponse,
} from "@/components/ui/data-table";
import { formatDateTimeSafe, formatDistanceToNowSafe } from "@/lib/utils";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/useToast";
import {
  useArchiveLearningCandidate,
  useBulkArchiveLearningCandidates,
  useBulkPromoteLearningCandidates,
  useBulkRejectLearningCandidates,
  usePromoteLearningCandidate,
  useRejectLearningCandidate,
} from "@/hooks/useLearningMemory";
import { LearningCandidate } from "@/lib/api/projects.types";
import {
  candidateStatusBadgeVariant,
  formatLearningScopeLabel,
  formatLearningPercent,
  formatLearningScore,
} from "./LearningTab.helpers";
import {
  getLastViewedAt,
  isNewSinceLastVisit,
  isStalePending,
  markViewedNow,
} from "./learningTabRecency";
import {
  archiveCandidate,
  bulkArchiveCandidates,
  bulkPromoteCandidates,
  bulkRejectCandidates,
  promoteCandidate,
  rejectCandidate,
} from "./learningTabCandidateMutations";

const CANDIDATE_STATUS_FILTER: FilterDef = {
  key: "status",
  label: "Status",
  type: "multiselect",
  options: [
    { label: "Pending", value: "pending" },
    { label: "Promoted", value: "promoted" },
    { label: "Rejected", value: "rejected" },
    { label: "Archived", value: "archived" },
  ],
};

const CANDIDATE_TYPE_FILTER: FilterDef = {
  key: "candidate_type",
  label: "Type",
  type: "multiselect",
  options: [
    { label: "Agent capture", value: "agent_capture" },
    { label: "Retrospective", value: "retrospective" },
    { label: "Global memory", value: "global_memory" },
    { label: "Runtime learning", value: "runtime_learning" },
  ],
};

const CANDIDATE_MIN_SCORE_FILTER: FilterDef = {
  key: "min_score",
  label: "Min score",
  type: "select",
  options: [
    { label: "≥ 0.5", value: "0.5" },
    { label: "≥ 0.7", value: "0.7" },
    { label: "≥ 0.9", value: "0.9" },
  ],
};

const CANDIDATE_DATE_FILTER: FilterDef = {
  key: "created_from",
  label: "Created",
  type: "date",
  options: [],
};

const CANDIDATE_DATE_FILTER_TO: FilterDef = {
  key: "created_from_to",
  label: "Created",
  type: "date",
  options: [],
};

async function fetchCandidatesPage(
  query: ListQuery & Record<string, unknown>,
): Promise<ListResponse<LearningCandidate>> {
  const response = await api.getLearningCandidates({
    status:
      typeof query.status === "string" ? query.status.split(",") : undefined,
    candidate_type:
      typeof query.candidate_type === "string"
        ? query.candidate_type.split(",")
        : undefined,
    search: query.search,
    min_score: query.min_score ? Number(query.min_score) : undefined,
    created_from: query.created_from as string | undefined,
    created_to: query.created_from_to as string | undefined,
    page: query.page,
    limit: query.limit,
    sortBy: query.sortBy,
    sortDir: query.sortDir,
  });

  return {
    data: response.data,
    meta: { pagination: response.meta.pagination },
  };
}

function CandidateTimeline({
  candidate,
}: Readonly<{ candidate: LearningCandidate }>) {
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p>First seen: {formatDateTimeSafe(candidate.first_seen_at)}</p>
      <p>Last seen: {formatDateTimeSafe(candidate.last_seen_at)}</p>
      {candidate.promoted_at ? (
        <p>Promoted: {formatDateTimeSafe(candidate.promoted_at)}</p>
      ) : null}
      {candidate.rejected_at ? (
        <p>
          Rejected: {formatDateTimeSafe(candidate.rejected_at)}
          {candidate.rejected_by ? ` by ${candidate.rejected_by}` : ""}
          {candidate.rejection_reason ? ` — ${candidate.rejection_reason}` : ""}
        </p>
      ) : null}
      {candidate.archived_at ? (
        <p>
          Archived: {formatDateTimeSafe(candidate.archived_at)}
          {candidate.archived_by ? ` by ${candidate.archived_by}` : ""}
          {candidate.archive_reason ? ` — ${candidate.archive_reason}` : ""}
        </p>
      ) : null}
    </div>
  );
}

interface RejectFormProps {
  candidate: LearningCandidate;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

function RejectForm({
  candidate,
  onCancel,
  onConfirm,
}: Readonly<RejectFormProps>) {
  const [reason, setReason] = useState("");

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={`reject-reason-${candidate.id}`} className="sr-only">
        Rejection reason
      </label>
      <Input
        id={`reject-reason-${candidate.id}`}
        aria-label="Rejection reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason"
        className="h-8 w-40"
      />
      <Button
        size="sm"
        variant="destructive"
        onClick={() => onConfirm(reason)}
        aria-label="Confirm reject"
      >
        Confirm
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

interface BulkActionsProps {
  selected: LearningCandidate[];
  bulkRejectReason: string;
  onBulkRejectReasonChange: (value: string) => void;
  onBulkReject: () => void;
  onBulkArchive: () => void;
  onBulkPromote: () => void;
}

function BulkActions({
  selected,
  bulkRejectReason,
  onBulkRejectReasonChange,
  onBulkReject,
  onBulkArchive,
  onBulkPromote,
}: Readonly<BulkActionsProps>): ReactNode {
  const canBulkReject = bulkRejectReason.trim().length > 0;

  return (
    <>
      <span className="text-sm">{selected.length} selected</span>
      <label htmlFor="bulk-reject-reason" className="sr-only">
        Bulk rejection reason
      </label>
      <Input
        id="bulk-reject-reason"
        aria-label="Bulk rejection reason"
        value={bulkRejectReason}
        onChange={(e) => onBulkRejectReasonChange(e.target.value)}
        placeholder="Reason"
        className="h-8 w-40"
      />
      <Button
        size="sm"
        variant="outline"
        disabled={!canBulkReject}
        onClick={onBulkReject}
      >
        Reject selected
      </Button>
      <Button
        size="sm"
        variant="outline"
        aria-label="Archive selected"
        onClick={onBulkArchive}
      >
        Archive selected
      </Button>
      <Button size="sm" onClick={onBulkPromote}>
        Promote selected
      </Button>
    </>
  );
}

export function LearningTabCandidatesCard(): ReactNode {
  const { projectId } = useParams<{ projectId: string }>();
  const toast = useToast();
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [bulkRejectReason, setBulkRejectReason] = useState("");
  const rejectMutation = useRejectLearningCandidate();
  const archiveMutation = useArchiveLearningCandidate();
  const promoteMutation = usePromoteLearningCandidate();
  const bulkRejectMutation = useBulkRejectLearningCandidates();
  const bulkArchiveMutation = useBulkArchiveLearningCandidates();
  const bulkPromoteMutation = useBulkPromoteLearningCandidates();
  const lastViewedAt = projectId ? getLastViewedAt(projectId) : null;
  const now = new Date();

  useEffect(() => {
    if (projectId) {
      markViewedNow(projectId);
    }
  }, [projectId]);

  const columns: ColumnDef<LearningCandidate>[] = [
    {
      key: "title",
      label: "Title",
      sortable: true,
      render: (candidate) => (
        <div className="flex items-center gap-2">
          <span>{candidate.title}</span>
          {isNewSinceLastVisit(candidate.created_at, lastViewedAt) ? (
            <Badge variant="secondary">New</Badge>
          ) : null}
          {isStalePending(candidate.status, candidate.created_at, now) ? (
            <Badge variant="outline">Stale</Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (candidate) => (
        <Badge variant={candidateStatusBadgeVariant(candidate.status)}>
          {candidate.status}
        </Badge>
      ),
    },
    {
      key: "scope_type",
      label: "Scope",
      render: (candidate) => (
        <Badge variant="outline">
          {formatLearningScopeLabel({ candidate })}
        </Badge>
      ),
    },
    {
      key: "score",
      label: "Score",
      sortable: true,
      render: (candidate) => formatLearningScore(candidate.score),
    },
    {
      key: "confidence",
      label: "Confidence",
      render: (candidate) => formatLearningPercent(candidate.confidence),
    },
    {
      key: "created_at",
      label: "Created",
      sortable: true,
      className: "text-xs text-muted-foreground",
      render: (candidate) => formatDistanceToNowSafe(candidate.created_at, "—"),
    },
    {
      key: "id",
      label: "Actions",
      className: "text-right",
      render: (candidate) => {
        if (candidate.status !== "pending") {
          return null;
        }
        if (rejectingId === candidate.id) {
          return (
            <RejectForm
              candidate={candidate}
              onCancel={() => setRejectingId(null)}
              onConfirm={(reason) => {
                void rejectCandidate(
                  rejectMutation,
                  toast,
                  candidate.id,
                  reason,
                );
                setRejectingId(null);
              }}
            />
          );
        }
        return (
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              aria-label={`Reject candidate ${candidate.id}`}
              onClick={() => setRejectingId(candidate.id)}
            >
              Reject
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void archiveCandidate(archiveMutation, toast, candidate.id)
              }
            >
              Archive
            </Button>
            <Button
              size="sm"
              disabled={promoteMutation.isPending}
              onClick={() =>
                void promoteCandidate(promoteMutation, toast, candidate.id)
              }
            >
              Promote
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Learning Candidates</CardTitle>
      </CardHeader>
      <CardContent>
        <DataTable<LearningCandidate>
          mode="server"
          urlKey="lc"
          queryKey={["learning-candidates"]}
          fetchFn={fetchCandidatesPage}
          columns={columns}
          filters={[
            CANDIDATE_STATUS_FILTER,
            CANDIDATE_TYPE_FILTER,
            CANDIDATE_MIN_SCORE_FILTER,
            CANDIDATE_DATE_FILTER,
            CANDIDATE_DATE_FILTER_TO,
          ]}
          defaultFilterValues={{ status: "pending,promoted" }}
          defaultSort="score"
          defaultSortDir="desc"
          enableSelection
          renderExpanded={(candidate) => (
            <CandidateTimeline candidate={candidate} />
          )}
          renderBulkActions={(selected) => (
            <BulkActions
              selected={selected}
              bulkRejectReason={bulkRejectReason}
              onBulkRejectReasonChange={setBulkRejectReason}
              onBulkReject={() => {
                void bulkRejectCandidates(
                  bulkRejectMutation,
                  toast,
                  selected.map((c) => c.id),
                  bulkRejectReason,
                );
                setBulkRejectReason("");
              }}
              onBulkArchive={() =>
                void bulkArchiveCandidates(
                  bulkArchiveMutation,
                  toast,
                  selected.map((c) => c.id),
                )
              }
              onBulkPromote={() =>
                void bulkPromoteCandidates(
                  bulkPromoteMutation,
                  toast,
                  selected.map((c) => c.id),
                )
              }
            />
          )}
          emptyMessage="No learning candidates found for this filter."
        />
      </CardContent>
    </Card>
  );
}

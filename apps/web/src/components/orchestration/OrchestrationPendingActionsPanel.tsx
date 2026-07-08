import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDateSafe } from "@/lib/utils";
import { ProjectOrchestrationActionRequest } from "@/lib/api/projects.types";
import { SpecReviewDialog } from "./SpecReviewDialog";

interface OrchestrationPendingActionsPanelProps {
  requests: ProjectOrchestrationActionRequest[];
  onApprove: (actionRequestId: string) => Promise<void>;
  onReject: (params: {
    actionRequestId: string;
    reason: string;
  }) => Promise<void>;
  isPending?: boolean;
}

function isSpecApproval(request: ProjectOrchestrationActionRequest): boolean {
  return request.action === "approve_specs";
}

function SpecApprovalCard({
  request,
  isPending,
  rejectReason,
  onRejectReasonChange,
  onApprove,
  onReject,
}: Readonly<{
  request: ProjectOrchestrationActionRequest;
  isPending: boolean;
  rejectReason: string;
  onRejectReasonChange: (value: string) => void;
  onApprove: () => void;
  onReject: () => void;
}>) {
  const [reviewOpen, setReviewOpen] = useState(false);

  return (
    <div className="space-y-3 rounded-md border border-amber-500/50 bg-amber-50/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <p className="text-sm font-semibold">
            PRD &amp; SDD Ready for Review
          </p>
          <p className="text-xs text-muted-foreground">
            The discovery phase has produced specifications that need your
            approval before work-item generation can begin.
          </p>
        </div>
        <Badge variant="default">Awaiting Approval</Badge>
      </div>

      <div className="text-xs text-muted-foreground">
        Submitted:{" "}
        {formatDateSafe(request.created_at, "MMM d, yyyy HH:mm:ss", "Unknown")}
      </div>

      <div className="flex flex-wrap gap-2">
        {request.workflowRunId ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setReviewOpen(true)}
          >
            View Specs
          </Button>
        ) : null}
        <Button size="sm" disabled={isPending} onClick={onApprove}>
          Approve &amp; Continue
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isPending || !rejectReason.trim()}
          onClick={onReject}
        >
          Request Revision
        </Button>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`reject-reason-${request.id}`}>
          Revision feedback (required to reject)
        </Label>
        <Textarea
          id={`reject-reason-${request.id}`}
          rows={2}
          value={rejectReason}
          onChange={(event) => onRejectReasonChange(event.target.value)}
          placeholder="Describe what needs to change in the PRD/SDD..."
        />
      </div>

      {request.workflowRunId ? (
        <SpecReviewDialog
          open={reviewOpen}
          onOpenChange={setReviewOpen}
          workflowRunId={request.workflowRunId}
        />
      ) : null}
    </div>
  );
}

interface OrchestrationPendingActionsPanelProps {
  requests: ProjectOrchestrationActionRequest[];
  onApprove: (actionRequestId: string) => Promise<void>;
  onReject: (params: {
    actionRequestId: string;
    reason: string;
  }) => Promise<void>;
  isPending?: boolean;
}

export function OrchestrationPendingActionsPanel({
  requests,
  onApprove,
  onReject,
  isPending = false,
}: Readonly<OrchestrationPendingActionsPanelProps>) {
  const [rejectReasonById, setRejectReasonById] = useState<
    Record<string, string>
  >({});

  const pendingRequests = useMemo(
    () => requests.filter((entry) => entry.status === "pending"),
    [requests],
  );

  if (pendingRequests.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Pending Action Requests</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No pending action requests.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pending Action Requests</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {pendingRequests.map((request) =>
          isSpecApproval(request) ? (
            <SpecApprovalCard
              key={request.id}
              request={request}
              isPending={isPending}
              rejectReason={rejectReasonById[request.id] ?? ""}
              onRejectReasonChange={(value) => {
                setRejectReasonById((current) => ({
                  ...current,
                  [request.id]: value,
                }));
              }}
              onApprove={() => void onApprove(request.id)}
              onReject={() =>
                void onReject({
                  actionRequestId: request.id,
                  reason: (rejectReasonById[request.id] ?? "").trim(),
                })
              }
            />
          ) : (
            <div key={request.id} className="space-y-3 rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge variant="outline">{request.action}</Badge>
                <span className="text-xs text-muted-foreground">
                  {formatDateSafe(
                    request.created_at,
                    "MMM d, yyyy HH:mm:ss",
                    "Unknown",
                  )}
                </span>
              </div>

              <div className="text-sm text-muted-foreground">
                <p>Mode at request: {request.modeAtRequest}</p>
                {request.requestedBy ? (
                  <p>Requested by: {request.requestedBy}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor={`reject-reason-${request.id}`}>
                  Reject reason
                </Label>
                <Textarea
                  id={`reject-reason-${request.id}`}
                  rows={2}
                  value={rejectReasonById[request.id] ?? ""}
                  onChange={(event) => {
                    setRejectReasonById((current) => ({
                      ...current,
                      [request.id]: event.target.value,
                    }));
                  }}
                  placeholder="Required when rejecting request"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={isPending}
                  onClick={() => void onApprove(request.id)}
                >
                  Approve & Execute
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    isPending || !(rejectReasonById[request.id] ?? "").trim()
                  }
                  onClick={() =>
                    void onReject({
                      actionRequestId: request.id,
                      reason: (rejectReasonById[request.id] ?? "").trim(),
                    })
                  }
                >
                  Reject
                </Button>
              </div>
            </div>
          ),
        )}
      </CardContent>
    </Card>
  );
}

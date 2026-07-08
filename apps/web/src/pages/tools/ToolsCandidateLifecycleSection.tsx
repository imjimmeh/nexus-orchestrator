import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ToolCandidate, ToolValidationRun } from "@/lib/api/tools.types";
import { ToolForm } from "./ToolForm";
import { ToolPublishPanel } from "./ToolPublishPanel";
import { ToolValidationRuns } from "./ToolValidationRuns";
import { ToolVersionHistory } from "./ToolVersionHistory";
import { ToolFormValues } from "./ToolFormValues.types";

interface CandidateLifecycleSectionProps {
  isCandidatesLoading: boolean;
  candidates: ToolCandidate[];
  selectedCandidateId: string | null;
  selectedCandidate: ToolCandidate | null;
  validationRuns: ToolValidationRun[];
  isValidationRunsLoading: boolean;
  latestValidationRun: ToolValidationRun | null;
  isCreateCandidateOpen: boolean;
  isCreateCandidateSubmitting: boolean;
  isValidating: boolean;
  isPublishing: boolean;
  onCreateCandidateOpenChange: (open: boolean) => void;
  onCreateCandidate: (data: ToolFormValues) => Promise<void>;
  onSelectCandidate: (candidateId: string) => void;
  onValidateCandidate: () => Promise<void>;
  onPublishCandidate: () => Promise<void>;
}

function getCandidateStatusVariant(status: ToolCandidate["status"]) {
  if (status === "validated" || status === "published") return "default";
  if (status === "failed") return "destructive";
  return "secondary";
}

function CandidateCreateDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: ToolFormValues) => Promise<void>;
  isSubmitting: boolean;
}) {
  const { open, onOpenChange, onSubmit, isSubmitting } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">Create Candidate</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[860px]">
        <DialogHeader>
          <DialogTitle>Create Tool Candidate</DialogTitle>
        </DialogHeader>
        <ToolForm
          onSubmit={onSubmit}
          onCancel={() => onOpenChange(false)}
          isSubmitting={isSubmitting}
        />
      </DialogContent>
    </Dialog>
  );
}

function CandidateTable(props: {
  isCandidatesLoading: boolean;
  candidates: ToolCandidate[];
  selectedCandidateId: string | null;
  onSelectCandidate: (candidateId: string) => void;
}) {
  const {
    isCandidatesLoading,
    candidates,
    selectedCandidateId,
    onSelectCandidate,
  } = props;

  return (
    <div className="rounded-md border lg:col-span-1">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Candidate</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isCandidatesLoading ? (
            <TableRow>
              <TableCell colSpan={2} className="text-center">
                Loading candidates...
              </TableCell>
            </TableRow>
          ) : candidates.length === 0 ? (
            <TableRow>
              <TableCell colSpan={2} className="text-center">
                No candidates found
              </TableCell>
            </TableRow>
          ) : (
            candidates.map((candidate) => (
              <TableRow
                key={candidate.id}
                className="cursor-pointer"
                onClick={() => onSelectCandidate(candidate.id)}
              >
                <TableCell className="font-medium">
                  {candidate.tool_name} v{candidate.version}
                </TableCell>
                <TableCell>
                  <Badge variant={getCandidateStatusVariant(candidate.status)}>
                    {candidate.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {selectedCandidateId ? null : (
        <p className="px-4 pb-4 text-xs text-muted-foreground">
          Select a candidate to view validation and publication controls.
        </p>
      )}
    </div>
  );
}

export function ToolsCandidateLifecycleSection(
  props: Readonly<CandidateLifecycleSectionProps>,
) {
  const {
    isCandidatesLoading,
    candidates,
    selectedCandidateId,
    selectedCandidate,
    validationRuns,
    isValidationRunsLoading,
    latestValidationRun,
    isCreateCandidateOpen,
    isCreateCandidateSubmitting,
    isValidating,
    isPublishing,
    onCreateCandidateOpenChange,
    onCreateCandidate,
    onSelectCandidate,
    onValidateCandidate,
    onPublishCandidate,
  } = props;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold">Tool Candidate Lifecycle</h3>
        <CandidateCreateDialog
          open={isCreateCandidateOpen}
          onOpenChange={onCreateCandidateOpenChange}
          onSubmit={onCreateCandidate}
          isSubmitting={isCreateCandidateSubmitting}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        Validate candidate code, inspect logs, and publish validated versions.
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        <CandidateTable
          isCandidatesLoading={isCandidatesLoading}
          candidates={candidates}
          selectedCandidateId={selectedCandidateId}
          onSelectCandidate={onSelectCandidate}
        />
        <div className="space-y-4 lg:col-span-2">
          <ToolPublishPanel
            candidate={selectedCandidate}
            latestValidationRun={latestValidationRun}
            onValidate={onValidateCandidate}
            onPublish={onPublishCandidate}
            isValidating={isValidating}
            isPublishing={isPublishing}
          />
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Validation Runs</h4>
            <ToolValidationRuns
              runs={validationRuns}
              isLoading={isValidationRunsLoading}
            />
          </div>
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Version History</h4>
            <ToolVersionHistory
              candidates={candidates}
              selectedToolName={selectedCandidate?.tool_name}
              isLoading={isCandidatesLoading}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

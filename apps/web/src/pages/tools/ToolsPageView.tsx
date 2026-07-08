import { CreateToolDialog } from "./CreateToolDialog";
import { DeleteToolAlert } from "./DeleteToolAlert";
import { EditToolDialog } from "./EditToolDialog";
import { ToolDetailDialog } from "./ToolDetailDialog";
import { ToolFormValues } from "./ToolFormValues.types";
import { ToolsCandidateLifecycleSection } from "./ToolsCandidateLifecycleSection";
import { ToolsListSection } from "./ToolsListSection";
import { isManualToolSource } from "./tool-source";
import { Tool, ToolCandidate, ToolValidationRun } from "@/lib/api/tools.types";
import type { SortDirection, ToolSortField } from "./ToolsListSection";

interface ToolsPageViewProps {
  tools: Tool[];
  isLoading: boolean;
  total: number;
  page: number;
  pageSize: number;
  search: string;
  sortBy: ToolSortField;
  sortDir: SortDirection;
  onSearchChange: (value: string) => void;
  onSortByChange: (value: ToolSortField) => void;
  onSortDirChange: (value: SortDirection) => void;
  onPageChange: (page: number) => void;
  candidates: ToolCandidate[];
  isCandidatesLoading: boolean;
  selectedCandidateId: string | null;
  selectedCandidate: ToolCandidate | null;
  validationRuns: ToolValidationRun[];
  isValidationRunsLoading: boolean;
  latestValidationRun: ToolValidationRun | null;
  editingTool: Tool | null;
  deletingTool: Tool | null;
  isCreateOpen: boolean;
  isCreateCandidateOpen: boolean;
  isEditOpen: boolean;
  isCreateSubmitting: boolean;
  isCreateCandidateSubmitting: boolean;
  isUpdateSubmitting: boolean;
  isValidating: boolean;
  isPublishing: boolean;
  onCreateOpenChange: (open: boolean) => void;
  onCreateCandidateOpenChange: (open: boolean) => void;
  onEditOpenChange: (open: boolean) => void;
  onDeleteDialogOpenChange: (open: boolean) => void;
  onCreate: (data: ToolFormValues) => Promise<void>;
  onCreateCandidate: (data: ToolFormValues) => Promise<void>;
  onUpdate: (data: ToolFormValues) => Promise<void>;
  onValidateCandidate: () => Promise<void>;
  onPublishCandidate: () => Promise<void>;
  onSelectCandidate: (candidateId: string) => void;
  onEditTool: (tool: Tool) => void;
  onDeleteTool: (tool: Tool) => void;
  onEditCancel: () => void;
  onDeleteCancel: () => void;
  onDeleteConfirm: () => Promise<void>;
}

export function ToolsPageView(props: Readonly<ToolsPageViewProps>) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Tools</h2>
          <p className="text-muted-foreground">
            Manage reusable tools available to workflow agents
          </p>
        </div>
        <CreateToolDialog
          open={props.isCreateOpen}
          onOpenChange={props.onCreateOpenChange}
          onSubmit={props.onCreate}
          isSubmitting={props.isCreateSubmitting}
        />
      </div>

      <ToolsListSection
        isLoading={props.isLoading}
        tools={props.tools}
        total={props.total}
        page={props.page}
        pageSize={props.pageSize}
        search={props.search}
        sortBy={props.sortBy}
        sortDir={props.sortDir}
        onSearchChange={props.onSearchChange}
        onSortByChange={props.onSortByChange}
        onSortDirChange={props.onSortDirChange}
        onPageChange={props.onPageChange}
        onEditTool={props.onEditTool}
        onDeleteTool={props.onDeleteTool}
      />

      <ToolsCandidateLifecycleSection
        candidates={props.candidates}
        isCandidatesLoading={props.isCandidatesLoading}
        selectedCandidateId={props.selectedCandidateId}
        selectedCandidate={props.selectedCandidate}
        validationRuns={props.validationRuns}
        isValidationRunsLoading={props.isValidationRunsLoading}
        latestValidationRun={props.latestValidationRun}
        isCreateCandidateOpen={props.isCreateCandidateOpen}
        isCreateCandidateSubmitting={props.isCreateCandidateSubmitting}
        isValidating={props.isValidating}
        isPublishing={props.isPublishing}
        onCreateCandidateOpenChange={props.onCreateCandidateOpenChange}
        onCreateCandidate={props.onCreateCandidate}
        onSelectCandidate={props.onSelectCandidate}
        onValidateCandidate={props.onValidateCandidate}
        onPublishCandidate={props.onPublishCandidate}
      />

      {props.editingTool && !isManualToolSource(props.editingTool.source) ? (
        <ToolDetailDialog
          open={props.isEditOpen}
          tool={props.editingTool}
          onOpenChange={props.onEditOpenChange}
          onCancel={props.onEditCancel}
        />
      ) : (
        <EditToolDialog
          open={props.isEditOpen}
          onOpenChange={props.onEditOpenChange}
          tool={props.editingTool}
          onCancel={props.onEditCancel}
          onSubmit={props.onUpdate}
          isSubmitting={props.isUpdateSubmitting}
        />
      )}

      <DeleteToolAlert
        deletingTool={props.deletingTool}
        onOpenChange={props.onDeleteDialogOpenChange}
        onCancel={props.onDeleteCancel}
        onConfirmDelete={props.onDeleteConfirm}
      />
    </div>
  );
}

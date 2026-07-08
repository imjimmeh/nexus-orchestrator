import { useEffect, useMemo, useState } from "react";
import {
  useToolsPaged,
  useCreateTool,
  useCreateToolCandidate,
  useUpdateTool,
  useDeleteTool,
  useToolCandidates,
  useToolCandidate,
  useToolCandidateValidationRuns,
  useValidateToolCandidate,
  usePublishToolCandidate,
} from "@/hooks/useTools";
import { Tool, ToolCandidate, ToolValidationRun } from "@/lib/api/tools.types";
import { ToolFormValues } from "./ToolFormValues.types";
import {
  SORT_DIRECTION,
  TOOL_SORT_FIELD,
  type SortDirection,
  type ToolSortField,
} from "./ToolsListSection";

const PAGE_SIZE = 20;

export interface ToolsPageViewModel {
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

export function useToolsPageViewModel(): ToolsPageViewModel {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<ToolSortField>(TOOL_SORT_FIELD.NAME);
  const [sortDir, setSortDir] = useState<SortDirection>(SORT_DIRECTION.ASC);
  const [page, setPage] = useState(0);

  // Reset to first page when search/sort changes.
  useEffect(() => {
    setPage(0);
  }, [search, sortBy, sortDir]);

  const toolsQuery = useToolsPaged({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    search: search || undefined,
    sortBy,
    sortDir,
  });
  const tools = toolsQuery.data?.data ?? [];
  const total = toolsQuery.data?.meta?.pagination.total ?? 0;

  const candidatesQuery = useToolCandidates({ limit: 100, offset: 0 });
  const candidates: ToolCandidate[] = candidatesQuery.data ?? [];

  const createTool = useCreateTool();
  const createToolCandidate = useCreateToolCandidate();
  const updateTool = useUpdateTool();
  const deleteTool = useDeleteTool();
  const validateToolCandidate = useValidateToolCandidate();
  const publishToolCandidate = usePublishToolCandidate();

  const [editingTool, setEditingTool] = useState<Tool | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreateCandidateOpen, setIsCreateCandidateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [deletingTool, setDeletingTool] = useState<Tool | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (candidates.length === 0) {
      setSelectedCandidateId(null);
      return;
    }

    const hasSelected = candidates.some(
      (candidate) => candidate.id === selectedCandidateId,
    );
    if (!hasSelected) {
      setSelectedCandidateId(candidates[0]?.id ?? null);
    }
  }, [candidates, selectedCandidateId]);

  const selectedCandidateFromList = useMemo(
    () =>
      candidates.find((candidate) => candidate.id === selectedCandidateId) ??
      null,
    [candidates, selectedCandidateId],
  );

  const candidateDetailQuery = useToolCandidate(
    selectedCandidateId ?? undefined,
  );

  const selectedCandidate: ToolCandidate | null =
    candidateDetailQuery.data ?? selectedCandidateFromList;

  const validationRunsQuery = useToolCandidateValidationRuns(
    selectedCandidateId ?? undefined,
    { limit: 10, offset: 0 },
  );
  const validationRuns: ToolValidationRun[] = validationRunsQuery.data ?? [];
  const latestValidationRun: ToolValidationRun | null = validationRuns[0] ?? null;

  const handleCreate = async (data: ToolFormValues) => {
    await createTool.mutateAsync({
      name: data.name,
      language: data.language,
      schema: JSON.parse(data.schema),
      typescript_code: data.typescript_code,
      tier_restriction: Number(data.tier_restriction),
    });
    setIsCreateOpen(false);
  };

  const handleCreateCandidate = async (data: ToolFormValues) => {
    await createToolCandidate.mutateAsync({
      tool_name: data.name,
      language: data.language,
      schema: JSON.parse(data.schema),
      source_code: data.typescript_code,
    });
    setIsCreateCandidateOpen(false);
  };

  const handleUpdate = async (data: ToolFormValues) => {
    if (!editingTool) return;

    await updateTool.mutateAsync({
      id: editingTool.id,
      data: {
        name: data.name,
        language: data.language,
        schema: JSON.parse(data.schema),
        typescript_code: data.typescript_code,
        tier_restriction: Number(data.tier_restriction),
      },
    });

    setIsEditOpen(false);
    setEditingTool(null);
  };

  const handleDelete = async () => {
    if (!deletingTool) return;
    await deleteTool.mutateAsync(deletingTool.id);
    setDeletingTool(null);
  };

  const handleValidateCandidate = async () => {
    if (!selectedCandidateId) return;
    await validateToolCandidate.mutateAsync(selectedCandidateId);
  };

  const handlePublishCandidate = async () => {
    if (!selectedCandidateId) return;
    await publishToolCandidate.mutateAsync(selectedCandidateId);
  };

  return {
    tools,
    isLoading: toolsQuery.isLoading,
    total,
    page,
    pageSize: PAGE_SIZE,
    search,
    sortBy,
    sortDir,
    onSearchChange: setSearch,
    onSortByChange: setSortBy,
    onSortDirChange: setSortDir,
    onPageChange: setPage,
    candidates,
    isCandidatesLoading: candidatesQuery.isLoading,
    selectedCandidateId,
    selectedCandidate,
    validationRuns,
    isValidationRunsLoading: validationRunsQuery.isLoading,
    latestValidationRun,
    editingTool,
    deletingTool,
    isCreateOpen,
    isCreateCandidateOpen,
    isEditOpen,
    isCreateSubmitting: createTool.isPending,
    isCreateCandidateSubmitting: createToolCandidate.isPending,
    isUpdateSubmitting: updateTool.isPending,
    isValidating: validateToolCandidate.isPending,
    isPublishing: publishToolCandidate.isPending,
    onCreateOpenChange: setIsCreateOpen,
    onCreateCandidateOpenChange: setIsCreateCandidateOpen,
    onEditOpenChange: setIsEditOpen,
    onDeleteDialogOpenChange: () => setDeletingTool(null),
    onCreate: handleCreate,
    onCreateCandidate: handleCreateCandidate,
    onUpdate: handleUpdate,
    onValidateCandidate: handleValidateCandidate,
    onPublishCandidate: handlePublishCandidate,
    onSelectCandidate: setSelectedCandidateId,
    onEditTool: (tool) => {
      setEditingTool(tool);
      setIsEditOpen(true);
    },
    onDeleteTool: setDeletingTool,
    onEditCancel: () => {
      setIsEditOpen(false);
      setEditingTool(null);
    },
    onDeleteCancel: () => setDeletingTool(null),
    onDeleteConfirm: handleDelete,
  };
}

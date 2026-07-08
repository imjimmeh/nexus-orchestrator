import { useState } from "react";
import {
  useCreateProvider,
  useUpdateProvider,
  useDeleteProvider,
  useProviders,
} from "@/hooks/useProviders";
import {
  useCreateModel,
  useUpdateModel,
  useDeleteModel,
  useModels,
} from "@/hooks/useModels";
import { useSecrets } from "@/hooks/useSecrets";
import { useScopeContext } from "@/context/ScopeContext";
import { LLMModel } from "@/lib/api/models.types";
import { LLMProvider } from "@/lib/api/providers.types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search } from "lucide-react";
import { ProviderForm, type ProviderFormData } from "./ProviderForm";
import {
  ProviderDeleteDialog,
  buildProviderPayload,
} from "./ProviderSubcomponents";
import { ModelDialogs } from "./ModelDialogs";
import { ProvidersTableRows } from "./ProvidersTableRows";

function filterProviderList(
  providers: LLMProvider[],
  models: LLMModel[],
  searchQuery: string,
  statusFilter: string,
): LLMProvider[] {
  return providers.filter((provider) => {
    if (statusFilter === "active" && !provider.is_active) return false;
    if (statusFilter === "inactive" && provider.is_active) return false;
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const matchesProviderName = provider.name.toLowerCase().includes(query);
    const matchesModelName = models.some(
      (m) =>
        m.provider_name === provider.name &&
        m.name.toLowerCase().includes(query),
    );
    return matchesProviderName || matchesModelName;
  });
}

function getUnassignedModels(
  models: LLMModel[],
  providers: LLMProvider[],
): LLMModel[] {
  return models.filter((model) => {
    if (!model.provider_name) return true;
    return !providers.some((p) => p.name === model.provider_name);
  });
}

function filterModelList(
  models: LLMModel[],
  searchQuery: string,
  statusFilter: string,
): LLMModel[] {
  return models.filter((model) => {
    if (statusFilter === "active" && !model.is_active) return false;
    if (statusFilter === "inactive" && model.is_active) return false;
    if (!searchQuery) return true;
    return model.name.toLowerCase().includes(searchQuery.toLowerCase());
  });
}

function resolveEditingModelProvider(
  editingModel: LLMModel | null,
  providers: LLMProvider[],
): LLMProvider | null {
  if (!editingModel) return null;
  const provider = providers.find((p) => p.name === editingModel.provider_name);
  if (provider) return provider;

  return {
    id: "unassigned",
    name: editingModel.provider_name || "unassigned",
    provider_id: "custom",
    auth_type: "api_key",
    runtime_env: {},
    is_active: false,
    created_at: "",
    updated_at: "",
  };
}

function ProvidersHeaderSection({
  isCreateOpen,
  setIsCreateOpen,
  createProviderIsPending,
  secrets,
  handleCreateProvider,
}: Readonly<{
  isCreateOpen: boolean;
  setIsCreateOpen: (open: boolean) => void;
  createProviderIsPending: boolean;
  secrets: ReturnType<typeof useSecrets>["data"];
  handleCreateProvider: (data: ProviderFormData) => Promise<void>;
}>) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">
          LLM Providers & Models
        </h2>
        <p className="text-muted-foreground">
          Manage your AI service providers and configure their models
        </p>
      </div>
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogTrigger asChild>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Add Provider
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Create Provider</DialogTitle>
          </DialogHeader>
          <ProviderForm
            secrets={secrets ?? []}
            onSubmit={handleCreateProvider}
            onCancel={() => setIsCreateOpen(false)}
            isSubmitting={createProviderIsPending}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProvidersSearchAndFilterSection({
  searchQuery,
  statusFilter,
  setSearchQuery,
  setStatusFilter,
}: Readonly<{
  searchQuery: string;
  statusFilter: string;
  setSearchQuery: (value: string) => void;
  setStatusFilter: (value: string) => void;
}>) {
  return (
    <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
      <div className="relative flex-1 w-full max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search providers or models..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-8"
        />
      </div>
      <div className="flex gap-2 w-full sm:w-auto">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

export function Providers() {
  const { activeScopeNodeId } = useScopeContext();
  const { data: secrets = [] } = useSecrets();
  const { data: providers = [], isLoading: isLoadingProviders } = useProviders({
    scopeNodeId: activeScopeNodeId,
  });
  const { data: models = [], isLoading: isLoadingModels } = useModels();

  const createProvider = useCreateProvider();
  const updateProvider = useUpdateProvider();
  const deleteProvider = useDeleteProvider();

  const createModel = useCreateModel();
  const updateModel = useUpdateModel();
  const deleteModel = useDeleteModel();

  const [editingProvider, setEditingProvider] = useState<LLMProvider | null>(
    null,
  );
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [deletingProvider, setDeletingProvider] = useState<LLMProvider | null>(
    null,
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [creatingModelForProvider, setCreatingModelForProvider] =
    useState<LLMProvider | null>(null);
  const [editingModel, setEditingModel] = useState<LLMModel | null>(null);
  const [deletingModel, setDeletingModel] = useState<LLMModel | null>(null);
  const [expandedProviderIds, setExpandedProviderIds] = useState<Set<string>>(
    new Set(),
  );
  const [unassignedExpanded, setUnassignedExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const toggleProvider = (id: string) => {
    setExpandedProviderIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleCreateProvider = async (data: ProviderFormData) => {
    await createProvider.mutateAsync({
      ...buildProviderPayload(data),
      is_active: true,
    });
    setIsCreateOpen(false);
  };

  const handleUpdateProvider = async (data: ProviderFormData) => {
    if (!editingProvider) return;
    await updateProvider.mutateAsync({
      id: editingProvider.id,
      data: buildProviderPayload(data),
    });
    setIsEditOpen(false);
    setEditingProvider(null);
  };

  const handleDeleteProvider = async () => {
    if (!deletingProvider) return;
    try {
      await deleteProvider.mutateAsync(deletingProvider.id);
      setDeletingProvider(null);
      setDeleteError(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const handleCreateModel = async (data: any) => {
    if (!creatingModelForProvider) return;
    await createModel.mutateAsync({
      ...data,
      provider_name: creatingModelForProvider.name,
      is_active: true,
    });
    setCreatingModelForProvider(null);
  };

  const handleUpdateModel = async (data: any) => {
    if (!editingModel) return;
    await updateModel.mutateAsync({
      id: editingModel.id,
      data: { ...data, provider_name: editingModel.provider_name || undefined },
    });
    setEditingModel(null);
  };

  const handleDeleteModel = async () => {
    if (!deletingModel) return;
    await deleteModel.mutateAsync(deletingModel.id);
    setDeletingModel(null);
  };

  const filteredProviders = filterProviderList(
    providers,
    models,
    searchQuery,
    statusFilter,
  );
  const filteredUnassignedModels = filterModelList(
    getUnassignedModels(models, providers),
    searchQuery,
    statusFilter,
  );
  const activeEditingModelProvider = resolveEditingModelProvider(
    editingModel,
    providers,
  );

  return (
    <div className="space-y-6">
      <ProvidersHeaderSection
        isCreateOpen={isCreateOpen}
        setIsCreateOpen={setIsCreateOpen}
        createProviderIsPending={createProvider.isPending}
        secrets={secrets}
        handleCreateProvider={handleCreateProvider}
      />

      <ProvidersSearchAndFilterSection
        searchQuery={searchQuery}
        statusFilter={statusFilter}
        setSearchQuery={setSearchQuery}
        setStatusFilter={setStatusFilter}
      />

      <div className="rounded-md border bg-card text-card-foreground shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]"></TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Auth Type</TableHead>
              <TableHead>Secret</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>OAuth</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <ProvidersTableRows
            isLoadingProviders={isLoadingProviders}
            isLoadingModels={isLoadingModels}
            filteredProviders={filteredProviders}
            filteredUnassignedModels={filteredUnassignedModels}
            models={models}
            secrets={secrets}
            expandedProviderIds={expandedProviderIds}
            unassignedExpanded={unassignedExpanded}
            onToggleProvider={toggleProvider}
            onSetUnassignedExpanded={setUnassignedExpanded}
            onAddModel={setCreatingModelForProvider}
            onEditProvider={(provider) => {
              setEditingProvider(provider);
              setIsEditOpen(true);
            }}
            onDeleteProvider={setDeletingProvider}
            onEditModel={setEditingModel}
            onDeleteModel={setDeletingModel}
          />
        </Table>
      </div>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Edit Provider</DialogTitle>
          </DialogHeader>
          {editingProvider && (
            <ProviderForm
              provider={editingProvider}
              secrets={secrets}
              onSubmit={handleUpdateProvider}
              onCancel={() => {
                setIsEditOpen(false);
                setEditingProvider(null);
              }}
              isSubmitting={updateProvider.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      <ProviderDeleteDialog
        provider={deletingProvider}
        error={deleteError}
        isPending={deleteProvider.isPending}
        onCancel={() => {
          setDeletingProvider(null);
          setDeleteError(null);
        }}
        onConfirm={handleDeleteProvider}
      />

      <ModelDialogs
        creatingModelForProvider={creatingModelForProvider}
        onCloseCreate={() => setCreatingModelForProvider(null)}
        onCreateSubmit={handleCreateModel}
        isCreateSubmitting={createModel.isPending}
        editingModel={editingModel}
        editingModelProvider={activeEditingModelProvider}
        onCloseEdit={() => setEditingModel(null)}
        onEditSubmit={handleUpdateModel}
        isEditSubmitting={updateModel.isPending}
        deletingModel={deletingModel}
        onCloseDelete={() => setDeletingModel(null)}
        onDeleteConfirm={handleDeleteModel}
        isDeleteSubmitting={deleteModel.isPending}
      />
    </div>
  );
}

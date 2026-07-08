import { LLMModel } from "@/lib/api/models.types";
import { LLMProvider } from "@/lib/api/providers.types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import {
  getSecretName,
  OAuthStatusBadge,
  OAuthActions,
} from "./ProviderSubcomponents";
import { ModelsSubTable } from "./ModelsSubTable";
import type { useSecrets } from "@/hooks/useSecrets";

type SecretsList = ReturnType<typeof useSecrets>["data"];

export interface ProvidersTableRowsProps {
  isLoadingProviders: boolean;
  isLoadingModels: boolean;
  filteredProviders: LLMProvider[];
  filteredUnassignedModels: LLMModel[];
  models: LLMModel[];
  secrets: SecretsList;
  expandedProviderIds: Set<string>;
  unassignedExpanded: boolean;
  onToggleProvider: (id: string) => void;
  onSetUnassignedExpanded: (v: boolean) => void;
  onAddModel: (provider: LLMProvider) => void;
  onEditProvider: (provider: LLMProvider) => void;
  onDeleteProvider: (provider: LLMProvider) => void;
  onEditModel: (model: LLMModel) => void;
  onDeleteModel: (model: LLMModel) => void;
}

interface ProviderRowProps {
  provider: LLMProvider;
  models: LLMModel[];
  secrets: SecretsList;
  isExpanded: boolean;
  onToggleProvider: (id: string) => void;
  onAddModel: (provider: LLMProvider) => void;
  onEditProvider: (provider: LLMProvider) => void;
  onDeleteProvider: (provider: LLMProvider) => void;
  onEditModel: (model: LLMModel) => void;
  onDeleteModel: (model: LLMModel) => void;
}

function ProviderRow({
  provider,
  models,
  secrets,
  isExpanded,
  onToggleProvider,
  onAddModel,
  onEditProvider,
  onDeleteProvider,
  onEditModel,
  onDeleteModel,
}: Readonly<ProviderRowProps>) {
  const providerModels = models.filter(
    (m) => m.provider_name === provider.name,
  );
  const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <>
      <TableRow
        className="cursor-pointer transition-colors hover:bg-muted/50"
        onClick={() => onToggleProvider(provider.id)}
      >
        <TableCell onClick={stopPropagation}>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 p-0"
            onClick={() => onToggleProvider(provider.id)}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        </TableCell>
        <TableCell className="font-semibold">
          <div className="flex items-center gap-2">
            <span>{provider.name}</span>
            <Badge variant="secondary" className="text-xs font-normal">
              {providerModels.length}{" "}
              {providerModels.length === 1 ? "model" : "models"}
            </Badge>
          </div>
        </TableCell>
        <TableCell className="capitalize">
          {provider.auth_type.replace("_", " ")}
        </TableCell>
        <TableCell>
          {getSecretName(provider.secret_id, secrets ?? [])}
        </TableCell>
        <TableCell>
          <Badge variant={provider.is_active ? "default" : "secondary"}>
            {provider.is_active ? "Active" : "Inactive"}
          </Badge>
        </TableCell>
        <TableCell onClick={stopPropagation}>
          {provider.auth_type === "oauth" ? (
            <OAuthStatusBadge providerId={provider.id} />
          ) : (
            <span className="text-sm text-muted-foreground">-</span>
          )}
        </TableCell>
        <TableCell className="text-right" onClick={stopPropagation}>
          <div className="flex justify-end gap-2">
            {provider.auth_type === "oauth" && (
              <OAuthActions provider={provider} />
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => onAddModel(provider)}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Model
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onEditProvider(provider)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onDeleteProvider(provider)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </TableCell>
      </TableRow>

      {isExpanded && (
        <TableRow className="bg-muted/20 hover:bg-muted/20">
          <TableCell colSpan={7} className="p-4 pl-12 border-t">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold tracking-tight text-muted-foreground">
                  Configured Models ({providerModels.length})
                </h4>
              </div>
              {providerModels.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  No models configured for this provider. Click "+ Model" to
                  configure one.
                </p>
              ) : (
                <ModelsSubTable
                  models={providerModels}
                  onEditModel={onEditModel}
                  onDeleteModel={onDeleteModel}
                />
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

interface UnassignedModelsRowProps {
  unassignedModels: LLMModel[];
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onEditModel: (model: LLMModel) => void;
  onDeleteModel: (model: LLMModel) => void;
}

function UnassignedModelsRow({
  unassignedModels,
  isExpanded,
  onToggleExpanded,
  onEditModel,
  onDeleteModel,
}: Readonly<UnassignedModelsRowProps>) {
  const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <>
      <TableRow
        className="cursor-pointer bg-muted/10 transition-colors hover:bg-muted/20"
        onClick={onToggleExpanded}
      >
        <TableCell onClick={stopPropagation}>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 p-0"
            onClick={onToggleExpanded}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        </TableCell>
        <TableCell className="font-semibold text-destructive">
          <div className="flex items-center gap-2">
            <span>Unassigned Models</span>
            <Badge
              variant="outline"
              className="text-destructive border-destructive text-xs font-normal"
            >
              {unassignedModels.length}
            </Badge>
          </div>
        </TableCell>
        <TableCell colSpan={4} className="text-muted-foreground italic text-xs">
          Models configured for missing/unconfigured providers.
        </TableCell>
        <TableCell className="text-right">
          <Badge
            variant="outline"
            className="text-destructive border-destructive"
          >
            Needs Config
          </Badge>
        </TableCell>
      </TableRow>

      {isExpanded && (
        <TableRow className="bg-muted/20 hover:bg-muted/20">
          <TableCell colSpan={7} className="p-4 pl-12 border-t">
            <div className="space-y-3">
              <h4 className="text-sm font-semibold tracking-tight text-destructive">
                Unconfigured Provider Models
              </h4>
              <ModelsSubTable
                models={unassignedModels}
                onEditModel={onEditModel}
                onDeleteModel={onDeleteModel}
                showProviderName={true}
              />
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export function ProvidersTableRows({
  isLoadingProviders,
  isLoadingModels,
  filteredProviders,
  filteredUnassignedModels,
  models,
  secrets,
  expandedProviderIds,
  unassignedExpanded,
  onToggleProvider,
  onSetUnassignedExpanded,
  onAddModel,
  onEditProvider,
  onDeleteProvider,
  onEditModel,
  onDeleteModel,
}: Readonly<ProvidersTableRowsProps>) {
  if (isLoadingProviders || isLoadingModels) {
    return (
      <TableBody>
        <TableRow>
          <TableCell colSpan={7} className="text-center h-24">
            Loading...
          </TableCell>
        </TableRow>
      </TableBody>
    );
  }

  if (filteredProviders.length === 0 && filteredUnassignedModels.length === 0) {
    return (
      <TableBody>
        <TableRow>
          <TableCell
            colSpan={7}
            className="text-center h-24 text-muted-foreground"
          >
            No providers or models found.
          </TableCell>
        </TableRow>
      </TableBody>
    );
  }

  return (
    <TableBody>
      {filteredProviders.map((provider) => (
        <ProviderRow
          key={provider.id}
          provider={provider}
          models={models}
          secrets={secrets}
          isExpanded={expandedProviderIds.has(provider.id)}
          onToggleProvider={onToggleProvider}
          onAddModel={onAddModel}
          onEditProvider={onEditProvider}
          onDeleteProvider={onDeleteProvider}
          onEditModel={onEditModel}
          onDeleteModel={onDeleteModel}
        />
      ))}

      {filteredUnassignedModels.length > 0 && (
        <UnassignedModelsRow
          unassignedModels={filteredUnassignedModels}
          isExpanded={unassignedExpanded}
          onToggleExpanded={() => onSetUnassignedExpanded(!unassignedExpanded)}
          onEditModel={onEditModel}
          onDeleteModel={onDeleteModel}
        />
      )}
    </TableBody>
  );
}

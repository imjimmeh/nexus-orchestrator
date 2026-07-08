import { useState } from "react";
import {
  useResolvedAgentProfile,
  useResolvedWorkflow,
  useForkAgentForScope,
  useForkWorkflowForScope,
} from "@/hooks/useScopedConfig";
import { useAgentProfiles } from "@/hooks/useAgentProfiles";
import { useWorkflows } from "@/hooks/useWorkflows";
import { useScopeContext } from "@/context/ScopeContext";
import { GLOBAL_SCOPE_NODE_ID } from "@/lib/api/client.scope.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AsyncButton } from "@/components/ui/async-button";

type ObjectType = "agent" | "workflow";

interface ScopedConfigViewerProps {
  presetScopeNodeId?: string;
}

interface SelectorsPanelProps {
  objectType: ObjectType;
  selectedName: string;
  scopeNodeId: string;
  presetScopeNodeId?: string;
  names: string[];
  activeScopeNodeId: string;
  activeScopePath: string[];
  onObjectTypeChange: (value: ObjectType) => void;
  onSelectedNameChange: (value: string) => void;
  onScopeNodeIdChange: (value: string) => void;
  onUseActiveScope: () => void;
}

function SelectorsPanel({
  objectType,
  selectedName,
  scopeNodeId,
  presetScopeNodeId,
  names,
  activeScopeNodeId,
  activeScopePath,
  onObjectTypeChange,
  onSelectedNameChange,
  onScopeNodeIdChange,
  onUseActiveScope,
}: Readonly<SelectorsPanelProps>) {
  const showActiveScopeHint =
    !presetScopeNodeId && activeScopeNodeId !== GLOBAL_SCOPE_NODE_ID;
  return (
    <div className="grid grid-cols-3 gap-4">
      <div>
        <Label htmlFor="objectType">Object type</Label>
        <Select
          value={objectType}
          onValueChange={(value) => {
            onObjectTypeChange(value as ObjectType);
          }}
        >
          <SelectTrigger id="objectType">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="agent">Agent Profile</SelectItem>
            <SelectItem value="workflow">Workflow</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="objectName">Name</Label>
        <Select value={selectedName} onValueChange={onSelectedNameChange}>
          <SelectTrigger id="objectName">
            <SelectValue placeholder="— select —" />
          </SelectTrigger>
          <SelectContent>
            {names.map((n) => (
              <SelectItem key={n} value={n}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="scopeNodeId">Scope node ID</Label>
        <Input
          id="scopeNodeId"
          value={scopeNodeId}
          onChange={(e) => onScopeNodeIdChange(e.target.value)}
          placeholder="UUID or leave blank for global"
          readOnly={!!presetScopeNodeId}
        />
        {showActiveScopeHint && (
          <p className="text-xs text-muted-foreground mt-1">
            Active scope:{" "}
            <strong>
              {activeScopePath[activeScopePath.length - 1] ??
                activeScopeNodeId}
            </strong>{" "}
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={onUseActiveScope}
            >
              Use active scope
            </Button>
          </p>
        )}
      </div>
    </div>
  );
}

interface ForkEditorPanelProps {
  showForkEditor: boolean;
  forkPayload: string;
  isPending: boolean;
  onFork: () => void;
  onCancel: () => void;
  onPayloadChange: (value: string) => void;
}

function ForkEditorPanel({
  showForkEditor,
  forkPayload,
  isPending,
  onFork,
  onCancel,
  onPayloadChange,
}: Readonly<ForkEditorPanelProps>) {
  if (!showForkEditor) {
    return null;
  }
  return (
    <div className="space-y-2">
      <Label>Override payload</Label>
      <Textarea
        className="font-mono text-xs h-40"
        value={forkPayload}
        onChange={(e) => onPayloadChange(e.target.value)}
      />
      <div className="flex gap-2">
        <AsyncButton
          type="button"
          size="sm"
          isLoading={isPending}
          onClick={onFork}
        >
          Save override
        </AsyncButton>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

interface ConfigDisplayPanelProps {
  isLoading: boolean;
  isError: boolean;
  isDefault: boolean;
  scopeNodeId: string;
  locked: boolean;
  value: unknown;
  showForkEditor: boolean;
  showCreateOverrideButton: boolean;
  initialForkPayload: string;
  forkPayload: string;
  forkPending: boolean;
  onStartFork: () => void;
  onCancelFork: () => void;
  onPayloadChange: (value: string) => void;
  onFork: () => void;
}

function ConfigDisplayPanel({
  isLoading,
  isError,
  isDefault,
  scopeNodeId,
  locked,
  value,
  showForkEditor,
  showCreateOverrideButton,
  initialForkPayload,
  forkPayload,
  forkPending,
  onStartFork,
  onCancelFork,
  onPayloadChange,
  onFork,
}: Readonly<ConfigDisplayPanelProps>) {
  const noPayload = !forkPayload && !!initialForkPayload;
  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground">Resolving…</p>
    );
  }
  if (isError) {
    return (
      <p className="text-sm text-destructive">
        Could not resolve config for this scope.
      </p>
    );
  }
  if (!value) {
    return null;
  }
  return (
    <div className="border rounded p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">
          Source:{" "}
          <span
            className={
              isDefault ? "text-muted-foreground" : "text-primary"
            }
          >
            {isDefault ? "Platform default" : `Override · ${scopeNodeId}`}
          </span>
        </span>
        {locked && (
          <span className="text-xs bg-warning/20 text-warning px-2 py-0.5 rounded">
            Locked
          </span>
        )}
      </div>

      <pre className="bg-muted/50 rounded p-3 text-xs overflow-auto max-h-64">
        {JSON.stringify(value, null, 2)}
      </pre>

      {showCreateOverrideButton && !showForkEditor && !locked && (
        <Button
          type="button"
          size="sm"
          onClick={() => {
            if (noPayload) {
              onPayloadChange(initialForkPayload);
            }
            onStartFork();
          }}
        >
          Create override for this scope
        </Button>
      )}

      <ForkEditorPanel
        showForkEditor={showForkEditor}
        forkPayload={forkPayload}
        isPending={forkPending}
        onFork={onFork}
        onCancel={onCancelFork}
        onPayloadChange={onPayloadChange}
      />
    </div>
  );
}

function resolveInitialScopeNodeId(
  presetScopeNodeId: string | undefined,
  activeScopeNodeId: string,
): string {
  if (presetScopeNodeId) return presetScopeNodeId;
  if (activeScopeNodeId === GLOBAL_SCOPE_NODE_ID) return "";
  return activeScopeNodeId;
}

export function ScopedConfigViewer({
  presetScopeNodeId,
}: ScopedConfigViewerProps = {}) {
  const { activeScopeNodeId, activeScopePath } = useScopeContext();
  const [objectType, setObjectType] = useState<ObjectType>("agent");
  const [selectedName, setSelectedName] = useState("");
  const [scopeNodeId, setScopeNodeId] = useState(() =>
    resolveInitialScopeNodeId(presetScopeNodeId, activeScopeNodeId),
  );
  const [showForkEditor, setShowForkEditor] = useState(false);
  const [forkPayload, setForkPayload] = useState("");

  const { data: agentProfiles } = useAgentProfiles();
  const { data: workflowsData } = useWorkflows();

  const resolvedAgent = useResolvedAgentProfile(
    objectType === "agent" ? selectedName : "",
    scopeNodeId || undefined,
  );
  const resolvedWorkflow = useResolvedWorkflow(
    objectType === "workflow" ? selectedName : "",
    scopeNodeId || undefined,
  );

  const forkAgent = useForkAgentForScope();
  const forkWorkflow = useForkWorkflowForScope();

  const resolved = objectType === "agent" ? resolvedAgent : resolvedWorkflow;
  const effectiveConfig = resolved.data;

  const names = resolveObjectNames(objectType, agentProfiles, workflowsData);

  function handleObjectTypeChange(nextObjectType: ObjectType) {
    setObjectType(nextObjectType);
    setSelectedName("");
  }

  function handleUseActiveScope() {
    setScopeNodeId(activeScopeNodeId);
  }

  function buildForkPayload(): string {
    return buildForkPayloadForObject(objectType, effectiveConfig);
  }

  function handleStartFork() {
    setForkPayload(buildForkPayload());
    setShowForkEditor(true);
  }

  function handleCancelFork() {
    setShowForkEditor(false);
  }

  function closeForkEditor() {
    setShowForkEditor(false);
  }

  function handleFork() {
    submitFork({
      objectType,
      effectiveConfig,
      scopeNodeId,
      forkPayload,
      forkAgent,
      forkWorkflow,
      onComplete: closeForkEditor,
    });
  }

  const showCreateOverrideButton = !!scopeNodeId;
  const isPending = forkAgent.isPending || forkWorkflow.isPending;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">Scoped Config</h1>

      <SelectorsPanel
        objectType={objectType}
        selectedName={selectedName}
        scopeNodeId={scopeNodeId}
        presetScopeNodeId={presetScopeNodeId}
        names={names}
        activeScopeNodeId={activeScopeNodeId}
        activeScopePath={activeScopePath}
        onObjectTypeChange={handleObjectTypeChange}
        onSelectedNameChange={setSelectedName}
        onScopeNodeIdChange={setScopeNodeId}
        onUseActiveScope={handleUseActiveScope}
      />

      <ConfigDisplayPanel
        isLoading={resolved.isLoading}
        isError={resolved.isError}
        isDefault={effectiveConfig?.isDefault ?? true}
        scopeNodeId={scopeNodeId}
        locked={effectiveConfig?.locked ?? false}
        value={effectiveConfig?.value}
        showForkEditor={showForkEditor}
        showCreateOverrideButton={showCreateOverrideButton}
        initialForkPayload={buildForkPayload()}
        forkPayload={forkPayload}
        forkPending={isPending}
        onStartFork={handleStartFork}
        onCancelFork={handleCancelFork}
        onPayloadChange={setForkPayload}
        onFork={handleFork}
      />
    </div>
  );
}

function resolveObjectNames(
  objectType: ObjectType,
  agentProfiles: { name: string }[] | undefined,
  workflowsData: unknown,
): string[] {
  if (objectType === "agent") {
    return (agentProfiles ?? []).map((p) => p.name);
  }
  const list =
    (workflowsData as { data?: { name: string }[] } | undefined)?.data ?? [];
  return list.map((w) => w.name);
}

function buildForkPayloadForObject(
  objectType: ObjectType,
  effectiveConfig: { value?: unknown } | undefined,
): string {
  if (!effectiveConfig) return "";
  if (objectType === "workflow") {
    return (
      (effectiveConfig.value as { yaml_definition?: string })
        .yaml_definition ?? ""
    );
  }
  return JSON.stringify(effectiveConfig.value, null, 2);
}

interface ForkSubmitHandlers {
  objectType: ObjectType;
  effectiveConfig: { value?: { id: string } } | undefined;
  scopeNodeId: string;
  forkPayload: string;
  forkAgent: ReturnType<typeof useForkAgentForScope>;
  forkWorkflow: ReturnType<typeof useForkWorkflowForScope>;
  onComplete: () => void;
}

function submitFork({
  objectType,
  effectiveConfig,
  scopeNodeId,
  forkPayload,
  forkAgent,
  forkWorkflow,
  onComplete,
}: ForkSubmitHandlers) {
  if (!effectiveConfig || !scopeNodeId) return;
  const value = effectiveConfig.value;
  if (objectType === "agent" && value) {
    forkAgent.mutate(
      { baseProfileId: value.id, scopeNodeId, data: {} },
      { onSuccess: onComplete },
    );
    return;
  }
  if (objectType === "workflow" && value) {
    forkWorkflow.mutate(
      { baseWorkflowId: value.id, scopeNodeId, yamlDefinition: forkPayload },
      { onSuccess: onComplete },
    );
  }
}
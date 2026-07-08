import { useMemo, useState } from "react";
import { AgentProfile } from "@/lib/api/agents.types";
import { WorkItemExecutionConfig } from "@/lib/api/work-items.types";
import { Dialog } from "@/components/ui/dialog";
import { TaskConfigModalContent } from "./TaskConfigModalContent";
import {
  createTaskConfigModalBehaviorHandlers,
  normalizeFileQuery,
  useTaskConfigInitialSync,
} from "./TaskConfigModal.logic";

interface TaskConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workItemTitle?: string;
  agentProfiles: AgentProfile[];
  branches: string[];
  files: string[];
  initialConfig?: WorkItemExecutionConfig | null;
  isSaving?: boolean;
  onSave: (config: WorkItemExecutionConfig) => Promise<void> | void;
}

interface TaskConfigModalViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workItemTitle?: string;
  agentProfiles: AgentProfile[];
  branches: string[];
  filteredFiles: string[];
  contextFiles: string[];
  documentationUrls: string[];
  fileQuery: string;
  documentationUrlInput: string;
  targetBranch: string;
  maxTokens: string;
  maxLoops: string;
  model: string;
  forceModelForSubagents: boolean;
  formError: string | null;
  agentProfileId: string;
  baseBranch: string;
  isSaving: boolean;
  onAgentProfileChange: (value: string) => void;
  onBaseBranchChange: (value: string) => void;
  onTargetBranchChange: (value: string) => void;
  onFileQueryChange: (value: string) => void;
  onContextFileAdd: (value: string) => void;
  onContextFileRemove: (value: string) => void;
  onDocumentationUrlInputChange: (value: string) => void;
  onDocumentationUrlAdd: () => void;
  onDocumentationUrlRemove: (value: string) => void;
  onMaxTokensChange: (value: string) => void;
  onMaxLoopsChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onForceModelForSubagentsChange: (value: boolean) => void;
  onCancel: () => void;
  onSubmit: () => Promise<void>;
}

function TaskConfigModalView({
  open,
  onOpenChange,
  workItemTitle,
  agentProfiles,
  branches,
  filteredFiles,
  contextFiles,
  documentationUrls,
  fileQuery,
  documentationUrlInput,
  targetBranch,
  maxTokens,
  maxLoops,
  model,
  forceModelForSubagents,
  formError,
  agentProfileId,
  baseBranch,
  isSaving,
  onAgentProfileChange,
  onBaseBranchChange,
  onTargetBranchChange,
  onFileQueryChange,
  onContextFileAdd,
  onContextFileRemove,
  onDocumentationUrlInputChange,
  onDocumentationUrlAdd,
  onDocumentationUrlRemove,
  onMaxTokensChange,
  onMaxLoopsChange,
  onModelChange,
  onForceModelForSubagentsChange,
  onCancel,
  onSubmit,
}: Readonly<TaskConfigModalViewProps>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <TaskConfigModalContent
        workItemTitle={workItemTitle}
        agentProfiles={agentProfiles}
        branches={branches}
        filteredFiles={filteredFiles}
        contextFiles={contextFiles}
        documentationUrls={documentationUrls}
        fileQuery={fileQuery}
        documentationUrlInput={documentationUrlInput}
        targetBranch={targetBranch}
        maxTokens={maxTokens}
        maxLoops={maxLoops}
        model={model}
        forceModelForSubagents={forceModelForSubagents}
        formError={formError}
        agentProfileId={agentProfileId}
        baseBranch={baseBranch}
        isSaving={isSaving}
        onAgentProfileChange={onAgentProfileChange}
        onBaseBranchChange={onBaseBranchChange}
        onTargetBranchChange={onTargetBranchChange}
        onFileQueryChange={onFileQueryChange}
        onContextFileAdd={onContextFileAdd}
        onContextFileRemove={onContextFileRemove}
        onDocumentationUrlInputChange={onDocumentationUrlInputChange}
        onDocumentationUrlAdd={onDocumentationUrlAdd}
        onDocumentationUrlRemove={onDocumentationUrlRemove}
        onMaxTokensChange={onMaxTokensChange}
        onMaxLoopsChange={onMaxLoopsChange}
        onModelChange={onModelChange}
        onForceModelForSubagentsChange={onForceModelForSubagentsChange}
        onCancel={onCancel}
        onSubmit={() => {
          void onSubmit();
        }}
      />
    </Dialog>
  );
}

export function TaskConfigModal({
  open,
  onOpenChange,
  workItemTitle,
  agentProfiles,
  branches,
  files,
  initialConfig,
  isSaving = false,
  onSave,
}: Readonly<TaskConfigModalProps>) {
  const [agentProfileId, setAgentProfileId] = useState<string>("");
  const [baseBranch, setBaseBranch] = useState<string>("");
  const [targetBranch, setTargetBranch] = useState<string>("");
  const [contextFiles, setContextFiles] = useState<string[]>([]);
  const [documentationUrls, setDocumentationUrls] = useState<string[]>([]);
  const [maxTokens, setMaxTokens] = useState<string>("");
  const [maxLoops, setMaxLoops] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const [forceModelForSubagents, setForceModelForSubagents] =
    useState<boolean>(false);
  const [fileQuery, setFileQuery] = useState<string>("");
  const [documentationUrlInput, setDocumentationUrlInput] =
    useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);

  useTaskConfigInitialSync({
    open,
    branches,
    initialConfig,
    workItemTitle,
    setAgentProfileId,
    setBaseBranch,
    setTargetBranch,
    setContextFiles,
    setDocumentationUrls,
    setMaxTokens,
    setMaxLoops,
    setModel,
    setForceModelForSubagents,
    setFileQuery,
    setDocumentationUrlInput,
    setFormError,
  });

  const filteredFiles = useMemo(() => {
    const normalizedQuery = normalizeFileQuery(fileQuery);
    if (!normalizedQuery) {
      return files.slice(0, 12);
    }

    return files
      .filter((file) => file.toLowerCase().includes(normalizedQuery))
      .slice(0, 12);
  }, [fileQuery, files]);

  const behaviorHandlers = createTaskConfigModalBehaviorHandlers({
    contextFiles,
    documentationUrlInput,
    documentationUrls,
    setContextFiles,
    setDocumentationUrls,
    setFileQuery,
    setDocumentationUrlInput,
    setAgentProfileId,
    onOpenChange,
    setFormError,
    onSave,
    agentProfileId,
    baseBranch,
    targetBranch,
    maxTokens,
    maxLoops,
    model,
    forceModelForSubagents,
  });

  return (
    <TaskConfigModalView
      open={open}
      onOpenChange={onOpenChange}
      workItemTitle={workItemTitle}
      agentProfiles={agentProfiles}
      branches={branches}
      filteredFiles={filteredFiles}
      contextFiles={contextFiles}
      documentationUrls={documentationUrls}
      fileQuery={fileQuery}
      documentationUrlInput={documentationUrlInput}
      targetBranch={targetBranch}
      maxTokens={maxTokens}
      maxLoops={maxLoops}
      model={model}
      forceModelForSubagents={forceModelForSubagents}
      formError={formError}
      agentProfileId={agentProfileId}
      baseBranch={baseBranch}
      isSaving={isSaving}
      onBaseBranchChange={setBaseBranch}
      onTargetBranchChange={setTargetBranch}
      onFileQueryChange={setFileQuery}
      onDocumentationUrlInputChange={setDocumentationUrlInput}
      onMaxTokensChange={setMaxTokens}
      onMaxLoopsChange={setMaxLoops}
      onModelChange={setModel}
      onForceModelForSubagentsChange={setForceModelForSubagents}
      {...behaviorHandlers}
    />
  );
}

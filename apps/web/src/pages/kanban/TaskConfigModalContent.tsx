import { AgentProfile } from "@/lib/api/agents.types";
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function AgentAndBranchSection({
  agentProfileId,
  baseBranch,
  agentProfiles,
  branches,
  onAgentProfileChange,
  onBaseBranchChange,
}: {
  agentProfileId: string;
  baseBranch: string;
  agentProfiles: AgentProfile[];
  branches: string[];
  onAgentProfileChange: (value: string) => void;
  onBaseBranchChange: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <Label>Agent Profile</Label>
        <Select
          value={agentProfileId || "__none__"}
          onValueChange={onAgentProfileChange}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select an agent profile" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">None</SelectItem>
            {agentProfiles.length === 0 && (
              <SelectItem value="__no_profiles__" disabled>
                No agent profiles
              </SelectItem>
            )}
            {agentProfiles.map((profile) => (
              <SelectItem key={profile.id} value={profile.id}>
                {profile.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Base Branch</Label>
        <Select value={baseBranch} onValueChange={onBaseBranchChange}>
          <SelectTrigger>
            <SelectValue placeholder="Select base branch" />
          </SelectTrigger>
          <SelectContent>
            {branches.length === 0 && (
              <SelectItem value="__no_branches__" disabled>
                No branches found
              </SelectItem>
            )}
            {branches.map((branch) => (
              <SelectItem key={branch} value={branch}>
                {branch}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function ContextAttachmentsSection({
  fileQuery,
  filteredFiles,
  contextFiles,
  onFileQueryChange,
  onContextFileAdd,
  onContextFileRemove,
}: {
  fileQuery: string;
  filteredFiles: string[];
  contextFiles: string[];
  onFileQueryChange: (value: string) => void;
  onContextFileAdd: (filePath: string) => void;
  onContextFileRemove: (filePath: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="context-files">Context Attachments (@file)</Label>
      <Input
        id="context-files"
        value={fileQuery}
        onChange={(event) => onFileQueryChange(event.target.value)}
        placeholder="@src/auth/service.ts"
      />
      {filteredFiles.length > 0 && (
        <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border p-2 text-sm">
          {filteredFiles.map((file) => (
            <button
              type="button"
              key={file}
              className="block w-full rounded px-2 py-1 text-left hover:bg-muted"
              onClick={() => onContextFileAdd(file)}
            >
              {file}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {contextFiles.map((file) => (
          <Badge
            key={file}
            variant="outline"
            className="cursor-pointer"
            onClick={() => onContextFileRemove(file)}
          >
            {file} ×
          </Badge>
        ))}
      </div>
    </div>
  );
}

function DocumentationSection({
  documentationUrls,
  documentationUrlInput,
  onDocumentationUrlInputChange,
  onDocumentationUrlAdd,
  onDocumentationUrlRemove,
}: {
  documentationUrls: string[];
  documentationUrlInput: string;
  onDocumentationUrlInputChange: (value: string) => void;
  onDocumentationUrlAdd: () => void;
  onDocumentationUrlRemove: (url: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>Documentation URLs</Label>
      <div className="flex gap-2">
        <Input
          value={documentationUrlInput}
          onChange={(event) =>
            onDocumentationUrlInputChange(event.target.value)
          }
          placeholder="https://docs.example.com/spec"
        />
        <Button type="button" variant="outline" onClick={onDocumentationUrlAdd}>
          Add
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {documentationUrls.map((url) => (
          <Badge
            key={url}
            variant="outline"
            className="cursor-pointer"
            onClick={() => onDocumentationUrlRemove(url)}
          >
            {url} ×
          </Badge>
        ))}
      </div>
    </div>
  );
}

function LimitsSection({
  maxTokens,
  maxLoops,
  onMaxTokensChange,
  onMaxLoopsChange,
}: {
  maxTokens: string;
  maxLoops: string;
  onMaxTokensChange: (value: string) => void;
  onMaxLoopsChange: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="max-tokens">Max Tokens</Label>
        <Input
          id="max-tokens"
          type="number"
          min={1000}
          step={1000}
          value={maxTokens}
          onChange={(event) => onMaxTokensChange(event.target.value)}
          placeholder="20000"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="max-loops">Max Loops</Label>
        <Input
          id="max-loops"
          type="number"
          min={1}
          value={maxLoops}
          onChange={(event) => onMaxLoopsChange(event.target.value)}
          placeholder="10"
        />
      </div>
    </div>
  );
}

function ModelOverrideSection({
  model,
  forceModelForSubagents,
  onModelChange,
  onForceModelForSubagentsChange,
}: {
  model: string;
  forceModelForSubagents: boolean;
  onModelChange: (value: string) => void;
  onForceModelForSubagentsChange: (value: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="model-override">Model Override</Label>
        <Input
          id="model-override"
          value={model}
          onChange={(event) => onModelChange(event.target.value)}
          placeholder="claude-sonnet-4-6"
        />
        <p className="text-xs text-muted-foreground">
          Overrides the agent profile&apos;s default model for this work item.
        </p>
      </div>
      {model.trim() && (
        <div className="flex items-center gap-2">
          <Checkbox
            id="force-model-subagents"
            checked={forceModelForSubagents}
            onCheckedChange={(checked) =>
              onForceModelForSubagentsChange(checked === true)
            }
          />
          <Label
            htmlFor="force-model-subagents"
            className="cursor-pointer font-normal"
          >
            Force model for all subagents
          </Label>
        </div>
      )}
    </div>
  );
}

export interface TaskConfigModalContentProps {
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
  onContextFileAdd: (filePath: string) => void;
  onContextFileRemove: (filePath: string) => void;
  onDocumentationUrlInputChange: (value: string) => void;
  onDocumentationUrlAdd: () => void;
  onDocumentationUrlRemove: (url: string) => void;
  onMaxTokensChange: (value: string) => void;
  onMaxLoopsChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onForceModelForSubagentsChange: (value: boolean) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

export function TaskConfigModalContent({
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
}: Readonly<TaskConfigModalContentProps>) {
  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[720px]">
      <DialogHeader>
        <DialogTitle>Task Configuration</DialogTitle>
        <DialogDescription>
          Configure execution parameters for {workItemTitle || "this ticket"}.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <AgentAndBranchSection
          agentProfileId={agentProfileId}
          baseBranch={baseBranch}
          agentProfiles={agentProfiles}
          branches={branches}
          onAgentProfileChange={onAgentProfileChange}
          onBaseBranchChange={onBaseBranchChange}
        />

        <div className="space-y-2">
          <Label htmlFor="target-branch">Target Branch</Label>
          <Input
            id="target-branch"
            value={targetBranch}
            onChange={(event) => onTargetBranchChange(event.target.value)}
            placeholder="feature/epic-21-task"
          />
          <p className="text-xs text-muted-foreground">
            This creates/uses a dedicated work branch for the ticket and must be
            different from the base branch.
          </p>
        </div>

        <ContextAttachmentsSection
          fileQuery={fileQuery}
          filteredFiles={filteredFiles}
          contextFiles={contextFiles}
          onFileQueryChange={onFileQueryChange}
          onContextFileAdd={onContextFileAdd}
          onContextFileRemove={onContextFileRemove}
        />

        <DocumentationSection
          documentationUrls={documentationUrls}
          documentationUrlInput={documentationUrlInput}
          onDocumentationUrlInputChange={onDocumentationUrlInputChange}
          onDocumentationUrlAdd={onDocumentationUrlAdd}
          onDocumentationUrlRemove={onDocumentationUrlRemove}
        />

        <LimitsSection
          maxTokens={maxTokens}
          maxLoops={maxLoops}
          onMaxTokensChange={onMaxTokensChange}
          onMaxLoopsChange={onMaxLoopsChange}
        />

        <ModelOverrideSection
          model={model}
          forceModelForSubagents={forceModelForSubagents}
          onModelChange={onModelChange}
          onForceModelForSubagentsChange={onForceModelForSubagentsChange}
        />

        {formError && <p className="text-sm text-destructive">{formError}</p>}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" onClick={onSubmit} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Configuration"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { WorkItemExecutionConfig } from "@/lib/api/work-items.types";

const TARGET_BRANCH_PATTERN = /^[A-Za-z0-9._/-]+$/;
const DEFAULT_TARGET_BRANCH = "feature/work-item";

type ConfigValidationResult =
  | { error: string; config?: never }
  | { error?: never; config: WorkItemExecutionConfig };

type NumericValidation =
  | { error: string; value?: never }
  | { error?: never; value: number | undefined };

interface TaskConfigInitialValues {
  agentProfileId: string;
  baseBranch: string;
  targetBranch: string;
  contextFiles: string[];
  documentationUrls: string[];
  maxTokens: string;
  maxLoops: string;
  model: string;
  forceModelForSubagents: boolean;
}

interface TaskConfigModalBehaviorHandlers {
  onContextFileAdd: (value: string) => void;
  onContextFileRemove: (value: string) => void;
  onDocumentationUrlAdd: () => void;
  onDocumentationUrlRemove: (value: string) => void;
  onAgentProfileChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => Promise<void>;
}

function toBranchSlug(value: string): string {
  const normalized = value.trim().toLowerCase();
  let slug = "";
  let lastWasDash = false;

  for (const character of normalized) {
    const isAlphaNumeric =
      (character >= "a" && character <= "z") ||
      (character >= "0" && character <= "9");

    if (isAlphaNumeric || character === "/") {
      slug += character;
      lastWasDash = false;
      continue;
    }

    if (!lastWasDash) {
      slug += "-";
      lastWasDash = true;
    }
  }

  while (slug.startsWith("-") || slug.startsWith("/")) {
    slug = slug.slice(1);
  }

  while (slug.endsWith("-") || slug.endsWith("/")) {
    slug = slug.slice(0, -1);
  }

  return slug;
}

export function getSuggestedTargetBranch(workItemTitle?: string): string {
  const slug = workItemTitle ? toBranchSlug(workItemTitle) : "";
  if (!slug) {
    return DEFAULT_TARGET_BRANCH;
  }

  return `feature/${slug}`;
}

export function resolveInitialBaseBranch(
  branches: string[],
  initialConfig?: WorkItemExecutionConfig | null,
): string {
  if (initialConfig?.baseBranch) {
    return initialConfig.baseBranch;
  }

  const mainBranch = branches.find((branch) => branch === "main");
  if (mainBranch) {
    return mainBranch;
  }

  return branches[0] || "main";
}

export function normalizeFileQuery(fileQuery: string): string {
  if (fileQuery.startsWith("@")) {
    return fileQuery.slice(1).toLowerCase();
  }

  return fileQuery.toLowerCase();
}

function validateBranchConfig(
  baseBranch: string,
  targetBranch: string,
): { error?: string; normalizedTargetBranch?: string } {
  if (!baseBranch) {
    return { error: "Base branch is required." };
  }

  if (!targetBranch) {
    return { error: "Target branch is required." };
  }

  const normalizedTargetBranch = targetBranch.trim();
  if (!TARGET_BRANCH_PATTERN.test(normalizedTargetBranch)) {
    return { error: "Target branch contains invalid characters." };
  }

  if (normalizedTargetBranch === baseBranch) {
    return {
      error:
        "Target branch must be different from base branch. A work item runs in its own branch.",
    };
  }

  return { normalizedTargetBranch };
}

function parseOptionalInteger(
  rawValue: string,
  minValue: number,
  errorMessage: string,
): NumericValidation {
  if (!rawValue) {
    return { value: undefined };
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < minValue) {
    return { error: errorMessage };
  }

  return { value: parsed };
}

export function buildValidatedConfig(params: {
  agentProfileId: string;
  baseBranch: string;
  targetBranch: string;
  contextFiles: string[];
  documentationUrls: string[];
  maxTokens: string;
  maxLoops: string;
  model: string;
  forceModelForSubagents: boolean;
}): ConfigValidationResult {
  const {
    agentProfileId,
    baseBranch,
    targetBranch,
    contextFiles,
    documentationUrls,
    maxTokens,
    maxLoops,
    model,
    forceModelForSubagents,
  } = params;

  const branchValidation = validateBranchConfig(baseBranch, targetBranch);
  if (branchValidation.error || !branchValidation.normalizedTargetBranch) {
    return { error: branchValidation.error || "Target branch is required." };
  }

  const maxTokensValidation = parseOptionalInteger(
    maxTokens,
    1000,
    "Max tokens must be an integer >= 1000.",
  );
  if (maxTokensValidation.error) {
    return { error: maxTokensValidation.error };
  }

  const maxLoopsValidation = parseOptionalInteger(
    maxLoops,
    1,
    "Max loops must be an integer >= 1.",
  );
  if (maxLoopsValidation.error) {
    return { error: maxLoopsValidation.error };
  }

  const trimmedModel = model.trim();
  return {
    config: {
      agentProfileId: agentProfileId || undefined,
      baseBranch,
      targetBranch: branchValidation.normalizedTargetBranch,
      contextFiles,
      documentationUrls,
      maxTokens: maxTokensValidation.value,
      maxLoops: maxLoopsValidation.value,
      ...(trimmedModel ? { model: trimmedModel } : {}),
      ...(trimmedModel && forceModelForSubagents
        ? { forceModelForSubagents: true }
        : {}),
    },
  };
}

function numberToInput(value: number | undefined): string {
  if (typeof value !== "number") {
    return "";
  }

  return String(value);
}

function maybeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]) : [];
}

export function buildInitialTaskConfigValues(params: {
  branches: string[];
  initialConfig?: WorkItemExecutionConfig | null;
  workItemTitle?: string;
}): TaskConfigInitialValues {
  const values: TaskConfigInitialValues = {
    agentProfileId: "",
    baseBranch: resolveInitialBaseBranch(params.branches, params.initialConfig),
    targetBranch: getSuggestedTargetBranch(params.workItemTitle),
    contextFiles: [],
    documentationUrls: [],
    maxTokens: "",
    maxLoops: "",
    model: "",
    forceModelForSubagents: false,
  };

  const config = params.initialConfig;
  if (!config) {
    return values;
  }

  if (typeof config.agentProfileId === "string") {
    values.agentProfileId = config.agentProfileId;
  }

  if (
    typeof config.targetBranch === "string" &&
    config.targetBranch.length > 0
  ) {
    values.targetBranch = config.targetBranch;
  }

  values.contextFiles = maybeStringArray(config.contextFiles);
  values.documentationUrls = maybeStringArray(config.documentationUrls);
  values.maxTokens = numberToInput(config.maxTokens);
  values.maxLoops = numberToInput(config.maxLoops);

  if (typeof config.model === "string") {
    values.model = config.model;
  }

  if (config.forceModelForSubagents === true) {
    values.forceModelForSubagents = true;
  }

  return values;
}

export function useTaskConfigInitialSync(params: {
  open: boolean;
  branches: string[];
  initialConfig?: WorkItemExecutionConfig | null;
  workItemTitle?: string;
  setAgentProfileId: Dispatch<SetStateAction<string>>;
  setBaseBranch: Dispatch<SetStateAction<string>>;
  setTargetBranch: Dispatch<SetStateAction<string>>;
  setContextFiles: Dispatch<SetStateAction<string[]>>;
  setDocumentationUrls: Dispatch<SetStateAction<string[]>>;
  setMaxTokens: Dispatch<SetStateAction<string>>;
  setMaxLoops: Dispatch<SetStateAction<string>>;
  setModel: Dispatch<SetStateAction<string>>;
  setForceModelForSubagents: Dispatch<SetStateAction<boolean>>;
  setFileQuery: Dispatch<SetStateAction<string>>;
  setDocumentationUrlInput: Dispatch<SetStateAction<string>>;
  setFormError: Dispatch<SetStateAction<string | null>>;
}): void {
  useEffect(() => {
    if (!params.open) {
      return;
    }

    const initialValues = buildInitialTaskConfigValues({
      branches: params.branches,
      initialConfig: params.initialConfig,
      workItemTitle: params.workItemTitle,
    });

    params.setAgentProfileId(initialValues.agentProfileId);
    params.setBaseBranch(initialValues.baseBranch);
    params.setTargetBranch(initialValues.targetBranch);
    params.setContextFiles(initialValues.contextFiles);
    params.setDocumentationUrls(initialValues.documentationUrls);
    params.setMaxTokens(initialValues.maxTokens);
    params.setMaxLoops(initialValues.maxLoops);
    params.setModel(initialValues.model);
    params.setForceModelForSubagents(initialValues.forceModelForSubagents);
    params.setFileQuery("");
    params.setDocumentationUrlInput("");
    params.setFormError(null);
  }, [
    params.open,
    params.branches,
    params.initialConfig,
    params.workItemTitle,
    params.setAgentProfileId,
    params.setBaseBranch,
    params.setTargetBranch,
    params.setContextFiles,
    params.setDocumentationUrls,
    params.setMaxTokens,
    params.setMaxLoops,
    params.setModel,
    params.setForceModelForSubagents,
    params.setFileQuery,
    params.setDocumentationUrlInput,
    params.setFormError,
  ]);
}

export function createAddContextFileHandler(params: {
  contextFiles: string[];
  setContextFiles: Dispatch<SetStateAction<string[]>>;
  setFileQuery: Dispatch<SetStateAction<string>>;
}): (filePath: string) => void {
  return (filePath: string) => {
    if (!params.contextFiles.includes(filePath)) {
      params.setContextFiles((current) => [...current, filePath]);
    }

    params.setFileQuery("");
  };
}

export function createRemoveContextFileHandler(
  setContextFiles: Dispatch<SetStateAction<string[]>>,
): (filePath: string) => void {
  return (filePath: string) => {
    setContextFiles((current) => current.filter((entry) => entry !== filePath));
  };
}

export function createAddDocumentationUrlHandler(params: {
  documentationUrlInput: string;
  documentationUrls: string[];
  setDocumentationUrls: Dispatch<SetStateAction<string[]>>;
  setDocumentationUrlInput: Dispatch<SetStateAction<string>>;
}): () => void {
  return () => {
    const next = params.documentationUrlInput.trim();
    if (!next || params.documentationUrls.includes(next)) {
      return;
    }

    params.setDocumentationUrls((current) => [...current, next]);
    params.setDocumentationUrlInput("");
  };
}

export function createRemoveDocumentationUrlHandler(
  setDocumentationUrls: Dispatch<SetStateAction<string[]>>,
): (url: string) => void {
  return (url: string) => {
    setDocumentationUrls((current) => current.filter((entry) => entry !== url));
  };
}

export function createAgentProfileChangeHandler(
  setAgentProfileId: Dispatch<SetStateAction<string>>,
): (value: string) => void {
  return (value: string) => {
    if (value === "__none__") {
      setAgentProfileId("");
      return;
    }

    setAgentProfileId(value);
  };
}

export function createCancelHandler(
  onOpenChange: (open: boolean) => void,
): () => void {
  return () => {
    onOpenChange(false);
  };
}

export function createSubmitHandler(params: {
  setFormError: Dispatch<SetStateAction<string | null>>;
  onSave: (config: WorkItemExecutionConfig) => Promise<void> | void;
  agentProfileId: string;
  baseBranch: string;
  targetBranch: string;
  contextFiles: string[];
  documentationUrls: string[];
  maxTokens: string;
  maxLoops: string;
  model: string;
  forceModelForSubagents: boolean;
}): () => Promise<void> {
  return async (): Promise<void> => {
    params.setFormError(null);

    const result = buildValidatedConfig({
      agentProfileId: params.agentProfileId,
      baseBranch: params.baseBranch,
      targetBranch: params.targetBranch,
      contextFiles: params.contextFiles,
      documentationUrls: params.documentationUrls,
      maxTokens: params.maxTokens,
      maxLoops: params.maxLoops,
      model: params.model,
      forceModelForSubagents: params.forceModelForSubagents,
    });
    if ("error" in result) {
      params.setFormError(result.error ?? "Invalid configuration.");
      return;
    }

    await params.onSave(result.config);
  };
}

export function createTaskConfigModalBehaviorHandlers(params: {
  contextFiles: string[];
  documentationUrlInput: string;
  documentationUrls: string[];
  setContextFiles: Dispatch<SetStateAction<string[]>>;
  setDocumentationUrls: Dispatch<SetStateAction<string[]>>;
  setFileQuery: Dispatch<SetStateAction<string>>;
  setDocumentationUrlInput: Dispatch<SetStateAction<string>>;
  setAgentProfileId: Dispatch<SetStateAction<string>>;
  onOpenChange: (open: boolean) => void;
  setFormError: Dispatch<SetStateAction<string | null>>;
  onSave: (config: WorkItemExecutionConfig) => Promise<void> | void;
  agentProfileId: string;
  baseBranch: string;
  targetBranch: string;
  maxTokens: string;
  maxLoops: string;
  model: string;
  forceModelForSubagents: boolean;
}): TaskConfigModalBehaviorHandlers {
  return {
    onContextFileAdd: createAddContextFileHandler({
      contextFiles: params.contextFiles,
      setContextFiles: params.setContextFiles,
      setFileQuery: params.setFileQuery,
    }),
    onContextFileRemove: createRemoveContextFileHandler(params.setContextFiles),
    onDocumentationUrlAdd: createAddDocumentationUrlHandler({
      documentationUrlInput: params.documentationUrlInput,
      documentationUrls: params.documentationUrls,
      setDocumentationUrls: params.setDocumentationUrls,
      setDocumentationUrlInput: params.setDocumentationUrlInput,
    }),
    onDocumentationUrlRemove: createRemoveDocumentationUrlHandler(
      params.setDocumentationUrls,
    ),
    onAgentProfileChange: createAgentProfileChangeHandler(
      params.setAgentProfileId,
    ),
    onCancel: createCancelHandler(params.onOpenChange),
    onSubmit: createSubmitHandler({
      setFormError: params.setFormError,
      onSave: params.onSave,
      agentProfileId: params.agentProfileId,
      baseBranch: params.baseBranch,
      targetBranch: params.targetBranch,
      contextFiles: params.contextFiles,
      documentationUrls: params.documentationUrls,
      maxTokens: params.maxTokens,
      maxLoops: params.maxLoops,
      model: params.model,
      forceModelForSubagents: params.forceModelForSubagents,
    }),
  };
}

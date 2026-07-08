import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { BranchSelector } from "./BranchSelector";
import { FileTree } from "./FileTree";
import { FileViewer } from "./FileViewer";
import { queryKeys } from "@/lib/queryKeys";
import { Card, CardContent } from "@/components/ui/card";

interface BranchesTabProps {
  readonly projectId: string;
}

interface BranchesFilePaneProps {
  isLoadingFiles: boolean;
  files: string[];
  selectedFilePath: string | null;
  onSelectFile: (path: string) => void;
}

function hasValue(value: string | null | undefined): boolean {
  return Boolean(value);
}

function isFileQueryEnabled(
  projectId: string,
  selectedBranch: string | null,
): boolean {
  return hasValue(projectId) && hasValue(selectedBranch);
}

function isFileContentQueryEnabled(params: {
  projectId: string;
  selectedBranch: string | null;
  selectedFilePath: string | null;
}): boolean {
  return (
    hasValue(params.projectId) &&
    hasValue(params.selectedBranch) &&
    hasValue(params.selectedFilePath)
  );
}

function readFileViewerContent(
  fileContent: { content?: string } | undefined,
): string | null {
  return fileContent?.content ?? null;
}

function readFileViewerErrorMessage(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }

  return error.message;
}

function resolveInitialBranch(
  branches: string[],
  selectedBranch: string | null,
): string | null {
  if (selectedBranch || branches.length === 0) {
    return null;
  }

  return branches[0];
}

function buildFileContentQueryFn(params: {
  projectId: string;
  selectedBranch: string | null;
  selectedFilePath: string | null;
}) {
  return () => {
    if (!params.selectedFilePath) {
      throw new Error("File path is required");
    }

    return api.getProjectRepositoryFileContent(
      params.projectId,
      params.selectedBranch || undefined,
      params.selectedFilePath,
    );
  };
}

function BranchesFilePane({
  isLoadingFiles,
  files,
  selectedFilePath,
  onSelectFile,
}: Readonly<BranchesFilePaneProps>) {
  if (isLoadingFiles) {
    return (
      <div className="w-64 flex-shrink-0">
        <div className="flex h-full items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </div>
    );
  }

  return (
    <div className="w-64 flex-shrink-0">
      <FileTree
        files={files}
        selectedPath={selectedFilePath}
        onSelectFile={onSelectFile}
      />
    </div>
  );
}

function renderBranchesGuardState(params: {
  isLoadingBranches: boolean;
  branchesError: unknown;
  branches: string[];
}) {
  if (params.isLoadingBranches) {
    return (
      <Card>
        <CardContent className="flex h-64 items-center justify-center">
          <div className="text-center">
            <div className="mb-2 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">Loading branches...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (params.branchesError) {
    const message =
      params.branchesError instanceof Error
        ? params.branchesError.message
        : "Unknown error";
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-destructive">Failed to load branches: {message}</p>
        </CardContent>
      </Card>
    );
  }

  if (params.branches.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground">
            No branches found for this project.
          </p>
        </CardContent>
      </Card>
    );
  }

  return null;
}

export function BranchesTab({ projectId }: BranchesTabProps) {
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const shouldLoadBranches = hasValue(projectId);

  const {
    data: branches = [],
    isLoading: isLoadingBranches,
    error: branchesError,
  } = useQuery({
    queryKey: queryKeys.projects.branches(projectId),
    queryFn: () => api.getProjectRepositoryBranches(projectId),
    enabled: shouldLoadBranches,
  });

  useEffect(() => {
    const initialBranch = resolveInitialBranch(branches, selectedBranch);
    if (initialBranch) {
      setSelectedBranch(initialBranch);
    }
  }, [branches, selectedBranch]);

  const selectedBranchOrEmpty = selectedBranch || "";
  const selectedFilePathOrEmpty = selectedFilePath || "";
  const shouldLoadFiles = isFileQueryEnabled(projectId, selectedBranch);
  const shouldLoadFileContent = isFileContentQueryEnabled({
    projectId,
    selectedBranch,
    selectedFilePath,
  });

  const { data: files = [], isLoading: isLoadingFiles } = useQuery({
    queryKey: queryKeys.projects.files(projectId, selectedBranchOrEmpty),
    queryFn: () => api.getProjectRepositoryFiles(projectId),
    enabled: shouldLoadFiles,
  });

  const {
    data: fileContent,
    isLoading: isLoadingFileContent,
    error: fileContentError,
  } = useQuery({
    queryKey: queryKeys.projects.fileContent(
      projectId,
      selectedBranchOrEmpty,
      selectedFilePathOrEmpty,
    ),
    queryFn: buildFileContentQueryFn({
      projectId,
      selectedBranch,
      selectedFilePath,
    }),
    enabled: shouldLoadFileContent,
  });

  const handleSelectFile = (path: string) => {
    setSelectedFilePath(path);
  };

  const handleSelectBranch = (branch: string) => {
    setSelectedBranch(branch);
    setSelectedFilePath(null);
  };

  const guardState = renderBranchesGuardState({
    isLoadingBranches,
    branchesError,
    branches,
  });
  if (guardState) {
    return guardState;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <BranchSelector
          branches={branches}
          selectedBranch={selectedBranch}
          onSelectBranch={handleSelectBranch}
          isLoading={isLoadingBranches}
        />
      </div>

      <div className="flex h-[600px] gap-4 rounded-lg border">
        <BranchesFilePane
          isLoadingFiles={isLoadingFiles}
          files={files}
          selectedFilePath={selectedFilePath}
          onSelectFile={handleSelectFile}
        />
        <div className="flex-1 min-w-0">
          <FileViewer
            content={readFileViewerContent(fileContent)}
            filePath={selectedFilePath}
            isLoading={isLoadingFileContent}
            error={readFileViewerErrorMessage(fileContentError)}
          />
        </div>
      </div>
    </div>
  );
}

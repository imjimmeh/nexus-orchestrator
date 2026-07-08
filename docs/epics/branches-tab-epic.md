# Branches Tab Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove Dispatch and Specs tabs, add Branches tab with file browser and Monaco Editor for viewing repository files.

**Architecture:** Split-pane layout with branch selector, file tree sidebar, and Monaco Editor. Backend adds file content endpoint using git show. Frontend uses React Query for state management.

**Tech Stack:** React, TypeScript, Monaco Editor (@monaco-editor/react), React Query (TanStack Query), Tailwind CSS, Shadcn/ui components, NestJS backend

**Design Reference:** `docs/plans/2025-04-05-branches-tab-design.md`

---

## Phase 1: Backend API - File Content Endpoint

### Task 1: Add File Content Types and DTO

**Files:**
- Create: `apps/api/src/project/dto/file-content.dto.ts`
- Modify: `apps/api/src/project/project-git-metadata.service.ts` (add method)

**Step 1: Create DTO file**

```typescript
// apps/api/src/project/dto/file-content.dto.ts
export interface FileContentDto {
  content: string;
  path: string;
  branch: string;
  size: number;
  lastCommit?: {
    hash: string;
    message: string;
    author: string;
    date: string;
  };
}

export interface GetFileContentQueryDto {
  path: string;
  branch?: string;
}
```

**Step 2: Add getFileContent method to service**

Modify `apps/api/src/project/project-git-metadata.service.ts` - add after line 110:

```typescript
async getFileContent(
  projectId: string,
  filePath: string,
  branch?: string,
): Promise<FileContentDto> {
  const project = await this.requireProject(projectId);
  const repoPath = await this.resolveGitRepoPath(project.basePath);

  if (!repoPath) {
    throw new BadRequestException('Project repository not found');
  }

  // Sanitize path to prevent directory traversal
  const sanitizedPath = filePath.replace(/\.\./g, '').replace(/^\//, '');
  if (!sanitizedPath) {
    throw new BadRequestException('Invalid file path');
  }

  const targetRef = branch || 'HEAD';

  try {
    // Check if it's a binary file first
    const mimeTypeResult = await this.runGitLines(repoPath, [
      'show',
      `${targetRef}:${sanitizedPath}`,
      '|',
      'file',
      '--mime-type',
      '-',
    ]).catch(() => ['text/plain']);

    const isBinary = mimeTypeResult[0]?.includes('binary') || false;

    if (isBinary) {
      // Get file size for binary files
      const sizeResult = await this.runGitLines(repoPath, [
        'cat-file',
        '-s',
        `${targetRef}:${sanitizedPath}`,
      ]);
      const size = parseInt(sizeResult[0] || '0', 10);

      return {
        content: '[Binary file]',
        path: sanitizedPath,
        branch: targetRef,
        size,
      };
    }

    // Get file content
    const { stdout } = await execFileAsync('git', [
      '-C',
      repoPath,
      'show',
      `${targetRef}:${sanitizedPath}`,
    ]);

    // Get last commit info for this file
    const commitInfo = await this.runGitLines(repoPath, [
      'log',
      '-1',
      '--format=%H|%s|%an|%aI',
      targetRef,
      '--',
      sanitizedPath,
    ]).catch(() => []);

    let lastCommit: FileContentDto['lastCommit'] | undefined;
    if (commitInfo.length > 0) {
      const [hash, message, author, date] = commitInfo[0].split('|');
      lastCommit = { hash, message, author, date };
    }

    return {
      content: stdout,
      path: sanitizedPath,
      branch: targetRef,
      size: Buffer.byteLength(stdout, 'utf8'),
      lastCommit,
    };
  } catch (error) {
    if ((error as Error).message.includes('does not exist')) {
      throw new BadRequestException('File not found');
    }
    this.logger.error(
      `Failed to get file content: ${(error as Error).message}`,
    );
    throw new InternalServerErrorException('Failed to read file content');
  }
}
```

**Step 3: Import DTO in service**

Add import at top of `apps/api/src/project/project-git-metadata.service.ts`:

```typescript
import { FileContentDto } from './dto/file-content.dto';
```

**Step 4: Commit**

```bash
git add apps/api/src/project/dto/file-content.dto.ts
git add apps/api/src/project/project-git-metadata.service.ts
git commit -m "feat(api): add getFileContent method to ProjectGitMetadataService"
```

---

### Task 2: Add API Endpoint

**Files:**
- Modify: `apps/api/src/project/project.controller.ts`

**Step 1: Add endpoint method**

Add import at top:

```typescript
import { Query } from '@nestjs/common';
```

Add after line 114 in controller:

```typescript
@Get(':id/repository/files/content')
@Roles('Admin', 'Developer')
@ApiOperation({ summary: 'Get file content from repository' })
@ApiResponse({ status: 200, description: 'File content retrieved' })
@ApiResponse({ status: 400, description: 'Invalid path or file not found' })
async getFileContent(
  @Param('id') id: string,
  @Query('path') filePath: string,
  @Query('branch') branch?: string,
) {
  if (!filePath) {
    throw new BadRequestException('File path is required');
  }

  const content = await this.projectGitMetadataService.getFileContent(
    id,
    filePath,
    branch,
  );
  return { success: true, data: content };
}
```

**Step 2: Commit**

```bash
git add apps/api/src/project/project.controller.ts
git commit -m "feat(api): add GET endpoint for file content"
```

---

### Task 3: Add API Client Method

**Files:**
- Modify: `apps/api/src/lib/api/types.ts` (add FileContent type)
- Modify: `apps/api/src/lib/api/client.projects.ts` (add method)

**Step 1: Add type to types.ts**

Add at end of types.ts (before exports):

```typescript
export interface FileContent {
  content: string;
  path: string;
  branch: string;
  size: number;
  lastCommit?: {
    hash: string;
    message: string;
    author: string;
    date: string;
  };
}
```

**Step 2: Add method to client.projects.ts**

Add to `ApiClientProjectMethods` interface (around line 100):

```typescript
getProjectRepositoryFileContent(
  this: ApiClient,
  projectId: string,
  branch: string | undefined,
  path: string,
): Promise<FileContent>;
```

Add to `projectApiMethods` object (around line 310):

```typescript
async getProjectRepositoryFileContent(projectId, branch, path) {
  const params = new URLSearchParams();
  params.append('path', path);
  if (branch) {
    params.append('branch', branch);
  }
  return this.get<FileContent>(
    `/projects/${projectId}/repository/files/content?${params.toString()}`,
  );
},
```

**Step 3: Commit**

```bash
git add apps/api/src/lib/api/types.ts
git add apps/api/src/lib/api/client.projects.ts
git commit -m "feat(api): add API client method for file content"
```

---

## Phase 2: Frontend - Remove Dispatch and Specs Tabs

### Task 4: Update ProjectWorkspace Component

**Files:**
- Modify: `apps/web/src/pages/project-workspace/ProjectWorkspace.tsx`

**Step 1: Remove imports**

Remove lines 6 and 9:

```typescript
import { SpecsTab } from "./SpecsTab";
import { DispatchTab } from "./DispatchTab";
```

**Step 2: Update WorkspaceTab type**

Change lines 12-18 from:

```typescript
type WorkspaceTab =
  | "board"
  | "dispatch"
  | "orchestration"
  | "specs"
  | "sessions"
  | "settings";
```

To:

```typescript
type WorkspaceTab =
  | "board"
  | "orchestration"
  | "sessions"
  | "settings";
```

**Step 3: Update VALID_TABS**

Change lines 20-28 from:

```typescript
const VALID_TABS = new Set<WorkspaceTab>([
  "board",
  "dispatch",
  "orchestration",
  "specs",
  "sessions",
  "settings",
]);
```

To:

```typescript
const VALID_TABS = new Set<WorkspaceTab>([
  "board",
  "orchestration",
  "sessions",
  "settings",
]);
```

**Step 4: Remove tab triggers**

Remove lines 109-110:

```typescript
<TabsTrigger value="dispatch">Dispatch</TabsTrigger>
```

And line 111:

```typescript
<TabsTrigger value="specs">Specs</TabsTrigger>
```

**Step 5: Remove tab content**

Remove lines 120-122:

```typescript
<TabsContent value="dispatch">
  <DispatchTab projectId={projectId} />
</TabsContent>
```

And lines 128-130:

```typescript
<TabsContent value="specs">
  <SpecsTab projectId={projectId} />
</TabsContent>
```

**Step 6: Commit**

```bash
git add apps/web/src/pages/project-workspace/ProjectWorkspace.tsx
git commit -m "refactor(web): remove Dispatch and Specs tabs from project workspace"
```

---

## Phase 3: Frontend - Create Branches Tab Components

### Task 5: Create File Tree Component

**Files:**
- Create: `apps/web/src/pages/project-workspace/FileTree.tsx`
- Create: `apps/web/src/pages/project-workspace/FileTree.spec.tsx`

**Step 1: Write failing test**

```typescript
// apps/web/src/pages/project-workspace/FileTree.spec.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileTree } from "./FileTree";

describe("FileTree", () => {
  const mockFiles = [
    "src/components/Button.tsx",
    "src/components/Input.tsx",
    "src/utils/helpers.ts",
    "package.json",
    "README.md",
  ];

  it("renders file tree structure", () => {
    render(
      <FileTree
        files={mockFiles}
        selectedPath={null}
        onSelectFile={vi.fn()}
      />,
    );

    expect(screen.getByText("src")).toBeInTheDocument();
    expect(screen.getByText("package.json")).toBeInTheDocument();
  });

  it("expands folders when clicked", () => {
    render(
      <FileTree
        files={mockFiles}
        selectedPath={null}
        onSelectFile={vi.fn()}
      />,
    );

    const srcFolder = screen.getByText("src");
    fireEvent.click(srcFolder);

    expect(screen.getByText("components")).toBeInTheDocument();
    expect(screen.getByText("utils")).toBeInTheDocument();
  });

  it("calls onSelectFile when file is clicked", () => {
    const onSelectFile = vi.fn();
    render(
      <FileTree
        files={mockFiles}
        selectedPath={null}
        onSelectFile={onSelectFile}
      />,
    );

    const packageJson = screen.getByText("package.json");
    fireEvent.click(packageJson);

    expect(onSelectFile).toHaveBeenCalledWith("package.json");
  });
});
```

Run test to verify it fails:

```bash
cd apps/web && npm run test:unit -- FileTree.spec.tsx
```

Expected: FAIL - "FileTree" not found

**Step 2: Implement FileTree component**

```typescript
// apps/web/src/pages/project-workspace/FileTree.tsx
import { useState, useMemo } from "react";
import { ChevronRight, ChevronDown, Folder, FolderOpen, File } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileTreeProps {
  readonly files: string[];
  readonly selectedPath: string | null;
  readonly onSelectFile: (path: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children: TreeNode[];
}

function buildFileTree(files: string[]): TreeNode {
  const root: TreeNode = {
    name: "",
    path: "",
    type: "directory",
    children: [],
  };

  files.forEach((filePath) => {
    const parts = filePath.split("/");
    let current = root;

    parts.forEach((part, index) => {
      const isLast = index === parts.length - 1;
      const currentPath = parts.slice(0, index + 1).join("/");

      const existing = current.children.find((child) => child.name === part);
      if (existing) {
        current = existing;
      } else {
        const newNode: TreeNode = {
          name: part,
          path: currentPath,
          type: isLast ? "file" : "directory",
          children: [],
        };
        current.children.push(newNode);
        current = newNode;
      }
    });
  });

  // Sort: directories first, then alphabetically
  const sortNodes = (node: TreeNode): void => {
    node.children.sort((a, b) => {
      if (a.type === b.type) {
        return a.name.localeCompare(b.name);
      }
      return a.type === "directory" ? -1 : 1;
    });
    node.children.forEach(sortNodes);
  };
  sortNodes(root);

  return root;
}

function TreeNodeItem({
  node,
  selectedPath,
  onSelectFile,
  depth = 0,
}: {
  node: TreeNode;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  depth?: number;
}) {
  const [isExpanded, setIsExpanded] = useState(depth < 2);
  const isSelected = node.path === selectedPath;

  if (node.type === "file") {
    return (
      <div
        className={cn(
          "flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent",
          isSelected && "bg-accent",
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => onSelectFile(node.path)}
      >
        <File className="h-4 w-4 text-muted-foreground" />
        <span className="truncate">{node.name}</span>
      </div>
    );
  }

  return (
    <div>
      <div
        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
        {isExpanded ? (
          <FolderOpen className="h-4 w-4 text-blue-500" />
        ) : (
          <Folder className="h-4 w-4 text-blue-500" />
        )}
        <span className="truncate font-medium">{node.name || "Repository"}</span>
      </div>
      {isExpanded && (
        <div>
          {node.children.map((child) => (
            <TreeNodeItem
              key={child.path}
              node={child}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree({ files, selectedPath, onSelectFile }: FileTreeProps) {
  const tree = useMemo(() => buildFileTree(files), [files]);

  return (
    <div className="h-full overflow-auto border-r p-2">
      <TreeNodeItem
        node={tree}
        selectedPath={selectedPath}
        onSelectFile={onSelectFile}
      />
    </div>
  );
}
```

**Step 3: Run tests**

```bash
cd apps/web && npm run test:unit -- FileTree.spec.tsx
```

Expected: PASS

**Step 4: Commit**

```bash
git add apps/web/src/pages/project-workspace/FileTree.tsx
git add apps/web/src/pages/project-workspace/FileTree.spec.tsx
git commit -m "feat(web): add FileTree component for branch file browsing"
```

---

### Task 6: Create File Viewer Component

**Files:**
- Create: `apps/web/src/pages/project-workspace/FileViewer.tsx`
- Create: `apps/web/src/pages/project-workspace/FileViewer.spec.tsx`

**Step 1: Write failing test**

```typescript
// apps/web/src/pages/project-workspace/FileViewer.spec.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FileViewer } from "./FileViewer";

describe("FileViewer", () => {
  it("shows loading state", () => {
    render(
      <FileViewer
        content={null}
        filePath="test.ts"
        isLoading={true}
        error={null}
      />,
    );

    expect(screen.getByText("Loading file...")).toBeInTheDocument();
  });

  it("shows empty state when no file selected", () => {
    render(
      <FileViewer
        content={null}
        filePath={null}
        isLoading={false}
        error={null}
      />,
    );

    expect(screen.getByText("Select a file to view")).toBeInTheDocument();
  });

  it("shows error state", () => {
    render(
      <FileViewer
        content={null}
        filePath="test.ts"
        isLoading={false}
        error="Failed to load file"
      />,
    );

    expect(screen.getByText("Failed to load file")).toBeInTheDocument();
  });
});
```

Run test to verify it fails:

```bash
cd apps/web && npm run test:unit -- FileViewer.spec.tsx
```

Expected: FAIL

**Step 2: Implement FileViewer component**

```typescript
// apps/web/src/pages/project-workspace/FileViewer.tsx
import Editor from "@monaco-editor/react";
import { AlertCircle, FileText } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface FileViewerProps {
  readonly content: string | null;
  readonly filePath: string | null;
  readonly isLoading: boolean;
  readonly error: string | null;
}

function getLanguageFromPath(filePath: string): string {
  const extension = filePath.split(".").pop()?.toLowerCase() || "";

  const languageMap: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    md: "markdown",
    yaml: "yaml",
    yml: "yaml",
    py: "python",
    go: "go",
    rs: "rust",
    java: "java",
    css: "css",
    scss: "scss",
    html: "html",
    sql: "sql",
    sh: "shell",
    dockerfile: "dockerfile",
  };

  return languageMap[extension] || "plaintext";
}

export function FileViewer({
  content,
  filePath,
  isLoading,
  error,
}: FileViewerProps) {
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="mb-2 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading file...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!filePath || content === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
        <FileText className="mb-2 h-12 w-12" />
        <p>Select a file to view</p>
      </div>
    );
  }

  const language = getLanguageFromPath(filePath);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b bg-muted px-4 py-2 text-sm font-medium">
        {filePath}
      </div>
      <div className="flex-1">
        <Editor
          height="100%"
          language={language}
          value={content}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 14,
            lineNumbers: "on",
            renderWhitespace: "selection",
            automaticLayout: true,
          }}
          theme="vs-dark"
          loading={
            <div className="flex h-full items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          }
        />
      </div>
    </div>
  );
}
```

**Step 3: Run tests**

```bash
cd apps/web && npm run test:unit -- FileViewer.spec.tsx
```

Expected: PASS

**Step 4: Commit**

```bash
git add apps/web/src/pages/project-workspace/FileViewer.tsx
git add apps/web/src/pages/project-workspace/FileViewer.spec.tsx
git commit -m "feat(web): add FileViewer component with Monaco Editor"
```

---

### Task 7: Create Branch Selector Component

**Files:**
- Create: `apps/web/src/pages/project-workspace/BranchSelector.tsx`

**Step 1: Implement BranchSelector**

```typescript
// apps/web/src/pages/project-workspace/BranchSelector.tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GitBranch } from "lucide-react";

interface BranchSelectorProps {
  readonly branches: string[];
  readonly selectedBranch: string | null;
  readonly onSelectBranch: (branch: string) => void;
  readonly isLoading: boolean;
}

export function BranchSelector({
  branches,
  selectedBranch,
  onSelectBranch,
  isLoading,
}: BranchSelectorProps) {
  return (
    <div className="flex items-center gap-2">
      <GitBranch className="h-4 w-4 text-muted-foreground" />
      <Select
        value={selectedBranch || ""}
        onValueChange={onSelectBranch}
        disabled={isLoading}
      >
        <SelectTrigger className="w-[200px]">
          <SelectValue placeholder={isLoading ? "Loading..." : "Select branch"} />
        </SelectTrigger>
        <SelectContent>
          {branches.map((branch) => (
            <SelectItem key={branch} value={branch}>
              {branch}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add apps/web/src/pages/project-workspace/BranchSelector.tsx
git commit -m "feat(web): add BranchSelector component"
```

---

### Task 8: Create Main BranchesTab Component

**Files:**
- Create: `apps/web/src/pages/project-workspace/BranchesTab.tsx`
- Create: `apps/web/src/pages/project-workspace/BranchesTab.spec.tsx`

**Step 1: Write failing test**

```typescript
// apps/web/src/pages/project-workspace/BranchesTab.spec.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BranchesTab } from "./BranchesTab";

const mockApi = {
  getProjectRepositoryBranches: vi.fn(),
  getProjectRepositoryFiles: vi.fn(),
  getProjectRepositoryFileContent: vi.fn(),
};

vi.mock("@/lib/api/client", () => ({
  api: mockApi,
}));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
});

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}

describe("BranchesTab", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.resetAllMocks();
  });

  it("renders loading state initially", () => {
    mockApi.getProjectRepositoryBranches.mockResolvedValue([]);
    mockApi.getProjectRepositoryFiles.mockResolvedValue([]);

    render(
      <Wrapper>
        <BranchesTab projectId="test-project" />
      </Wrapper>,
    );

    expect(screen.getByText("Loading branches...")).toBeInTheDocument();
  });

  it("displays branches when loaded", async () => {
    mockApi.getProjectRepositoryBranches.mockResolvedValue(["main", "develop"]);
    mockApi.getProjectRepositoryFiles.mockResolvedValue([]);

    render(
      <Wrapper>
        <BranchesTab projectId="test-project" />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("main")).toBeInTheDocument();
    });
  });
});
```

Run test to verify it fails:

```bash
cd apps/web && npm run test:unit -- BranchesTab.spec.tsx
```

Expected: FAIL

**Step 2: Implement BranchesTab component**

```typescript
// apps/web/src/pages/project-workspace/BranchesTab.tsx
import { useState } from "react";
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

export function BranchesTab({ projectId }: BranchesTabProps) {
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);

  const {
    data: branches = [],
    isLoading: isLoadingBranches,
    error: branchesError,
  } = useQuery({
    queryKey: queryKeys.projects.branches(projectId),
    queryFn: () => api.getProjectRepositoryBranches(projectId),
    enabled: !!projectId,
  });

  // Auto-select first branch when loaded
  if (branches.length > 0 && !selectedBranch) {
    setSelectedBranch(branches[0]);
  }

  const {
    data: files = [],
    isLoading: isLoadingFiles,
  } = useQuery({
    queryKey: queryKeys.projects.files(projectId, selectedBranch || ""),
    queryFn: () => api.getProjectRepositoryFiles(projectId),
    enabled: !!projectId && !!selectedBranch,
  });

  const {
    data: fileContent,
    isLoading: isLoadingFileContent,
    error: fileContentError,
  } = useQuery({
    queryKey: queryKeys.projects.fileContent(projectId, selectedBranch || "", selectedFilePath || ""),
    queryFn: () =>
      api.getProjectRepositoryFileContent(
        projectId,
        selectedBranch || undefined,
        selectedFilePath!,
      ),
    enabled: !!projectId && !!selectedBranch && !!selectedFilePath,
  });

  const handleSelectFile = (path: string) => {
    setSelectedFilePath(path);
  };

  const handleSelectBranch = (branch: string) => {
    setSelectedBranch(branch);
    setSelectedFilePath(null);
  };

  if (isLoadingBranches) {
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

  if (branchesError) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-destructive">
            Failed to load branches: {branchesError.message}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (branches.length === 0) {
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
        <div className="w-64 flex-shrink-0">
          {isLoadingFiles ? (
            <div className="flex h-full items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : (
            <FileTree
              files={files}
              selectedPath={selectedFilePath}
              onSelectFile={handleSelectFile}
            />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <FileViewer
            content={fileContent?.content || null}
            filePath={selectedFilePath}
            isLoading={isLoadingFileContent}
            error={fileContentError?.message || null}
          />
        </div>
      </div>
    </div>
  );
}
```

**Step 3: Add query keys**

Modify `apps/web/src/lib/queryKeys.ts` - add to projects object:

```typescript
branches: (projectId: string) => ["project-branches", projectId],
files: (projectId: string, branch: string) => ["project-files", projectId, branch],
fileContent: (projectId: string, branch: string, path: string) =>
  ["project-file-content", projectId, branch, path],
```

**Step 4: Run tests**

```bash
cd apps/web && npm run test:unit -- BranchesTab.spec.tsx
```

Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/pages/project-workspace/BranchesTab.tsx
git add apps/web/src/pages/project-workspace/BranchesTab.spec.tsx
git add apps/web/src/lib/queryKeys.ts
git commit -m "feat(web): add BranchesTab component with file browsing"
```

---

## Phase 4: Integration

### Task 9: Add Branches Tab to Project Workspace

**Files:**
- Modify: `apps/web/src/pages/project-workspace/ProjectWorkspace.tsx`

**Step 1: Add import**

Add import after line 10:

```typescript
import { BranchesTab } from "./BranchesTab";
```

**Step 2: Update WorkspaceTab type**

Change lines 12-16 from:

```typescript
type WorkspaceTab =
  | "board"
  | "orchestration"
  | "sessions"
  | "settings";
```

To:

```typescript
type WorkspaceTab =
  | "board"
  | "orchestration"
  | "branches"
  | "sessions"
  | "settings";
```

**Step 3: Update VALID_TABS**

Change lines 20-25 from:

```typescript
const VALID_TABS = new Set<WorkspaceTab>([
  "board",
  "orchestration",
  "sessions",
  "settings",
]);
```

To:

```typescript
const VALID_TABS = new Set<WorkspaceTab>([
  "board",
  "orchestration",
  "branches",
  "sessions",
  "settings",
]);
```

**Step 4: Add tab trigger**

Add after line 109:

```typescript
<TabsTrigger value="branches">Branches</TabsTrigger>
```

**Step 5: Add tab content**

Add after line 125:

```typescript
<TabsContent value="branches">
  <BranchesTab projectId={projectId} />
</TabsContent>
```

**Step 6: Run typecheck**

```bash
cd apps/web && npm run typecheck
```

Expected: No errors

**Step 7: Commit**

```bash
git add apps/web/src/pages/project-workspace/ProjectWorkspace.tsx
git commit -m "feat(web): integrate BranchesTab into project workspace"
```

---

## Phase 5: Cleanup

### Task 10: Remove Old Tab Components

**Files:**
- Delete: `apps/web/src/pages/project-workspace/DispatchTab.tsx`
- Delete: `apps/web/src/pages/project-workspace/DispatchTab.spec.tsx`
- Delete: `apps/web/src/pages/project-workspace/SpecsTab.tsx`

**Step 1: Delete old files**

```bash
git rm apps/web/src/pages/project-workspace/DispatchTab.tsx
git rm apps/web/src/pages/project-workspace/DispatchTab.spec.tsx
git rm apps/web/src/pages/project-workspace/SpecsTab.tsx
git rm -r apps/web/src/components/orchestration/SpecsApprovalActions.tsx
```

**Step 2: Check for orphaned imports**

```bash
grep -r "SpecsApprovalActions\|DispatchTab\|SpecsTab" apps/web/src --include="*.tsx" --include="*.ts" | grep -v "node_modules"
```

Expected: No results (or only in deleted files)

**Step 3: Commit**

```bash
git commit -m "chore(web): remove deprecated Dispatch and Specs tab components"
```

---

## Phase 6: Verification

### Task 11: Run All Tests

**Step 1: Run backend tests**

```bash
cd apps/api && npm run test:unit
```

Expected: All pass

**Step 2: Run frontend tests**

```bash
cd apps/web && npm run test:unit
```

Expected: All pass

**Step 3: Run type checking**

```bash
cd apps/api && npm run typecheck
cd apps/web && npm run typecheck
```

Expected: No errors

**Step 4: Run linting**

```bash
cd apps/api && npm run lint
cd apps/web && npm run lint
```

Expected: No errors

**Step 5: Final commit**

```bash
git commit -m "test: verify all tests pass for BranchesTab feature"
```

---

## Summary

This plan implements:

1. **Backend**: New endpoint for reading file content from specific branches
2. **Frontend**: File tree browser with Monaco Editor for syntax-highlighted viewing
3. **Integration**: Replaces Dispatch and Specs tabs with new Branches tab
4. **Cleanup**: Removes all deprecated components

The implementation follows TDD principles, adds comprehensive tests, and maintains the existing codebase patterns.

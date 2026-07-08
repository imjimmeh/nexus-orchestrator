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

import type {
  CommitPathsResult,
  FileListResponse,
  FileReadResponse,
} from "./client.workflow-files.types";

const KANBAN_BASE = "/kanban-api";

export const workflowFilesClient = {
  async list(projectId: string): Promise<FileListResponse> {
    const res = await fetch(
      `${KANBAN_BASE}/projects/${encodeURIComponent(projectId)}/workflow-files`,
    );
    return res.json();
  },

  async read(projectId: string, filename: string): Promise<FileReadResponse> {
    const res = await fetch(
      `${KANBAN_BASE}/projects/${encodeURIComponent(projectId)}/workflow-files/${encodeURIComponent(filename)}/content`,
    );
    return res.json();
  },

  async write(
    projectId: string,
    filename: string,
    content: string,
    message?: string,
  ): Promise<CommitPathsResult> {
    const res = await fetch(
      `${KANBAN_BASE}/projects/${encodeURIComponent(projectId)}/workflow-files/${encodeURIComponent(filename)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, message }),
      },
    );
    return res.json();
  },

  async remove(
    projectId: string,
    filename: string,
    message?: string,
  ): Promise<CommitPathsResult> {
    const params = message ? `?message=${encodeURIComponent(message)}` : "";
    const res = await fetch(
      `${KANBAN_BASE}/projects/${encodeURIComponent(projectId)}/workflow-files/${encodeURIComponent(filename)}${params}`,
      { method: "DELETE" },
    );
    return res.json();
  },
};

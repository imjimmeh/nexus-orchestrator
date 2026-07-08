export interface ProjectAgentsDocument {
  projectId: string;
  path: string;
  exists: boolean;
  content: string;
  etag: string | null;
  updatedAt: string | null;
}

export interface UpdateProjectAgentsDocumentInput {
  content?: unknown;
  expected_etag?: string | null;
}

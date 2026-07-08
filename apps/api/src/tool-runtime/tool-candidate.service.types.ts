import type { IToolArtifact } from '@nexus/core';

export interface CreateToolCandidateDraftPayload {
  tool_name: string;
  language: IToolArtifact['language'];
  source_code: string;
  schema: Record<string, unknown>;
  test_spec?: string | null;
}

export interface ToolCandidateListFilters {
  limit: number;
  offset: number;
  status?: IToolArtifact['status'];
  tool_name?: string;
}

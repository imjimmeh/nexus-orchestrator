export interface KanbanMcpManifestToolEntry {
  readonly name: string;
}

export interface KanbanMcpManifestValidationResult {
  readonly missingProviders: string[];
  readonly missingManifestEntries: string[];
}

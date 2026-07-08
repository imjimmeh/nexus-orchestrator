export interface ImportedRepositoryFindingPublishOutcome {
  sourceId: string;
  action: "created" | "updated" | "unchanged" | "error";
  findingId?: string;
  error?: string;
}

export interface ImportedRepositoryFindingPublishResult {
  counts: {
    created: number;
    updated: number;
    unchanged: number;
    errors: number;
  };
  outcomes: ImportedRepositoryFindingPublishOutcome[];
}

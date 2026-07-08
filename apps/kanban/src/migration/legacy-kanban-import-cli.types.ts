export type LegacyKanbanImportMode = "dry-run" | "import" | "reconcile";

export type LegacyKanbanImportCliOptions = {
  mode: LegacyKanbanImportMode;
  apiDatabaseUrl?: string;
  kanbanDatabaseUrl?: string;
};

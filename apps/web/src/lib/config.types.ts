export type RuntimeServiceTarget = "core" | "kanban" | "chat";

export interface RuntimeConfig {
  apiUrl?: string;
  coreApiUrl?: string;
  kanbanApiUrl?: string;
  chatApiUrl?: string;
}

export interface ResolvedRuntimeConfig {
  apiUrl: string;
  coreApiUrl: string;
  kanbanApiUrl: string;
  chatApiUrl: string;
}

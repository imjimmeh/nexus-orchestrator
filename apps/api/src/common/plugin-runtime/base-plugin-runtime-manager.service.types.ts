export interface PluginServerRecord {
  id: string;
  name: string;
}

export interface PluginReloadSummary<TServerResult> {
  started_at: Date;
  completed_at: Date;
  total_servers: number;
  succeeded_servers: number;
  failed_servers: number;
  results: TServerResult[];
}

export interface PluginRegistryItemRecord {
  id: string;
  name: string;
}

export interface PluginRegistryRepository {
  findByNamePrefix(prefix: string): Promise<PluginRegistryItemRecord[]>;
}

export interface PluginRegistryService {
  deleteTool(id: string): Promise<unknown>;
}

export interface PluginTestResultParams<TServer, TDiscoveredItem> {
  server: TServer;
  ok: boolean;
  latencyMs: number;
  discoveredItems: TDiscoveredItem[];
  error?: string;
}

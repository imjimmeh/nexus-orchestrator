export interface SecretUsageReference {
  type: 'llm_provider' | 'mcp_server' | 'acp_server';
  id: string;
  name: string;
  field: string;
}

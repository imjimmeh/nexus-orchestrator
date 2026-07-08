export interface ModelUsageBreakdownRow {
  model_id: string | null;
  provider_name: string | null;
  model_name: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_cents: number;
}

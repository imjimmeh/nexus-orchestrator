export interface ActiveModelRate {
  modelId: string;
  providerName: string | null;
  modelName: string;
  inputTokenCentsPerMillion: number | null;
  outputTokenCentsPerMillion: number | null;
}

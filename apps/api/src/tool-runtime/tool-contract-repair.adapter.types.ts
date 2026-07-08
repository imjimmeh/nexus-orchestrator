export interface RepairEntry {
  field: string;
  originalType: string;
}

export interface ToolRepairResult {
  payload: Record<string, unknown>;
  repairs: RepairEntry[];
}

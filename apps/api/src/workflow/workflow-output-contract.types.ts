export interface OutputContractTypeMismatch {
  field: string;
  expected: string;
  actual: string;
}

export interface OutputContractTypeMismatchResult {
  field: string;
  expected: string;
  actual: string;
}

export interface OutputContractReconciliationMismatch {
  field: string;
  tool: string;
  reported: number;
  actual: number;
}

export interface OutputContractValidationResult {
  valid: boolean;
  missing: string[];
  invalid: OutputContractTypeMismatch[];
  reconciliation: OutputContractReconciliationMismatch[];
}

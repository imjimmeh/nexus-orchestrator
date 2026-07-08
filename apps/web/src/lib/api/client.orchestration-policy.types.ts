export type OrchestrationMode =
  | "autonomous"
  | "supervised"
  | "notifications_only";

export interface PolicyDescriptorDto {
  key: string;
  valueType: "string" | "number" | "boolean";
  enumValues?: string[];
  group: string;
  label: string;
  description: string;
  min?: number;
  max?: number;
  step?: number;
}

export interface ResolvedPolicyEntryDto {
  key: string;
  value: string | number | boolean;
  layer: string;
  defaultValue: string | number | boolean;
  descriptor: PolicyDescriptorDto;
}

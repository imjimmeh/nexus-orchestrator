import type { z } from "zod";
import type {
  OrchestrationAutonomyValueSchema,
  OrchestrationPolicyModeSchema,
  OrchestrationPolicyValueTypeSchema,
} from "./orchestration-policy.schema";

export type OrchestrationAutonomyValue = z.infer<
  typeof OrchestrationAutonomyValueSchema
>;
export type OrchestrationPolicyMode = z.infer<
  typeof OrchestrationPolicyModeSchema
>;
export type OrchestrationPolicyValueType = z.infer<
  typeof OrchestrationPolicyValueTypeSchema
>;

export interface OrchestrationPolicyKeyDescriptor {
  key: string;
  valueType: OrchestrationPolicyValueType;
  defaultValue: string | number | boolean;
  enumValues?: readonly string[];
  group: string;
  label: string;
  description: string;
  min?: number;
  max?: number;
  step?: number;
}

import { z } from "zod";

export const OrchestrationAutonomyValueSchema = z.enum(["auto", "ask", "off"]);

export const OrchestrationMergeAutonomyValueSchema = z.enum(["auto", "ask"]);

export const OrchestrationPolicyModeSchema = z.enum([
  "autonomous",
  "supervised",
  "notifications_only",
]);

export const OrchestrationPolicyValueTypeSchema = z.enum([
  "string",
  "number",
  "boolean",
]);

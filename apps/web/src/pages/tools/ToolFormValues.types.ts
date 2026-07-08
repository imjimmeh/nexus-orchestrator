export interface ToolFormValues {
  name: string;
  language: "node" | "python";
  schema: string;
  typescript_code: string;
  tier_restriction: "1" | "2";
}

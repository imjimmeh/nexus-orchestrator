import { z } from "zod";
import type {
  CreateMcpServerSchema,
  UpdateMcpServerSchema,
  InvokeMcpToolSchema,
} from "./mcp-server.schema";

export type CreateMcpServerRequest = z.infer<typeof CreateMcpServerSchema>;
export type UpdateMcpServerRequest = z.infer<typeof UpdateMcpServerSchema>;
export type InvokeMcpToolRequest = z.infer<typeof InvokeMcpToolSchema>;

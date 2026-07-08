import { z } from "zod";
import type {
  CreateAcpServerSchema,
  UpdateAcpServerSchema,
  InvokeAcpAgentSchema,
} from "./acp-server.schema";

export type CreateAcpServerRequest = z.infer<typeof CreateAcpServerSchema>;
export type UpdateAcpServerRequest = z.infer<typeof UpdateAcpServerSchema>;
export type InvokeAcpAgentRequest = z.infer<typeof InvokeAcpAgentSchema>;

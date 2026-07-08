import type { Dispatch, SetStateAction } from "react";
import { AcpAuthType, AcpAwaitPolicy, AcpRunMode } from "@/lib/api/acp.types";

export type AcpServerFormValues = {
  name: string;
  enabled: boolean;
  url: string;
  auth_type: AcpAuthType;
  auth_token: string;
  headersJson: string;
  includeAgents: string;
  excludeAgents: string;
  timeoutMs: string;
  connectTimeoutMs: string;
  maxRetries: string;
  retryBackoffMs: string;
  default_run_mode: AcpRunMode;
  await_policy: AcpAwaitPolicy;
};

export type SetFormValues = Dispatch<SetStateAction<AcpServerFormValues>>;

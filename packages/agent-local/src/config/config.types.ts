export type LocalAgentConfig = {
  host: string;
  port: number;
  allowedRoots: string[];
  allowPatterns: string[];
  defaultCommandTimeoutMs: number;
  maxFileBytes: number;
  logToStdout: boolean;
};

export type ConfigSettableKey =
  | "host"
  | "port"
  | "allowedRoots"
  | "allowPatterns"
  | "defaultCommandTimeoutMs"
  | "maxFileBytes"
  | "logToStdout";

export type CommandExecutionInput = {
  command: string;
  args?: string[];
  cwd?: string;
  timeout?: number;
};

export type ReadFileInput = {
  path: string;
  encoding?: "utf8" | "base64";
};

export type WriteFileInput = {
  path: string;
  content: string;
  mode?: number;
};

export type LsInput = {
  path: string;
  recursive?: boolean;
  missing_ok?: boolean;
};

export type DeleteInput = {
  path: string;
  recursive?: boolean;
};

// packages/harness-runtime/src/server/server.types.ts

export interface HarnessServer {
  port: number;
  close: () => Promise<void>;
}

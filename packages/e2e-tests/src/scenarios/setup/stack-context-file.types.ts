// packages/e2e-tests/src/scenarios/setup/stack-context-file.types.ts
export interface SerializedStackContext {
  apiHttp: string;
  apiWs: string;
  kanbanHttp: string;
  networkName: string;
  jwtSecret: string;
  fakeLlmPort: number;
  /** HTTP control server port (fakeLlmPort + 1) — accepts POST /scenario to load scenarios */
  fakeLlmControlPort: number;
}

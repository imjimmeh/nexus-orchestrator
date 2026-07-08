// packages/e2e-tests/src/stack/types.ts
import type { FakeLlmServer } from "../fake-llm/index.js";

export interface StackUrls {
  /** http://localhost:<port> — API HTTP endpoint seen from the test runner */
  apiHttp: string;
  /** ws://localhost:<port> — API WebSocket endpoint seen from the test runner */
  apiWs: string;
  /** http://localhost:<port> — Kanban HTTP endpoint seen from the test runner */
  kanbanHttp: string;
  /** Name of the Docker network all containers share */
  networkName: string;
}

export interface StackContext extends StackUrls {
  fakeLlm: FakeLlmServer;
  jwtSecret: string;
  /** Dump API + Kanban container logs; call on test failure for diagnosis */
  containerLogs(): Promise<{ api: string; kanban: string }>;
  /** Stop all containers and the fake LLM; call in afterAll */
  stop(): Promise<void>;
}

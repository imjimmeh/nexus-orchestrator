// packages/e2e-tests/src/stack/containers.types.ts
import type { StartedTestContainer } from "testcontainers";
import type { ManagedNetwork } from "./network.js";

export interface StartedPostgres {
  container: StartedTestContainer;
  /** Connection string reachable from the test runner host */
  hostConnectionString: string;
}

export interface StartedApi {
  container: StartedTestContainer;
  httpPort: number;
  wsPort: number;
}

export interface ApiContainerOptions {
  network: ManagedNetwork;
  fakeLlmPort: number;
  jwtSecret: string;
  kanbanBaseUrl: string;
}

export interface KanbanContainerOptions {
  network: ManagedNetwork;
  jwtSecret: string;
  coreApiBaseUrl: string;
}

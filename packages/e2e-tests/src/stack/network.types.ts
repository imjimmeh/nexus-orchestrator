// packages/e2e-tests/src/stack/network.types.ts
import type { StartedNetwork } from "testcontainers";

export interface ManagedNetwork {
  name: string;
  /** The underlying testcontainers network instance, required by withNetwork() */
  startedNetwork: StartedNetwork;
  stop(): Promise<void>;
}

// packages/e2e-tests/src/stack/network.ts
export type { ManagedNetwork } from "./network.types.js";
import type { ManagedNetwork } from "./network.types.js";
import { Network } from "testcontainers";

export async function createTestNetwork(): Promise<ManagedNetwork> {
  const network = await new Network().start();
  return {
    name: network.getName(),
    startedNetwork: network,
    stop: async () => {
      await network.stop();
    },
  };
}

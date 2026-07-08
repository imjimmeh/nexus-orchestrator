import { GLOBAL_SCOPE_NODE_ID } from "@/lib/api/client.scope.types";
import type { AppPlane } from "./plane.types";

export type { AppPlane };

export function resolvePlane(activeScopeNodeId: string): AppPlane {
  return activeScopeNodeId === GLOBAL_SCOPE_NODE_ID ? "platform" : "workspace";
}

import { api } from "@/lib/api/client";
import type { ControlPlaneBoardResponse } from "./controlPlane.types";

export function fetchControlPlaneBoard(
  projectId: string,
): Promise<ControlPlaneBoardResponse> {
  return api.get<ControlPlaneBoardResponse>(
    `/projects/${projectId}/control-plane/board`,
  );
}

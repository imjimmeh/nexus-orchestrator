import type { Node } from "@xyflow/react";
import type { JobNodeData } from "../../serialization/types";

export function makeJobNode(
  id: string,
  overrides: Partial<JobNodeData> = {},
): Node<JobNodeData, "job"> {
  return {
    id,
    type: "job",
    position: { x: 0, y: 0 },
    data: {
      label: "Test Job",
      jobType: "execution",
      jobId: "test-job-1",
      ...overrides,
    } as JobNodeData,
  };
}

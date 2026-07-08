import type { EdgeTypes } from "@xyflow/react";
import { DependencyEdge } from "./DependencyEdge";
import { TransitionEdge } from "./TransitionEdge";
import { SwitchEdge } from "./SwitchEdge";

export const edgeTypes = {
  dependency: DependencyEdge,
  transition: TransitionEdge,
  switch: SwitchEdge,
} satisfies EdgeTypes;

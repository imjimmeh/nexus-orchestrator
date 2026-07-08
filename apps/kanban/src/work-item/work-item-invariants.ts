import { BadRequestException } from "@nestjs/common";
import {
  StoryPointsSchema,
  allowsStoryPoints,
  canParent,
} from "@nexus/kanban-contracts";
import type { WorkItemInvariantInput } from "./work-item-invariants.types";

export type { WorkItemInvariantInput } from "./work-item-invariants.types";

export function assertWorkItemInvariants(input: WorkItemInvariantInput): void {
  const { type, storyPoints, parentType } = input;

  if (storyPoints !== undefined && storyPoints !== null) {
    if (!allowsStoryPoints(type)) {
      throw new BadRequestException(
        `story points are not allowed on ${type} items`,
      );
    }
    if (!StoryPointsSchema.safeParse(storyPoints).success) {
      throw new BadRequestException(
        `story points must be one of 1, 2, 3, 5, 8, 13`,
      );
    }
  }

  if (parentType !== undefined && parentType !== null) {
    if (type === "epic") {
      throw new BadRequestException("an epic cannot have a parent");
    }
    if (!canParent(parentType, type)) {
      throw new BadRequestException(`a ${parentType} cannot parent a ${type}`);
    }
  }
}

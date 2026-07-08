import { z } from "zod";

export const WORK_ITEM_TYPES = [
  "epic",
  "story",
  "task",
  "bug",
  "spike",
] as const;

export const WorkItemTypeSchema = z.enum(WORK_ITEM_TYPES);
export type WorkItemType = z.infer<typeof WorkItemTypeSchema>;

export const STORY_POINT_VALUES = [1, 2, 3, 5, 8, 13] as const;

export const StoryPointsSchema = z.union(
  STORY_POINT_VALUES.map((v) => z.literal(v)) as [
    z.ZodLiteral<1>,
    z.ZodLiteral<2>,
    z.ZodLiteral<3>,
    z.ZodLiteral<5>,
    z.ZodLiteral<8>,
    z.ZodLiteral<13>,
  ],
);
export type StoryPoints = z.infer<typeof StoryPointsSchema>;

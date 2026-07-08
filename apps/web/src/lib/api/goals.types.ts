/**
 * Project-goal domain types — goal entity aliases (owned by
 * `@nexus/kanban-contracts`) and the create / update / worklog request DTOs.
 *
 * Moved out of `./types.ts` so the rest of the web API client can consume a
 * stable surface while the legacy `./types.ts` is incrementally depopulated
 * by child-7.
 */

import type {
  CreateProjectGoalRequest as KanbanCreateProjectGoalRequest,
  CreateProjectGoalWorklogRequest as KanbanCreateProjectGoalWorklogRequest,
  ProjectGoal as KanbanProjectGoal,
  ProjectGoalMoscow as KanbanProjectGoalMoscow,
  ProjectGoalPriority as KanbanProjectGoalPriority,
  ProjectGoalStatus as KanbanProjectGoalStatus,
  ProjectGoalWorklog as KanbanProjectGoalWorklog,
  ProjectGoalWorklogAuthorType as KanbanProjectGoalWorklogAuthorType,
  ProjectGoalWorklogEntryType as KanbanProjectGoalWorklogEntryType,
  UpdateProjectGoalRequest as KanbanUpdateProjectGoalRequest,
  UpdateProjectGoalStatusRequest as KanbanUpdateProjectGoalStatusRequest,
} from "@nexus/kanban-contracts";

export type ProjectGoalStatus = KanbanProjectGoalStatus;
export type ProjectGoalMoscow = KanbanProjectGoalMoscow;
export type ProjectGoalPriority = KanbanProjectGoalPriority;
export type ProjectGoalWorklogEntryType = KanbanProjectGoalWorklogEntryType;
export type ProjectGoalWorklogAuthorType = KanbanProjectGoalWorklogAuthorType;
export type ProjectGoal = KanbanProjectGoal;
export type ProjectGoalWorklog = KanbanProjectGoalWorklog;

export type CreateProjectGoalRequest = KanbanCreateProjectGoalRequest;
export type UpdateProjectGoalRequest = KanbanUpdateProjectGoalRequest;
export type UpdateProjectGoalStatusRequest =
  KanbanUpdateProjectGoalStatusRequest;
export type CreateProjectGoalWorklogRequest =
  KanbanCreateProjectGoalWorklogRequest;
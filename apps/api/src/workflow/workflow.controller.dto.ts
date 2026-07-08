import {
  createWorkflowLaunchPresetSchema,
  createWorkflowSchema,
  executeWorkflowSchema,
  paginationQuerySchema,
  updateWorkflowLaunchPresetSchema,
  workflowEventsQuerySchema,
  workflowLaunchContextQuerySchema,
  workflowRunsQuerySchema,
  type CreateWorkflowRequest,
  type CreateWorkflowLaunchPresetRequest,
  type PaginationQueryRequest,
  type UpdateWorkflowLaunchPresetRequest,
  type WorkflowEventsQueryRequest,
  type WorkflowLaunchContextQueryRequest,
  type WorkflowRunsQueryRequest,
} from '@nexus/core';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import type { ZodTypeAny } from 'zod';

export class CreateWorkflowDto {
  static readonly schema: ZodTypeAny = createWorkflowSchema;

  @IsOptional()
  @IsString()
  name?: CreateWorkflowRequest['name'];

  @IsString()
  yaml_definition!: CreateWorkflowRequest['yaml_definition'];

  @IsOptional()
  @IsBoolean()
  is_active?: CreateWorkflowRequest['is_active'];
}

export class ExecuteWorkflowDto {
  static readonly schema: ZodTypeAny = executeWorkflowSchema;

  @IsOptional()
  trigger_data?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  scopeId?: string;

  @IsOptional()
  @IsString()
  contextId?: string;

  @IsOptional()
  @IsString()
  contextType?: string;

  @IsOptional()
  @IsString()
  scope_id?: string;

  @IsOptional()
  @IsString()
  context_id?: string;

  @IsOptional()
  @IsString()
  preset_id?: string;

  @IsOptional()
  @IsString()
  launch_source?: 'manual' | 'project_scoped' | 'rerun_with_edits' | 'preset';

  @IsOptional()
  @IsBoolean()
  dry_run?: boolean;
}

export class WorkflowLaunchContextQueryDto {
  static readonly schema: ZodTypeAny = workflowLaunchContextQuerySchema;

  @IsOptional()
  @IsString()
  scopeId?: WorkflowLaunchContextQueryRequest['scopeId'];

  @IsOptional()
  @IsString()
  contextId?: WorkflowLaunchContextQueryRequest['contextId'];

  @IsOptional()
  @IsString()
  contextType?: WorkflowLaunchContextQueryRequest['contextType'];
}

export class CreateWorkflowLaunchPresetDto {
  static readonly schema: ZodTypeAny = createWorkflowLaunchPresetSchema;

  @IsString()
  name!: CreateWorkflowLaunchPresetRequest['name'];

  @IsOptional()
  @IsString()
  scope_id?: CreateWorkflowLaunchPresetRequest['scope_id'];

  @IsOptional()
  trigger_data?: CreateWorkflowLaunchPresetRequest['trigger_data'];
}

export class UpdateWorkflowLaunchPresetDto {
  static readonly schema: ZodTypeAny = updateWorkflowLaunchPresetSchema;

  @IsOptional()
  @IsString()
  name?: UpdateWorkflowLaunchPresetRequest['name'];

  @IsOptional()
  trigger_data?: UpdateWorkflowLaunchPresetRequest['trigger_data'];
}

export class PaginationQueryDto {
  static readonly schema: ZodTypeAny = paginationQuerySchema;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Transform(({ value }) => (value !== undefined ? Number(value) : 20))
  limit: PaginationQueryRequest['limit'] = 20;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Transform(({ value }) => (value !== undefined ? Number(value) : 0))
  offset: PaginationQueryRequest['offset'] = 0;

  @IsOptional()
  @IsString()
  workflowId?: PaginationQueryRequest['workflowId'];

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  includeInactive?: PaginationQueryRequest['includeInactive'];

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  isActive?: PaginationQueryRequest['isActive'];

  @IsOptional()
  @IsString()
  search?: PaginationQueryRequest['search'];

  @IsOptional()
  @IsString()
  sortBy?: PaginationQueryRequest['sortBy'];

  @IsOptional()
  @IsString()
  sortDir?: PaginationQueryRequest['sortDir'];

  @IsOptional()
  @IsString()
  scopeNodeId?: PaginationQueryRequest['scopeNodeId'];
}

export class WorkflowRunsQueryDto extends PaginationQueryDto {
  static readonly schema: ZodTypeAny = workflowRunsQuerySchema;

  @IsOptional()
  @IsString()
  scopeId?: WorkflowRunsQueryRequest['scopeId'];

  @IsOptional()
  @IsString()
  contextId?: WorkflowRunsQueryRequest['contextId'];

  @IsOptional()
  @IsString()
  status?: WorkflowRunsQueryRequest['status'];

  @IsOptional()
  @IsString()
  sourceType?: WorkflowRunsQueryRequest['sourceType'];
}

export class WorkflowEventsQueryDto extends PaginationQueryDto {
  static readonly schema: ZodTypeAny = workflowEventsQuerySchema;

  @IsOptional()
  @IsString()
  scopeId?: WorkflowEventsQueryRequest['scopeId'];
}

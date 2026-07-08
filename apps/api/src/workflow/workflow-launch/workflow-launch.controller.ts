import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  Inject,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/authorization/permissions.guard';
import { RequirePermission } from '../../auth/authorization/require-permission.decorator';
import { WorkflowLaunchPresetRepository } from '../database/repositories/workflow-launch-preset.repository';
import {
  CreateWorkflowLaunchPresetDto,
  ExecuteWorkflowDto,
  UpdateWorkflowLaunchPresetDto,
  WorkflowLaunchContextQueryDto,
} from '../workflow.controller.dto';
import { WorkflowLaunchOrchestrationService } from './workflow-launch-orchestration.service';
import {
  normalizeRecord,
  resolveActorId,
} from './workflow-launch-orchestration.helpers';
import { normalizeOptionalString } from '@nexus/core';
import type { WorkflowLaunchDescriptor } from '@nexus/core';
import { WORKFLOW_PERSISTENCE_SERVICE } from '../kernel/interfaces/workflow-kernel.ports';
import type { IWorkflowPersistenceService } from '../kernel/interfaces/workflow-kernel.ports';

@ApiTags('workflows')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('workflows')
export class WorkflowLaunchController {
  constructor(
    @Inject(WORKFLOW_PERSISTENCE_SERVICE)
    private readonly workflowPersistence: IWorkflowPersistenceService,
    private readonly workflowLaunchPresets: WorkflowLaunchPresetRepository,
    private readonly workflowLaunchOrchestration: WorkflowLaunchOrchestrationService,
  ) {}

  @Get('launch-options')
  @RequirePermission('workflows:read')
  @ApiOperation({ summary: 'List workflow launch options for a context' })
  async getLaunchOptions(@Query() query: WorkflowLaunchContextQueryDto) {
    const context =
      this.workflowLaunchOrchestration.resolveLaunchContext(query);

    const workflows = await this.workflowPersistence.getAllWorkflows({
      includeInactive: false,
    });

    const descriptors = workflows.map((workflow) =>
      this.workflowLaunchOrchestration.buildWorkflowLaunchDescriptor(
        workflow,
        context,
      ),
    );

    const data = descriptors
      .filter(
        (descriptor): descriptor is WorkflowLaunchDescriptor =>
          descriptor !== null,
      )
      .sort((left, right) =>
        left.workflowName.localeCompare(right.workflowName),
      );

    return {
      success: true,
      data,
    };
  }

  @Get(':id/launch-contract')
  @RequirePermission('workflows:read')
  @ApiOperation({ summary: 'Get launch contract and presets for a workflow' })
  async getLaunchContract(
    @Param('id') id: string,
    @Query() query: WorkflowLaunchContextQueryDto,
  ) {
    const context =
      this.workflowLaunchOrchestration.resolveLaunchContext(query);

    const workflow = await this.workflowPersistence.getWorkflow(id);
    const descriptor =
      this.workflowLaunchOrchestration.buildWorkflowLaunchDescriptor(
        workflow,
        context,
      );
    if (!descriptor) {
      throw new BadRequestException('Workflow definition is invalid.');
    }

    const presets = await this.workflowLaunchPresets.findByWorkflow(
      id,
      context.scopeId ?? undefined,
    );

    return {
      success: true,
      data: {
        ...descriptor,
        presets,
      },
    };
  }

  @Get(':id/launch-presets')
  @RequirePermission('workflows:read')
  @ApiOperation({ summary: 'List launch presets for a workflow' })
  async listLaunchPresets(
    @Param('id') id: string,
    @Query() query: WorkflowLaunchContextQueryDto,
  ) {
    await this.workflowPersistence.getWorkflow(id);

    const context =
      this.workflowLaunchOrchestration.resolveLaunchContext(query);

    const presets = await this.workflowLaunchPresets.findByWorkflow(
      id,
      context.scopeId ?? undefined,
    );

    return {
      success: true,
      data: presets,
    };
  }

  @Post(':id/launch-presets')
  @RequirePermission('workflows:create')
  @ApiOperation({ summary: 'Create launch preset for a workflow' })
  async createLaunchPreset(
    @Param('id') id: string,
    @Body() dto: CreateWorkflowLaunchPresetDto,
    @Req() req: Request,
  ) {
    const name = normalizeOptionalString(dto.name);
    if (!name) {
      throw new BadRequestException('Preset name is required.');
    }

    const scopeId = normalizeOptionalString(dto.scope_id);

    await this.workflowPersistence.getWorkflow(id);

    const existing =
      await this.workflowLaunchPresets.findByWorkflowProjectAndName({
        workflowId: id,
        scopeId: scopeId,
        name,
      });
    if (existing) {
      throw new ConflictException(
        `Launch preset '${name}' already exists for this workflow context.`,
      );
    }

    const actorId = resolveActorId(req);
    const preset = await this.workflowLaunchPresets.create({
      workflow_id: id,
      scopeId: scopeId,
      name,
      trigger_data: normalizeRecord(dto.trigger_data),
      created_by: actorId,
      updated_by: actorId,
    });

    return {
      success: true,
      data: preset,
    };
  }

  @Patch(':id/launch-presets/:presetId')
  @RequirePermission('workflows:update')
  @ApiOperation({ summary: 'Update launch preset for a workflow' })
  async updateLaunchPreset(
    @Param('id') id: string,
    @Param('presetId') presetId: string,
    @Body() dto: UpdateWorkflowLaunchPresetDto,
    @Req() req: Request,
  ) {
    const preset = await this.workflowLaunchPresets.findByIdAndWorkflow(
      presetId,
      id,
    );
    if (!preset) {
      throw new NotFoundException(
        `Launch preset ${presetId} not found for workflow ${id}`,
      );
    }

    const updates: {
      name?: string;
      trigger_data?: Record<string, unknown>;
      updated_by: string | null;
    } = {
      updated_by: resolveActorId(req),
    };

    if (dto.name !== undefined) {
      const nextName = normalizeOptionalString(dto.name);
      if (!nextName) {
        throw new BadRequestException('Preset name cannot be empty.');
      }

      if (nextName !== preset.name) {
        const duplicate =
          await this.workflowLaunchPresets.findByWorkflowProjectAndName({
            workflowId: id,
            scopeId: normalizeOptionalString(preset.scopeId),
            name: nextName,
          });
        if (duplicate && duplicate.id !== preset.id) {
          throw new ConflictException(
            `Launch preset '${nextName}' already exists for this workflow context.`,
          );
        }
      }

      updates.name = nextName;
    }

    if (dto.trigger_data !== undefined) {
      updates.trigger_data = normalizeRecord(dto.trigger_data);
    }

    const updatedPreset = await this.workflowLaunchPresets.update(
      presetId,
      updates,
    );
    if (!updatedPreset) {
      throw new NotFoundException(
        `Launch preset ${presetId} not found for workflow ${id}`,
      );
    }

    return {
      success: true,
      data: updatedPreset,
    };
  }

  @Delete(':id/launch-presets/:presetId')
  @RequirePermission('workflows:update')
  @ApiOperation({ summary: 'Delete launch preset for a workflow' })
  async deleteLaunchPreset(
    @Param('id') id: string,
    @Param('presetId') presetId: string,
  ) {
    const preset = await this.workflowLaunchPresets.findByIdAndWorkflow(
      presetId,
      id,
    );
    if (!preset) {
      throw new NotFoundException(
        `Launch preset ${presetId} not found for workflow ${id}`,
      );
    }

    await this.workflowLaunchPresets.remove(presetId);
    return {
      success: true,
      data: {
        id: presetId,
      },
    };
  }

  @Post(':id/execute')
  @RequirePermission('workflows:create')
  @ApiOperation({ summary: 'Execute workflow' })
  async execute(
    @Param('id') id: string,
    @Body() executeDto: ExecuteWorkflowDto,
  ) {
    return this.workflowLaunchOrchestration.executeWorkflowInternal({
      workflowId: id,
      executeDto,
      defaultLaunchSource: 'manual',
    });
  }
}

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import type {
  IHostMountBinding,
  IJob,
  IToolPermissionPolicy,
} from '@nexus/core';
import type { AgentProfile } from '../../ai-config/database/entities/agent-profile.entity';
import { AiConfigurationService } from '../../ai-config/ai-configuration.service';
import { SystemSettingsService } from '../../settings/system-settings.service';
import { HostMountAuditService } from './host-mount-audit.service';
import { resolvePreflightRequestWithAudit } from './host-mount-preflight-resolution.helpers';
import { HostMountStartupValidationService } from './host-mount-startup-validation.service';
import {
  compactStringLists,
  isAliasAllowed,
  isAliasDenied,
  normalizeHostMountRequest,
  parseCatalogFromEnv,
  parseHostMountCatalog,
  resolveHostMountContainerPath,
  resolveHostMountTargetPath,
  resolveProjectPolicyFromState,
} from './host-mount-resolution.helpers';
import {
  HOST_MOUNT_CATALOG_SETTING_KEY,
  HOST_MOUNT_CONTAINER_ROOT,
  HOST_MOUNT_RW_APPROVAL_REQUIRED_SETTING_KEY,
  type HostMountApprovalRequirement,
  type HostMountCatalogEntry,
  type HostMountResolutionOutcome,
  type HostMountPolicy,
} from './host-mount-resolution.service.types';

@Injectable()
export class HostMountResolutionService implements OnModuleInit {
  private readonly logger = new Logger(HostMountResolutionService.name);

  constructor(
    private readonly settings: SystemSettingsService,
    private readonly aiConfig: AiConfigurationService,
    private readonly hostMountAudit: HostMountAuditService,
    private readonly startupValidation: HostMountStartupValidationService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.startupValidation.validate();
  }

  async resolveHostMountBindings(params: {
    job: IJob;
    workflowPermissions?: IToolPermissionPolicy;
    agentProfile?: string;
    stateVariables?: Record<string, unknown>;
    workflowRunId?: string;
    stepId?: string;
  }): Promise<IHostMountBinding[]> {
    const outcome = await this.resolveHostMountBindingsPreflight(params);
    if (outcome.status === 'approval_required') {
      throw new ForbiddenException(
        `Host mount write approval required for alias(es): ${outcome.approvals_required
          .map((entry) => entry.alias)
          .join(', ')}`,
      );
    }

    return outcome.bindings;
  }

  async resolveHostMountBindingsPreflight(params: {
    job: IJob;
    workflowPermissions?: IToolPermissionPolicy;
    agentProfile?: string;
    stateVariables?: Record<string, unknown>;
    workflowRunId?: string;
    stepId?: string;
  }): Promise<HostMountResolutionOutcome> {
    const requests = params.job.host_mounts;
    if (!Array.isArray(requests) || requests.length === 0) {
      return {
        status: 'resolved',
        bindings: [],
        approvals_required: [],
      };
    }

    const context = await this.buildResolutionContext(params);
    const resolved = new Map<string, IHostMountBinding>();
    const approvalsRequired: HostMountApprovalRequirement[] = [];

    for (const [index, request] of requests.entries()) {
      const requestResult = await resolvePreflightRequestWithAudit({
        hostMountAudit: this.hostMountAudit,
        resolveBindingForRequest: (requestParams) =>
          this.resolveBindingForRequest(requestParams),
        jobId: params.job.id,
        index,
        request,
        context,
        workflowRunId: params.workflowRunId,
        stepId: params.stepId,
      });
      if (requestResult.type === 'approval_required') {
        approvalsRequired.push(requestResult.requirement);
        continue;
      }

      this.upsertBinding(resolved, requestResult.binding);
    }

    const bindings = [...resolved.values()];
    if (approvalsRequired.length > 0) {
      return {
        status: 'approval_required',
        bindings: [],
        approvals_required: approvalsRequired,
      };
    }

    this.logger.log(
      `Resolved ${bindings.length.toString()} host mount(s): ${bindings
        .map((binding) => `${binding.alias}:${binding.mode}`)
        .join(', ')}`,
    );

    return {
      status: 'resolved',
      bindings,
      approvals_required: [],
    };
  }

  private async buildResolutionContext(params: {
    job: IJob;
    workflowPermissions?: IToolPermissionPolicy;
    agentProfile?: string;
    stateVariables?: Record<string, unknown>;
  }): Promise<{
    catalog: Map<string, HostMountCatalogEntry>;
    allowLists: string[][];
    denyLists: string[][];
    rwAllowLists: string[][];
    requireRwApproval: boolean;
  }> {
    const profile = await this.loadProfile(params.agentProfile);
    const projectPolicy = resolveProjectPolicyFromState(params.stateVariables);

    return {
      catalog: await this.loadCatalog(),
      allowLists: this.collectAllowLists(
        profile,
        projectPolicy,
        params.workflowPermissions,
        params.job.permissions,
      ),
      denyLists: this.collectDenyLists(
        profile,
        projectPolicy,
        params.workflowPermissions,
        params.job.permissions,
      ),
      rwAllowLists: this.collectRwAllowLists(
        profile,
        projectPolicy,
        params.workflowPermissions,
        params.job.permissions,
      ),
      requireRwApproval: await this.settings.get<boolean>(
        HOST_MOUNT_RW_APPROVAL_REQUIRED_SETTING_KEY,
        false,
      ),
    };
  }

  private async resolveBindingForRequest(params: {
    jobId: string;
    index: number;
    request: NonNullable<IJob['host_mounts']>[number];
    context: {
      catalog: Map<string, HostMountCatalogEntry>;
      allowLists: string[][];
      denyLists: string[][];
      rwAllowLists: string[][];
      requireRwApproval: boolean;
    };
  }): Promise<
    | { type: 'binding'; binding: IHostMountBinding }
    | { type: 'approval_required'; requirement: HostMountApprovalRequirement }
  > {
    const normalized = normalizeHostMountRequest({
      jobId: params.jobId,
      index: params.index,
      request: params.request,
    });

    const catalogEntry = params.context.catalog.get(normalized.alias);
    if (!catalogEntry) {
      throw new BadRequestException(
        `Job '${params.jobId}' requested unknown host mount alias '${normalized.alias}'`,
      );
    }

    if (isAliasDenied(normalized.alias, params.context.denyLists)) {
      throw new ForbiddenException(
        `Host mount alias '${normalized.alias}' denied by policy`,
      );
    }

    if (!isAliasAllowed(normalized.alias, params.context.allowLists)) {
      throw new ForbiddenException(
        `Host mount alias '${normalized.alias}' is not explicitly allowed`,
      );
    }

    const mode = normalized.mode ?? catalogEntry.defaultMode;
    if (mode === 'rw') {
      const requirement = this.assertWriteAllowed({
        alias: normalized.alias,
        rwAllowLists: params.context.rwAllowLists,
        catalogEntry,
        requireRwApproval: params.context.requireRwApproval,
      });

      if (requirement) {
        return {
          type: 'approval_required',
          requirement,
        };
      }
    }

    const hostPath = await resolveHostMountTargetPath({
      alias: normalized.alias,
      apiRoot: catalogEntry.apiRoot,
      subpath: normalized.subpath,
    });

    return {
      type: 'binding',
      binding: {
        alias: normalized.alias,
        hostPath,
        containerPath: resolveHostMountContainerPath(
          normalized.alias,
          normalized.subpath,
          HOST_MOUNT_CONTAINER_ROOT,
        ),
        mode,
        readOnly: mode !== 'rw',
      },
    };
  }

  private collectAllowLists(
    profile: AgentProfile | null,
    projectPolicy: HostMountPolicy | undefined,
    workflowPolicy: IToolPermissionPolicy | undefined,
    jobPolicy: IToolPermissionPolicy | undefined,
  ): string[][] {
    return compactStringLists([
      profile?.allowed_mount_aliases,
      projectPolicy?.allow_host_mounts,
      workflowPolicy?.allow_host_mounts,
      jobPolicy?.allow_host_mounts,
    ]);
  }

  private collectDenyLists(
    profile: AgentProfile | null,
    projectPolicy: HostMountPolicy | undefined,
    workflowPolicy: IToolPermissionPolicy | undefined,
    jobPolicy: IToolPermissionPolicy | undefined,
  ): string[][] {
    return compactStringLists([
      profile?.denied_mount_aliases,
      projectPolicy?.deny_host_mounts,
      workflowPolicy?.deny_host_mounts,
      jobPolicy?.deny_host_mounts,
    ]);
  }

  private collectRwAllowLists(
    profile: AgentProfile | null,
    projectPolicy: HostMountPolicy | undefined,
    workflowPolicy: IToolPermissionPolicy | undefined,
    jobPolicy: IToolPermissionPolicy | undefined,
  ): string[][] {
    return compactStringLists([
      profile?.allow_rw_mount_aliases,
      projectPolicy?.allow_host_mount_rw,
      workflowPolicy?.allow_host_mount_rw,
      jobPolicy?.allow_host_mount_rw,
    ]);
  }

  private assertWriteAllowed(params: {
    alias: string;
    rwAllowLists: string[][];
    catalogEntry: HostMountCatalogEntry;
    requireRwApproval: boolean;
  }): HostMountApprovalRequirement | undefined {
    if (!params.catalogEntry.writableAllowed) {
      throw new ForbiddenException(
        `Host mount alias '${params.alias}' is read-only in catalog`,
      );
    }

    if (!isAliasAllowed(params.alias, params.rwAllowLists)) {
      throw new ForbiddenException(
        `Host mount alias '${params.alias}' does not have read-write permission`,
      );
    }

    const approvalRequired =
      params.requireRwApproval || params.catalogEntry.approvalRequiredOnRw;
    if (approvalRequired) {
      return {
        alias: params.alias,
        mode: 'rw',
        reason: `Host mount alias '${params.alias}' requires write approval`,
      };
    }

    return undefined;
  }

  private async loadCatalog(): Promise<Map<string, HostMountCatalogEntry>> {
    const settingsCatalog = await this.settings.get<unknown>(
      HOST_MOUNT_CATALOG_SETTING_KEY,
      {},
    );

    const envCatalog = parseCatalogFromEnv(
      process.env.NEXUS_HOST_MOUNT_CATALOG_JSON,
    );

    return parseHostMountCatalog({
      ...(envCatalog as Record<string, unknown>),
      ...(settingsCatalog as Record<string, unknown>),
    });
  }

  private async loadProfile(
    profileName?: string,
  ): Promise<AgentProfile | null> {
    if (!profileName) {
      return null;
    }

    return this.aiConfig.getAgentProfileByName(profileName);
  }

  private upsertBinding(
    bindings: Map<string, IHostMountBinding>,
    binding: IHostMountBinding,
  ): void {
    const existing = bindings.get(binding.containerPath);
    if (!existing) {
      bindings.set(binding.containerPath, binding);
      return;
    }

    if (
      existing.hostPath !== binding.hostPath ||
      existing.readOnly !== binding.readOnly
    ) {
      throw new BadRequestException(
        `Conflicting host mount requests for container path '${binding.containerPath}'`,
      );
    }
  }
}

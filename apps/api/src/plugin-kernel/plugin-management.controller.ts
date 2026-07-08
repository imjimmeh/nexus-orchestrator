import {
  Controller,
  Delete,
  Get,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { RequirePermission } from '../auth/authorization/require-permission.decorator';
import { ZodBody } from '../common/decorators/zod-body.decorator';
import { ZodParam } from '../common/decorators/zod-param.decorator';
import { ZodQuery } from '../common/decorators/zod-query.decorator';
import type { PluginRegistryEntry } from './database/entities/plugin-registry-entry.entity';
import {
  disablePluginSchema,
  enablePluginSchema,
  inspectPluginSchema,
  installPluginSchema,
  listPluginsSchema,
  quarantinePluginSchema,
  scanPluginSchema,
} from './dto';
import { PluginLifecycleService } from './plugin-lifecycle.service';

interface AuthenticatedRequest {
  user?: {
    userId?: string;
  };
}

const pluginIdSchema = z.string().trim().min(1);
const SENSITIVE_RESPONSE_KEYS = new Set([
  'secret',
  'token',
  'password',
  'rawLog',
  'checksum',
  'signature',
]);
const SENSITIVE_KEY_PATTERN =
  /(secret|token|password|authorization|credential|private[_-]?key|api[_-]?key|access[_-]?key|client[_-]?key|checksum|signature|raw[_-]?log)/i;

@ApiTags('plugins')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('plugins')
export class PluginManagementController {
  constructor(
    private readonly pluginLifecycleService: PluginLifecycleService,
  ) {}

  @Get()
  @RequirePermission('agents:read')
  @ApiOperation({ summary: 'List installed plugins' })
  async listPlugins(
    @ZodQuery(listPluginsSchema) query: z.infer<typeof listPluginsSchema>,
  ) {
    const plugins = await this.pluginLifecycleService.listPlugins(query);

    return {
      success: true,
      data: plugins.map((plugin) => this.toPluginSummary(plugin)),
    };
  }

  @Get(':id/inspect')
  @RequirePermission('agents:read')
  @ApiOperation({ summary: 'Inspect plugin lifecycle details' })
  async inspectPlugin(
    @ZodParam('id', pluginIdSchema) id: string,
    @ZodQuery(inspectPluginSchema) query: z.infer<typeof inspectPluginSchema>,
  ) {
    const plugin = await this.pluginLifecycleService.inspectPlugin(
      id,
      query.version,
    );

    return {
      success: true,
      data: this.toPluginDetails(plugin),
    };
  }

  @Post('install')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: 'Install a plugin' })
  async installPlugin(
    @ZodBody(installPluginSchema) body: z.infer<typeof installPluginSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    const plugin = await this.pluginLifecycleService.installPlugin({
      ...body,
      actorId: this.getActorId(req),
    });

    return { success: true, data: this.toPluginDetails(plugin) };
  }

  @Post(':id/scan')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: 'Scan a plugin' })
  async scanPlugin(
    @ZodParam('id', pluginIdSchema) id: string,
    @ZodBody(scanPluginSchema) body: z.infer<typeof scanPluginSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    const plugin = await this.pluginLifecycleService.scanPlugin({
      pluginId: id,
      ...body,
      actorId: this.getActorId(req),
    });

    return { success: true, data: this.toPluginDetails(plugin) };
  }

  @Post(':id/enable')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: 'Enable a plugin' })
  async enablePlugin(
    @ZodParam('id', pluginIdSchema) id: string,
    @ZodBody(enablePluginSchema) body: z.infer<typeof enablePluginSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    const plugin = await this.pluginLifecycleService.enablePlugin({
      pluginId: id,
      ...body,
      actorId: this.getActorId(req),
    });

    return { success: true, data: this.toPluginDetails(plugin) };
  }

  @Post(':id/disable')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: 'Disable a plugin' })
  async disablePlugin(
    @ZodParam('id', pluginIdSchema) id: string,
    @ZodBody(disablePluginSchema) body: z.infer<typeof disablePluginSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    const plugin = await this.pluginLifecycleService.disablePlugin({
      pluginId: id,
      ...body,
      actorId: this.getActorId(req),
    });

    return { success: true, data: this.toPluginDetails(plugin) };
  }

  @Post(':id/quarantine')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: 'Quarantine a plugin' })
  async quarantinePlugin(
    @ZodParam('id', pluginIdSchema) id: string,
    @ZodBody(quarantinePluginSchema)
    body: z.infer<typeof quarantinePluginSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    const plugin = await this.pluginLifecycleService.quarantinePlugin({
      pluginId: id,
      ...body,
      actorId: this.getActorId(req),
    });

    return { success: true, data: this.toPluginDetails(plugin) };
  }

  @Delete(':id')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: 'Uninstall a plugin' })
  async uninstallPlugin(
    @ZodParam('id', pluginIdSchema) id: string,
    @ZodBody(enablePluginSchema) body: z.infer<typeof enablePluginSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    const plugin = await this.pluginLifecycleService.uninstallPlugin({
      pluginId: id,
      ...body,
      actorId: this.getActorId(req),
    });

    return { success: true, data: this.toPluginDetails(plugin) };
  }

  private getActorId(req: AuthenticatedRequest): string {
    if (!req.user?.userId) {
      throw new UnauthorizedException('Authenticated user id is required.');
    }

    return req.user.userId;
  }

  private toPluginSummary(plugin: PluginRegistryEntry) {
    return {
      id: plugin.plugin_id,
      version: plugin.version,
      name: plugin.name,
      description: plugin.description,
      author: plugin.author,
      lifecycleState: plugin.lifecycle_state,
      enabled: plugin.enabled,
      trustLevel: plugin.trust_level,
      isolationMode: plugin.isolation_mode,
    };
  }

  private toPluginDetails(plugin: PluginRegistryEntry) {
    return {
      ...this.toPluginSummary(plugin),
      requestedPermissions: this.sanitizeArray(plugin.requested_permissions),
      grantedPermissions: this.sanitizeArray(plugin.granted_permissions),
      scanResult: this.sanitizeRecord(plugin.scan_result),
      compatibilityResult: this.sanitizeRecord(plugin.compatibility_result),
      contributions: this.sanitizeArray(plugin.contributions),
      lastError: plugin.last_error,
    };
  }

  private sanitizeArray(records: Array<Record<string, unknown>>) {
    return records.map((record) => this.sanitizeValue(record));
  }

  private sanitizeRecord(record: Record<string, unknown> | null) {
    if (record === null) {
      return null;
    }

    return Object.fromEntries(
      Object.entries(record)
        .filter(([key]) => !this.isSensitiveResponseKey(key))
        .map(([key, value]) => [key, this.sanitizeValue(value)]),
    );
  }

  private isSensitiveResponseKey(key: string): boolean {
    return SENSITIVE_RESPONSE_KEYS.has(key) || SENSITIVE_KEY_PATTERN.test(key);
  }

  private sanitizeValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeValue(item));
    }

    if (value && typeof value === 'object') {
      return this.sanitizeRecord(value as Record<string, unknown>);
    }

    return value;
  }
}

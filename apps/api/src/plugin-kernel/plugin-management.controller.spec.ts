import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { PluginLifecycleService } from './plugin-lifecycle.service';
import { PluginManagementController } from './plugin-management.controller';
import {
  disablePluginSchema,
  enablePluginSchema,
  installPluginSchema,
  listPluginsSchema,
  quarantinePluginSchema,
  scanPluginSchema,
} from './dto';

type MockPluginLifecycleService = Pick<
  PluginLifecycleService,
  | 'installPlugin'
  | 'scanPlugin'
  | 'enablePlugin'
  | 'disablePlugin'
  | 'quarantinePlugin'
  | 'uninstallPlugin'
  | 'inspectPlugin'
  | 'listPlugins'
>;

const ACTOR_ID = 'user-123';

function createLifecycleServiceMock(): MockPluginLifecycleService {
  return {
    installPlugin: vi.fn(),
    scanPlugin: vi.fn(),
    enablePlugin: vi.fn(),
    disablePlugin: vi.fn(),
    quarantinePlugin: vi.fn(),
    uninstallPlugin: vi.fn(),
    inspectPlugin: vi.fn(),
    listPlugins: vi.fn(),
  };
}

function createController(service = createLifecycleServiceMock()) {
  return {
    controller: new PluginManagementController(
      service as PluginLifecycleService,
    ),
    service,
  };
}

function authenticatedRequest(actorId = ACTOR_ID) {
  return { user: { userId: actorId } };
}

function pluginRegistryEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'registry-entry-1',
    plugin_id: 'example.plugin',
    version: '1.2.3',
    name: 'Example Plugin',
    description: 'Example description',
    author: 'Nexus',
    source_type: 'package',
    source: 'https://registry.example.test/example-plugin.tgz',
    lifecycle_state: 'installed',
    enabled: false,
    trust_level: 'third_party',
    isolation_mode: 'worker_process',
    requested_permissions: [
      { capability: 'workflow.read', secret: 'do-not-leak' },
    ],
    granted_permissions: [],
    scan_result: { status: 'passed', rawLog: 'scanner internals' },
    compatibility_result: { compatible: true },
    contributions: [{ type: 'tool', name: 'example.tool' }],
    last_error: null,
    metadata: {
      package_name: '@internal/example-plugin',
      package_version: '1.2.3',
      checksum: 'sha256-secret-ish',
      signature: 'signature-secret-ish',
      entrypoints: { worker: './dist/worker.js' },
    },
    installed_at: new Date('2026-05-17T00:00:00.000Z'),
    scanned_at: null,
    enabled_at: null,
    disabled_at: null,
    quarantined_at: null,
    uninstalled_at: null,
    created_at: new Date('2026-05-17T00:00:00.000Z'),
    updated_at: new Date('2026-05-17T00:00:00.000Z'),
    ...overrides,
  };
}

function routeMetadata(methodName: keyof PluginManagementController) {
  const handler = PluginManagementController.prototype[methodName];

  return {
    path: Reflect.getMetadata(PATH_METADATA, handler),
    method: Reflect.getMetadata(METHOD_METADATA, handler),
    permission: Reflect.getMetadata('required_permission', handler),
  };
}

describe('PluginManagementController', () => {
  it('protects the controller with JWT and permissions guards', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      PluginManagementController,
    );

    expect(Reflect.getMetadata(PATH_METADATA, PluginManagementController)).toBe(
      'plugins',
    );
    expect(guards).toEqual([JwtAuthGuard, PermissionsGuard]);
  });

  it.each([
    ['listPlugins', '/', RequestMethod.GET, 'agents:read'],
    ['inspectPlugin', ':id/inspect', RequestMethod.GET, 'agents:read'],
    ['installPlugin', 'install', RequestMethod.POST, 'agents:manage'],
    ['scanPlugin', ':id/scan', RequestMethod.POST, 'agents:manage'],
    ['enablePlugin', ':id/enable', RequestMethod.POST, 'agents:manage'],
    ['disablePlugin', ':id/disable', RequestMethod.POST, 'agents:manage'],
    ['quarantinePlugin', ':id/quarantine', RequestMethod.POST, 'agents:manage'],
    ['uninstallPlugin', ':id', RequestMethod.DELETE, 'agents:manage'],
  ] as const)(
    'exposes %s with expected route metadata and roles',
    (methodName, path, method, permission) => {
      expect(routeMetadata(methodName)).toEqual({ path, method, permission });
    },
  );

  it('registers PluginKernelModule in AppModule', () => {
    const appModuleSource = readFileSync(
      path.join(__dirname, '../app.module.ts'),
      'utf8',
    );

    expect(appModuleSource).toContain(
      "import { PluginKernelModule } from './plugin-kernel/plugin-kernel.module';",
    );
    expect(appModuleSource).toMatch(/imports:\s*\[[\s\S]*PluginKernelModule/);
  });

  it('lists plugins through PluginLifecycleService and returns sanitized summaries', async () => {
    const { controller, service } = createController();
    vi.mocked(service.listPlugins).mockResolvedValue([
      pluginRegistryEntry(),
    ] as unknown);

    const filters = {
      state: 'installed' as const,
      enabled: false,
      trustLevel: 'third_party' as const,
    };

    const response = await controller.listPlugins(filters);

    expect(service.listPlugins).toHaveBeenCalledWith(filters);
    expect(response).toEqual({
      success: true,
      data: [
        {
          id: 'example.plugin',
          version: '1.2.3',
          name: 'Example Plugin',
          description: 'Example description',
          author: 'Nexus',
          lifecycleState: 'installed',
          enabled: false,
          trustLevel: 'third_party',
          isolationMode: 'worker_process',
        },
      ],
    });
    expect(JSON.stringify(response)).not.toContain('source');
    expect(JSON.stringify(response)).not.toContain('@internal/example-plugin');
    expect(JSON.stringify(response)).not.toContain('signature-secret-ish');
  });

  it.each([
    ['false', false],
    ['true', true],
  ] as const)(
    'parses enabled=%s query filter and forwards %s to PluginLifecycleService',
    async (enabledQueryValue, expectedEnabled) => {
      const { controller, service } = createController();
      vi.mocked(service.listPlugins).mockResolvedValue([]);
      const filters = listPluginsSchema.parse({ enabled: enabledQueryValue });

      await controller.listPlugins(filters);

      expect(service.listPlugins).toHaveBeenCalledWith({
        enabled: expectedEnabled,
      });
    },
  );

  it('inspects a plugin by id and query version without exposing package internals', async () => {
    const { controller, service } = createController();
    vi.mocked(service.inspectPlugin).mockResolvedValue(pluginRegistryEntry());

    const response = await controller.inspectPlugin('example.plugin', {
      version: '1.2.3',
    });

    expect(service.inspectPlugin).toHaveBeenCalledWith(
      'example.plugin',
      '1.2.3',
    );
    expect(response.data).toEqual({
      id: 'example.plugin',
      version: '1.2.3',
      name: 'Example Plugin',
      description: 'Example description',
      author: 'Nexus',
      lifecycleState: 'installed',
      enabled: false,
      trustLevel: 'third_party',
      isolationMode: 'worker_process',
      requestedPermissions: [{ capability: 'workflow.read' }],
      grantedPermissions: [],
      scanResult: { status: 'passed' },
      compatibilityResult: { compatible: true },
      contributions: [{ type: 'tool', name: 'example.tool' }],
      lastError: null,
    });
    expect(JSON.stringify(response)).not.toContain('source');
    expect(JSON.stringify(response)).not.toContain('rawLog');
    expect(JSON.stringify(response)).not.toContain('do-not-leak');
    expect(JSON.stringify(response)).not.toContain('entrypoints');
  });

  it('recursively removes secret-like keys from plugin-provided response records', async () => {
    const { controller, service } = createController();
    vi.mocked(service.inspectPlugin).mockResolvedValue(
      pluginRegistryEntry({
        requested_permissions: [
          {
            capability: 'workflow.read',
            apiToken: 'api-token-value',
            nested: { privateKey: 'private-key-value', safe: 'kept' },
          },
        ],
        granted_permissions: [
          { capability: 'workflow.write', access_token: 'access-token-value' },
        ],
        scan_result: {
          status: 'passed',
          authorization: 'Bearer secret',
          details: { secretId: 'secret-id-value', safe: 'kept' },
        },
        compatibility_result: {
          compatible: true,
          secrets: ['secret-array-value'],
        },
        contributions: [
          {
            type: 'tool',
            name: 'example.tool',
            config: {
              API_TOKEN: 'upper-token-value',
              apiKey: 'api-key-value',
              nested_api_key: { api_key: 'api-key-snake-value' },
              aws: { accessKeyId: 'access-key-id-value' },
              clientKey: 'client-key-value',
              credential: 'credential-value',
              credentials: {
                username: 'user',
                password: 'credential-password',
              },
              safe: 'kept',
            },
          },
        ],
      }),
    );

    const response = await controller.inspectPlugin('example.plugin', {
      version: '1.2.3',
    });

    expect(response.data).toMatchObject({
      requestedPermissions: [
        { capability: 'workflow.read', nested: { safe: 'kept' } },
      ],
      grantedPermissions: [{ capability: 'workflow.write' }],
      scanResult: { status: 'passed', details: { safe: 'kept' } },
      compatibilityResult: { compatible: true },
      contributions: [
        { type: 'tool', name: 'example.tool', config: { safe: 'kept' } },
      ],
    });
    expect(JSON.stringify(response)).not.toContain('api-token-value');
    expect(JSON.stringify(response)).not.toContain('access-token-value');
    expect(JSON.stringify(response)).not.toContain('Bearer secret');
    expect(JSON.stringify(response)).not.toContain('private-key-value');
    expect(JSON.stringify(response)).not.toContain('secret-id-value');
    expect(JSON.stringify(response)).not.toContain('secret-array-value');
    expect(JSON.stringify(response)).not.toContain('upper-token-value');
    expect(JSON.stringify(response)).not.toContain('api-key-value');
    expect(JSON.stringify(response)).not.toContain('api-key-snake-value');
    expect(JSON.stringify(response)).not.toContain('access-key-id-value');
    expect(JSON.stringify(response)).not.toContain('client-key-value');
    expect(JSON.stringify(response)).not.toContain('credential-value');
    expect(JSON.stringify(response)).not.toContain('credential-password');
  });

  it('delegates install to PluginLifecycleService with actor id', async () => {
    const { controller, service } = createController();
    const manifest = { id: 'example.plugin', version: '1.2.3' };
    vi.mocked(service.installPlugin).mockResolvedValue(pluginRegistryEntry());

    await controller.installPlugin(
      {
        manifest,
        source: 'https://registry.example.test/example-plugin.tgz',
        sourceType: 'package',
        trustLevel: 'third_party',
        isolationMode: 'worker_process',
      },
      authenticatedRequest(),
    );

    expect(service.installPlugin).toHaveBeenCalledWith({
      manifest,
      source: 'https://registry.example.test/example-plugin.tgz',
      sourceType: 'package',
      trustLevel: 'third_party',
      isolationMode: 'worker_process',
      actorId: ACTOR_ID,
    });
  });

  it.each([
    ['scanPlugin', 'scanPlugin', { version: '1.2.3' }],
    ['enablePlugin', 'enablePlugin', { version: '1.2.3' }],
    ['disablePlugin', 'disablePlugin', { version: '1.2.3' }],
    [
      'quarantinePlugin',
      'quarantinePlugin',
      { version: '1.2.3', reason: 'malware signature' },
    ],
    ['uninstallPlugin', 'uninstallPlugin', { version: '1.2.3' }],
  ] as const)(
    'delegates %s to PluginLifecycleService with actor id',
    async (controllerMethod, serviceMethod, body) => {
      const { controller, service } = createController();
      vi.mocked(service[serviceMethod]).mockResolvedValue(
        pluginRegistryEntry(),
      );

      await controller[controllerMethod](
        'example.plugin',
        body,
        authenticatedRequest(),
      );

      expect(service[serviceMethod]).toHaveBeenCalledWith({
        pluginId: 'example.plugin',
        ...body,
        actorId: ACTOR_ID,
      });
    },
  );

  it('defines Zod schemas for management request DTOs', () => {
    expect(
      installPluginSchema.parse({
        manifest: { id: 'example.plugin', version: '1.2.3' },
        source: 'https://registry.example.test/example-plugin.tgz',
        sourceType: 'package',
        trustLevel: 'third_party',
        isolationMode: 'worker_process',
      }),
    ).toMatchObject({ sourceType: 'package' });
    expect(scanPluginSchema.parse({ version: '1.2.3' })).toEqual({
      version: '1.2.3',
    });
    expect(enablePluginSchema.parse({ version: '1.2.3' })).toEqual({
      version: '1.2.3',
    });
    expect(disablePluginSchema.parse({ version: '1.2.3' })).toEqual({
      version: '1.2.3',
    });
    expect(
      quarantinePluginSchema.parse({
        version: '1.2.3',
        reason: 'malware signature',
      }),
    ).toEqual({ version: '1.2.3', reason: 'malware signature' });
    expect(listPluginsSchema.parse({ state: 'enabled' })).toEqual({
      state: 'enabled',
    });
    expect(listPluginsSchema.parse({ enabled: 'false' })).toEqual({
      enabled: false,
    });
    expect(listPluginsSchema.parse({ enabled: 'true' })).toEqual({
      enabled: true,
    });

    expect(() => enablePluginSchema.parse({})).toThrow();
    expect(() =>
      installPluginSchema.parse({ source: 'missing manifest' }),
    ).toThrow();
    expect(() =>
      installPluginSchema.parse({
        manifest: { id: 'example.plugin', version: '1.2.3' },
        source: 'https://registry.example.test/example-plugin.tgz',
        trustLevel: 'quarantined',
      }),
    ).toThrow();
    expect(() => listPluginsSchema.parse({ enabled: 'nope' })).toThrow();
    expect(() =>
      installPluginSchema.parse({
        manifest: { id: 'example.plugin', version: '1.2.3' },
        source: 'https://registry.example.test/example-plugin.tgz',
        unexpected: 'reject me',
      }),
    ).toThrow();
    expect(() =>
      enablePluginSchema.parse({ version: '1.2.3', unexpected: 'reject me' }),
    ).toThrow();
    expect(() =>
      listPluginsSchema.parse({ enabled: 'true', unexpected: 'reject me' }),
    ).toThrow();
  });
});

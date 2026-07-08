import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import type { HarnessId } from '@nexus/core';
import { HarnessDefinitionRepository } from './harness-definition.repository.js';
import { HarnessCredentialResolverService } from './harness-credential-resolver.service.js';
import { HARNESS_HTTP_CLIENT } from './harness-http-client.port.js';
import type { HarnessHttpClient } from './harness-http-client.types.js';
import type {
  HarnessValidateResult,
  HarnessCredentialStatus,
} from './harness-validate.types.js';
import type { CreateHarnessInput } from './harness-config.types.js';

const HEALTH_PATH = '/health';
const PROBE_TIMEOUT_MS = 3000;

@Injectable()
export class HarnessConfigService {
  constructor(
    private readonly repo: HarnessDefinitionRepository,
    private readonly credentialResolver: HarnessCredentialResolverService,
    @Inject(HARNESS_HTTP_CLIENT) private readonly http: HarnessHttpClient,
  ) {}

  async create(input: CreateHarnessInput) {
    if (!input.harnessId.startsWith('custom:')) {
      throw new BadRequestException(
        "Custom harness IDs must start with 'custom:'",
      );
    }
    return this.repo.save({
      ...input,
      source: 'custom',
      enabled: true,
      defaultEnv: input.defaultEnv ?? {},
      policyScope: input.policyScope ?? {},
    });
  }

  async update(harnessId: string, patch: Partial<CreateHarnessInput>) {
    if (!harnessId.startsWith('custom:')) {
      throw new BadRequestException('Cannot edit a builtin harness');
    }
    const existing = await this.repo.findByHarnessId(harnessId);
    if (!existing)
      throw new NotFoundException(`Harness ${harnessId} not found`);
    if (patch.displayName !== undefined)
      existing.displayName = patch.displayName;
    if (patch.imageRef !== undefined) existing.imageRef = patch.imageRef;
    if (patch.transport !== undefined) existing.transport = patch.transport;
    if (patch.capabilities !== undefined)
      existing.capabilities = patch.capabilities;
    if (patch.defaultEnv !== undefined) existing.defaultEnv = patch.defaultEnv;
    if (patch.policyScope !== undefined)
      existing.policyScope = patch.policyScope;
    return this.repo.save(existing);
  }

  async remove(harnessId: string) {
    if (!harnessId.startsWith('custom:')) {
      throw new BadRequestException('Cannot remove a builtin harness');
    }
    return this.repo.remove(harnessId);
  }

  list() {
    return this.repo.find();
  }

  async detail(harnessId: string) {
    const e = await this.repo.findByHarnessId(harnessId);
    if (!e) throw new NotFoundException(`Harness ${harnessId} not found`);
    return e;
  }

  async validate(
    harnessId: string,
    scopeNodeId?: string,
  ): Promise<HarnessValidateResult> {
    const def = await this.repo.findByHarnessId(harnessId);
    if (!def) throw new NotFoundException(`Harness ${harnessId} not found`);

    if (def.transport === 'external') {
      return this.probeExternal(harnessId, def.endpointConfig);
    }
    return this.probeKernel(
      def.harnessId as HarnessId,
      def.imageRef,
      scopeNodeId,
    );
  }

  private async probeExternal(
    harnessId: string,
    endpointConfig: Record<string, unknown> | null,
  ): Promise<HarnessValidateResult> {
    const baseUrl = this.readBaseUrl(endpointConfig);
    if (!baseUrl) {
      return { harnessId, reachable: false, credentialStatus: [] };
    }
    const res = await this.http.get(`${baseUrl}${HEALTH_PATH}`, {
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    if (!res.ok) {
      return { harnessId, reachable: false, credentialStatus: [] };
    }
    const capabilities = await this.readCapabilities(res);
    return {
      harnessId,
      reachable: true,
      ...(capabilities ? { capabilities } : {}),
      credentialStatus: [],
    };
  }

  private async probeKernel(
    harnessId: HarnessId,
    imageRef: string,
    scopeNodeId?: string,
  ): Promise<HarnessValidateResult> {
    const resolved = await this.credentialResolver.resolveAll({
      harnessId,
      ...(scopeNodeId ? { scopeNodeId } : {}),
    });
    const credentialStatus: HarnessCredentialStatus[] = Object.values(
      resolved,
    ).map((c) => ({ key: c.key, bound: true, authType: c.authType }));
    const hasImage = imageRef.trim().length > 0;
    const hasCredentials = credentialStatus.length > 0;
    return {
      harnessId,
      reachable: hasImage && hasCredentials,
      credentialStatus,
    };
  }

  private readBaseUrl(
    endpointConfig: Record<string, unknown> | null,
  ): string | null {
    const raw = endpointConfig?.['baseUrl'];
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
  }

  private async readCapabilities(res: {
    json: () => Promise<unknown>;
  }): Promise<Record<string, unknown> | undefined> {
    const body = await res.json().catch(() => null);
    if (body && typeof body === 'object' && 'capabilities' in body) {
      const caps = body.capabilities;
      if (caps && typeof caps === 'object')
        return caps as Record<string, unknown>;
    }
    return undefined;
  }
}

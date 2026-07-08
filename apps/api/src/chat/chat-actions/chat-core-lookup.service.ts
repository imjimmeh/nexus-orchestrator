import { randomUUID } from 'node:crypto';
import { BadGatewayException, Injectable, Optional } from '@nestjs/common';
import type { ServiceClientHttpOptions } from '@nexus/core';
import jwt from 'jsonwebtoken';
import {
  SERVICE_JWT_ROLES,
  SERVICE_JWT_SCOPES,
} from '../../config/service-jwt.constants';
import { RequestContextService } from '../common/request-context.service';
import {
  readAgentProfileLookups,
  readCoreErrorMessage,
  readProjectLookup,
  readWorkflowLookupSummaries,
  unwrapSuccessEnvelope,
} from './chat-to-core-action.utils';

const DEFAULT_CORE_BASE_URL = resolveDefaultCoreBaseUrl();
const SERVICE_TOKEN_SUBJECT = 'chat-service';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function resolveDefaultCoreBaseUrl(): string {
  const port = process.env.PORT?.trim() || '3000';
  return `http://127.0.0.1:${port}/api`;
}

@Injectable()
export class ChatCoreLookupService {
  private readonly httpOptions: ServiceClientHttpOptions;
  private readonly workflowResolutionCache = new Map<string, string>();

  constructor(
    @Optional() private readonly requestContext?: RequestContextService,
  ) {
    this.httpOptions = this.resolveHttpOptions();
  }

  async findProjectById(
    scopeId: string,
  ): Promise<{ id: string; name: string } | null> {
    const trimmedScopeId = scopeId.trim();
    if (!trimmedScopeId) {
      return null;
    }

    const response = await this.fetchJsonFromCore(
      `/projects/${encodeURIComponent(trimmedScopeId)}`,
      this.resolveCorrelationId(),
      {
        allowNotFound: true,
      },
    );
    if (!response) {
      return null;
    }

    return readProjectLookup(unwrapSuccessEnvelope(response));
  }

  async findActiveAgentProfileByName(profileName: string): Promise<{
    id: string;
    name: string;
    tier_preference: string | null;
  } | null> {
    const trimmedProfileName = profileName.trim();
    if (!trimmedProfileName) {
      return null;
    }

    const response = await this.fetchJsonFromCore(
      '/ai-config/agent-profiles',
      this.resolveCorrelationId(),
    );
    const profiles = readAgentProfileLookups(unwrapSuccessEnvelope(response));
    const matched = profiles.find(
      (profile) =>
        profile.name === trimmedProfileName ||
        profile.id === trimmedProfileName,
    );
    if (!matched?.isActive) {
      return null;
    }

    return {
      id: matched.id,
      name: matched.name,
      tier_preference: matched.tier_preference,
    };
  }

  async resolveActiveWorkflowId(identifier: string): Promise<string | null> {
    const trimmedIdentifier = identifier.trim();
    if (!trimmedIdentifier) {
      return null;
    }

    if (UUID_PATTERN.test(trimmedIdentifier)) {
      return trimmedIdentifier;
    }

    const normalizedIdentifier = this.normalizeIdentifier(trimmedIdentifier);
    const cached = this.workflowResolutionCache.get(normalizedIdentifier);
    if (cached) {
      return cached;
    }

    const resolvedWorkflowId =
      await this.resolveWorkflowIdFromCoreList(trimmedIdentifier);
    if (!resolvedWorkflowId) {
      return null;
    }

    this.workflowResolutionCache.set(normalizedIdentifier, resolvedWorkflowId);
    return resolvedWorkflowId;
  }

  private async resolveWorkflowIdFromCoreList(
    identifier: string,
  ): Promise<string | null> {
    const candidates = this.buildIdentifierCandidates(identifier);
    const correlationId = this.resolveCorrelationId();
    const limit = 100;
    let offset = 0;

    while (true) {
      const query = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
      });
      const response = await this.fetchJsonFromCore(
        `/workflows?${query.toString()}`,
        correlationId,
      );
      const workflows = readWorkflowLookupSummaries(
        unwrapSuccessEnvelope(response),
      );

      const matched = workflows.find((workflow) => {
        const identifiers = [
          workflow.id,
          workflow.name,
          workflow.definitionWorkflowId,
        ]
          .filter((value): value is string => typeof value === 'string')
          .map((value) => this.normalizeIdentifier(value));

        return identifiers.some((value) => candidates.has(value));
      });
      if (matched) {
        return matched.id;
      }

      if (workflows.length < limit) {
        return null;
      }

      offset += workflows.length;
    }
  }

  private buildIdentifierCandidates(identifier: string): Set<string> {
    return new Set([this.normalizeIdentifier(identifier)]);
  }

  private normalizeIdentifier(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '_');
  }

  private resolveCorrelationId(): string {
    return this.requestContext?.getRequestId() ?? randomUUID();
  }

  private resolveHttpOptions(): ServiceClientHttpOptions {
    const staticToken = this.readOptionalEnv('CHAT_CORE_BEARER_TOKEN');
    return {
      baseUrl:
        this.readOptionalEnv('CHAT_CORE_BASE_URL') ?? DEFAULT_CORE_BASE_URL,
      ...(staticToken
        ? { headers: { authorization: `Bearer ${staticToken}` } }
        : {
            authorizationHeaderResolver: () => {
              const token = this.resolveCoreJwtToken();
              return token ? `Bearer ${token}` : '';
            },
          }),
    };
  }

  private resolveCoreJwtToken(): string | null {
    const secret = this.readOptionalEnv('JWT_SECRET');
    if (!secret) {
      return null;
    }

    const audience =
      this.readOptionalEnv('CHAT_CORE_JWT_AUDIENCE') ?? 'nexus-core-internal';
    const issuer = this.readOptionalEnv('CHAT_CORE_JWT_ISSUER') ?? 'nexus-chat';
    const expiresIn = (this.readOptionalEnv('CHAT_CORE_JWT_TTL') ??
      '5m') as jwt.SignOptions['expiresIn'];

    return jwt.sign(
      {
        role: 'agent',
        roles: [...SERVICE_JWT_ROLES],
        service: 'chat',
        serviceScopes: [...SERVICE_JWT_SCOPES],
      },
      secret,
      {
        audience,
        issuer,
        subject: SERVICE_TOKEN_SUBJECT,
        expiresIn,
      },
    );
  }

  private readOptionalEnv(key: string): string | null {
    const value = process.env[key];
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private async fetchJsonFromCore(
    path: string,
    correlationId: string,
    options?: {
      allowNotFound?: boolean;
    },
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      'x-correlation-id': correlationId,
    };

    const authorization = await this.resolveAuthorizationHeader();
    if (authorization) {
      headers.authorization = authorization;
    }

    const response = await fetch(`${this.httpOptions.baseUrl}${path}`, {
      method: 'GET',
      headers,
    });
    const body = await this.parseResponseBody(response);

    if (response.status === 404 && options?.allowNotFound) {
      return null;
    }

    if (!response.ok) {
      const message = readCoreErrorMessage(body) ?? response.statusText;
      throw new BadGatewayException(message);
    }

    return body;
  }

  private async resolveAuthorizationHeader(): Promise<string | null> {
    const staticAuthorization = this.httpOptions.headers?.authorization;
    if (typeof staticAuthorization === 'string' && staticAuthorization.trim()) {
      return staticAuthorization;
    }

    if (!this.httpOptions.authorizationHeaderResolver) {
      return null;
    }

    const resolved = await this.httpOptions.authorizationHeaderResolver();
    const trimmed = resolved.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private async parseResponseBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
}

import { Injectable } from '@nestjs/common';
import { IToolRegistry } from '@nexus/core';

type ToolPayloadInput = Partial<IToolRegistry> & {
  mcp_server_id?: string | null;
  tierRestriction?: number;
  runtimeOwner?: IToolRegistry['runtime_owner'];
  apiCallback?: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    pathTemplate: string;
    bodyMapping?: Record<string, string>;
  };
};

@Injectable()
export class ToolPayloadMapper {
  toCreatePayload(data: ToolPayloadInput): ToolPayloadInput {
    const payload: Record<string, unknown> = {};
    this.assignIfDefined(payload, 'name', data.name);
    this.assignIfDefined(payload, 'description', data.description);
    this.assignIfDefined(payload, 'metadata', data.metadata);
    this.assignIfDefined(payload, 'schema', data.schema);
    this.assignIfDefined(payload, 'typescript_code', data.typescript_code);
    this.assignIfDefined(
      payload,
      'tier_restriction',
      this.resolveTierRestriction(data),
    );
    // source is server-computed provenance (built-in/MCP/ACP/manual) — never
    // exposed as writable input, but must survive from the registrar/service
    // layer through to the persisted row.
    this.assignIfDefined(payload, 'source', data.source);
    this.assignIfDefined(payload, 'language', data.language);
    this.assignIfDefined(
      payload,
      'runtime_owner',
      data.runtime_owner ?? data.runtimeOwner,
    );
    this.assignIfDefined(payload, 'transport', data.transport);
    this.assignIfDefined(
      payload,
      'publication_status',
      data.publication_status,
    );
    this.assignIfDefined(
      payload,
      'published_artifact_id',
      data.published_artifact_id,
    );
    this.assignIfDefined(payload, 'published_version', data.published_version);
    this.assignIfDefined(payload, 'mcp_server_id', data.mcp_server_id);
    if (
      Object.hasOwn(data, 'api_callback') ||
      Object.hasOwn(data, 'apiCallback')
    ) {
      payload.api_callback = this.resolveApiCallback(data);
    }
    return payload;
  }

  toUpdatePayload(data: ToolPayloadInput): ToolPayloadInput {
    return this.pickUpdateFields(data, true);
  }

  private pickUpdateFields(
    data: ToolPayloadInput,
    includeName: boolean,
  ): ToolPayloadInput {
    const payload: Record<string, unknown> = {};
    this.assignIfDefined(payload, 'description', data.description);
    this.assignIfDefined(payload, 'metadata', data.metadata);
    this.assignIfDefined(payload, 'schema', data.schema);
    this.assignIfDefined(payload, 'typescript_code', data.typescript_code);
    this.assignIfDefined(
      payload,
      'tier_restriction',
      this.resolveTierRestriction(data),
    );
    this.assignIfDefined(payload, 'language', data.language);
    this.assignIfDefined(
      payload,
      'runtime_owner',
      data.runtime_owner ?? data.runtimeOwner,
    );
    this.assignIfDefined(payload, 'transport', data.transport);
    this.assignIfDefined(
      payload,
      'publication_status',
      data.publication_status,
    );
    this.assignIfDefined(
      payload,
      'published_artifact_id',
      data.published_artifact_id,
    );
    this.assignIfDefined(payload, 'published_version', data.published_version);
    this.assignIfDefined(payload, 'mcp_server_id', data.mcp_server_id);
    if (
      Object.hasOwn(data, 'api_callback') ||
      Object.hasOwn(data, 'apiCallback')
    ) {
      payload.api_callback = this.resolveApiCallback(data);
    }

    if (includeName) {
      this.assignIfDefined(payload, 'name', data.name);
    }

    return payload;
  }

  private assignIfDefined(
    payload: Record<string, unknown>,
    key: string,
    value: unknown,
  ): void {
    if (value !== undefined) {
      payload[key] = value;
    }
  }

  private resolveTierRestriction(data: ToolPayloadInput): number | undefined {
    return data.tier_restriction ?? data.tierRestriction;
  }

  private resolveApiCallback(
    data: ToolPayloadInput,
  ): ToolPayloadInput['api_callback'] {
    if (data.api_callback !== undefined) {
      return data.api_callback ?? null;
    }

    if (data.apiCallback === undefined) {
      return undefined;
    }

    return {
      method: data.apiCallback.method,
      path_template: data.apiCallback.pathTemplate,
      body_mapping: data.apiCallback.bodyMapping,
    };
  }
}

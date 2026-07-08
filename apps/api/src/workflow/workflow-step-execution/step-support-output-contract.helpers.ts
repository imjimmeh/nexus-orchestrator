import type {
  IJob,
  IToolRegistry,
  OutputContract,
  OutputContractTypeSchema,
} from '@nexus/core';

export function selectToolsForJob(
  tools: IToolRegistry[],
  job: IJob,
): IToolRegistry[] {
  const base =
    !job.tools || job.tools.length === 0
      ? tools
      : tools.filter((tool) => job.tools?.includes(tool.name));

  const outputToolIndex = base.findIndex(
    (tool) => tool.name === 'set_job_output',
  );
  if (outputToolIndex === -1) {
    return base;
  }

  const outputTool = base[outputToolIndex];
  if (!outputTool) {
    return base;
  }

  const enriched = buildJobOutputToolSchema(outputTool, job.output_contract);
  if (!enriched) {
    return base;
  }

  const replaced = [...base];
  replaced[outputToolIndex] = enriched;
  return replaced;
}

export function buildJobOutputToolSchema(
  tool: IToolRegistry,
  contract: OutputContract | undefined,
): IToolRegistry | undefined {
  if (!contract) {
    return undefined;
  }

  const required = contract.required ?? [];
  const optional = contract.optional ?? [];
  if (required.length === 0 && optional.length === 0) {
    return undefined;
  }

  const properties: Record<string, unknown> = {};
  for (const key of [...required, ...optional]) {
    properties[key] = buildJsonSchema(contract.types?.[key]);
  }

  const dataSchema: Record<string, unknown> = {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: true,
    description:
      'Native JSON object containing the output fields for this job. Required fields must be provided; optional fields may be omitted.',
  };

  const schema = {
    ...(tool.schema ?? {}),
    properties: {
      ...((tool.schema?.properties as Record<string, unknown> | undefined) ??
        {}),
      data: dataSchema,
    },
  };

  return {
    ...tool,
    schema,
  };
}

function buildJsonSchema(
  schema: OutputContractTypeSchema | undefined,
): Record<string, unknown> {
  if (schema === undefined) {
    return {};
  }

  if (typeof schema === 'string') {
    return { type: schema };
  }

  if (schema.type === 'array') {
    if (schema.items === undefined) {
      return { type: 'array' };
    }
    return {
      type: 'array',
      items: buildJsonSchema(schema.items),
    };
  }

  if (schema.type === 'object') {
    const properties: Record<string, unknown> = {};
    if (schema.properties !== undefined) {
      for (const [key, propertySchema] of Object.entries(schema.properties)) {
        properties[key] = buildJsonSchema(propertySchema);
      }
    }
    return {
      type: 'object',
      properties,
    };
  }

  return {};
}

import { isRecord } from '@nexus/core';

const WORKFLOW_DEFINITION_ID_REGEX = /^workflow_id:\s*(\S+)/m;

export function unwrapSuccessEnvelope(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  if (value.success === true && 'data' in value) {
    return value.data;
  }

  return value;
}

export function readCoreErrorMessage(value: unknown): string | null {
  if (!isRecord(value)) {
    return typeof value === 'string' && value.trim() ? value : null;
  }

  const message = value.message;
  if (typeof message === 'string' && message.trim()) {
    return message;
  }

  const error = value.error;
  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  return null;
}

export function readProjectLookup(
  value: unknown,
): { id: string; name: string } | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readNonEmptyString(value.id);
  const name = readNonEmptyString(value.name);
  if (!id || !name) {
    return null;
  }

  return { id, name };
}

export function readAgentProfileLookups(value: unknown): Array<{
  id: string;
  name: string;
  isActive: boolean;
  tier_preference: string | null;
}> {
  if (!Array.isArray(value)) {
    return [];
  }

  const profiles: Array<{
    id: string;
    name: string;
    isActive: boolean;
    tier_preference: string | null;
  }> = [];

  for (const item of value) {
    const profile = readAgentProfileLookup(item);
    if (profile) {
      profiles.push(profile);
    }
  }

  return profiles;
}

export function readWorkflowLookupSummaries(value: unknown): Array<{
  id: string;
  name: string;
  definitionWorkflowId: string | null;
}> {
  if (!Array.isArray(value)) {
    return [];
  }

  const workflows: Array<{
    id: string;
    name: string;
    definitionWorkflowId: string | null;
  }> = [];

  for (const item of value) {
    const workflow = readWorkflowLookupSummary(item);
    if (workflow) {
      workflows.push(workflow);
    }
  }

  return workflows;
}

function readAgentProfileLookup(value: unknown): {
  id: string;
  name: string;
  isActive: boolean;
  tier_preference: string | null;
} | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readNonEmptyString(value.id);
  const name = readNonEmptyString(value.name);
  const isActive = readBoolean(value.is_active ?? value.isActive);
  if (!id || !name || isActive === null) {
    return null;
  }

  const tierPreference =
    readNonEmptyString(value.tier_preference) ??
    readNonEmptyString(value.tierPreference);

  return {
    id,
    name,
    isActive,
    tier_preference: tierPreference,
  };
}

function readWorkflowLookupSummary(value: unknown): {
  id: string;
  name: string;
  definitionWorkflowId: string | null;
} | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readNonEmptyString(value.id);
  const name = readNonEmptyString(value.name);
  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    definitionWorkflowId: extractWorkflowDefinitionId(value.yaml_definition),
  };
}

function extractWorkflowDefinitionId(yamlDefinition: unknown): string | null {
  if (typeof yamlDefinition !== 'string') {
    return null;
  }

  const match = WORKFLOW_DEFINITION_ID_REGEX.exec(yamlDefinition);
  if (!match || typeof match[1] !== 'string') {
    return null;
  }

  const workflowId = match[1].trim();
  return workflowId.length > 0 ? workflowId : null;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value !== 'boolean') {
    return null;
  }

  return value;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

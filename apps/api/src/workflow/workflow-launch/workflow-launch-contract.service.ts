import { Injectable } from '@nestjs/common';
import { isRecord, normalizeOptionalString } from '@nexus/core';
import type {
  IWorkflowDefinition,
  IWorkflowLaunchInput,
  WorkflowLaunchContext,
  WorkflowLaunchContextRequirement,
  WorkflowLaunchContract,
  WorkflowLaunchEligibility,
  WorkflowLaunchInputContract,
  WorkflowLaunchInputType,
  WorkflowLaunchValidationIssue,
  WorkflowLaunchValidationResult,
} from '@nexus/core';

const DEFAULT_CONTEXT: WorkflowLaunchContextRequirement = 'none';
const DEFAULT_INPUT_TYPE: WorkflowLaunchInputType = 'string';
const LEGACY_TARGET_CONTEXT = ['work', 'item'].join('_');

@Injectable()
export class WorkflowLaunchContractService {
  buildContract(definition: IWorkflowDefinition): WorkflowLaunchContract {
    const triggerType = definition.trigger?.type ?? 'manual';
    const launchMetadata = definition.trigger?.launch;

    return {
      workflowId: definition.workflow_id,
      workflowName: definition.name,
      triggerType,
      launchable: triggerType === 'manual',
      context: this.normalizeContextRequirement(launchMetadata?.context),
      inputs: this.normalizeInputs(launchMetadata?.inputs),
      allowRawJson: launchMetadata?.allow_raw_json !== false,
    };
  }

  evaluateEligibility(
    contract: WorkflowLaunchContract,
    context: WorkflowLaunchContext,
  ): WorkflowLaunchEligibility {
    const normalizedScopeId = normalizeOptionalString(context.scopeId);
    const normalizedContextId = normalizeOptionalString(context.contextId);
    const reasons: WorkflowLaunchEligibility['reasons'] = [];

    if (!contract.launchable) {
      reasons.push({
        code: 'WORKFLOW_NOT_MANUAL',
        message:
          'This workflow is not launchable on demand because its trigger type is not manual.',
      });
      return {
        eligible: false,
        reasons,
      };
    }

    if (contract.context === 'required' && !normalizedScopeId) {
      reasons.push({
        code: 'CONTEXT_REQUIRED',
        message: 'This workflow requires a context.',
      });
    }

    if (contract.context === 'required') {
      if (!normalizedScopeId) {
        reasons.push({
          code: 'CONTEXT_REQUIRED',
          message: 'This workflow requires a context.',
        });
      }

      if (!normalizedContextId) {
        reasons.push({
          code: 'CONTEXT_ID_REQUIRED',
          message: 'This workflow requires a target context item.',
        });
      }
    }

    return {
      eligible: reasons.length === 0,
      reasons,
    };
  }

  validateLaunchPayload(params: {
    contract: WorkflowLaunchContract;
    triggerData: unknown;
    context: WorkflowLaunchContext;
  }): WorkflowLaunchValidationResult {
    const issues: WorkflowLaunchValidationIssue[] = [];
    const normalizedTriggerData = this.normalizeTriggerData(
      params.triggerData,
      issues,
    );

    const explicitScopeId = normalizeOptionalString(params.context.scopeId);
    const explicitContextId = normalizeOptionalString(params.context.contextId);

    const payloadScopeId = normalizeOptionalString(
      normalizedTriggerData.scopeId,
    );
    const payloadContextId = normalizeOptionalString(
      normalizedTriggerData.contextId,
    );

    const normalizedScopeId = explicitScopeId ?? payloadScopeId;
    const normalizedContextId = explicitContextId ?? payloadContextId;

    if (normalizedScopeId) {
      normalizedTriggerData.scopeId = normalizedScopeId;
    }

    if (normalizedContextId) {
      normalizedTriggerData.contextId = normalizedContextId;
    }

    const eligibility = this.evaluateEligibility(params.contract, {
      scopeId: normalizedScopeId,
      contextId: normalizedContextId,
    });

    for (const reason of eligibility.reasons) {
      issues.push({
        code: reason.code,
        message: reason.message,
      });
    }

    for (const input of params.contract.inputs) {
      const inputValidationIssue = this.validateInputField(
        input,
        normalizedTriggerData,
      );
      if (!inputValidationIssue) {
        continue;
      }

      issues.push(inputValidationIssue);
    }

    return {
      valid: issues.length === 0,
      issues,
      normalizedTriggerData,
      normalizedContext: {
        scopeId: normalizedScopeId,
        contextId: normalizedContextId,
      },
    };
  }

  private normalizeTriggerData(
    triggerData: unknown,
    issues: WorkflowLaunchValidationIssue[],
  ): Record<string, unknown> {
    if (!isRecord(triggerData)) {
      if (triggerData !== undefined && triggerData !== null) {
        issues.push({
          code: 'INVALID_TRIGGER_DATA',
          message: 'trigger_data must be an object when provided.',
        });
      }

      return {};
    }

    return { ...triggerData };
  }

  private validateInputField(
    input: WorkflowLaunchInputContract,
    triggerData: Record<string, unknown>,
  ): WorkflowLaunchValidationIssue | null {
    const rawValue = triggerData[input.key];
    const hasValue = rawValue !== undefined && rawValue !== null;

    if (!hasValue) {
      if (input.default !== undefined) {
        triggerData[input.key] = input.default;
        return null;
      }

      if (!input.required) {
        return null;
      }

      return {
        code: 'MISSING_REQUIRED_INPUT',
        message: `Required launch input '${input.key}' is missing.`,
        field: input.key,
      };
    }

    if (input.type === 'string' && typeof rawValue === 'string') {
      const trimmed = rawValue.trim();
      if (input.required && trimmed.length === 0) {
        return {
          code: 'MISSING_REQUIRED_INPUT',
          message: `Required launch input '${input.key}' is missing.`,
          field: input.key,
        };
      }

      triggerData[input.key] = trimmed;
      return null;
    }

    if (this.isValidInputType(input.type, rawValue)) {
      return null;
    }

    return {
      code: 'INVALID_INPUT_TYPE',
      message: `Launch input '${input.key}' is not a valid ${input.type} value.`,
      field: input.key,
    };
  }

  private isValidInputType(
    type: WorkflowLaunchInputType,
    value: unknown,
  ): boolean {
    if (type === 'string') {
      return typeof value === 'string';
    }

    if (type === 'number') {
      return typeof value === 'number' && Number.isFinite(value);
    }

    if (type === 'boolean') {
      return typeof value === 'boolean';
    }

    if (type === 'json') {
      return true;
    }

    if (type === 'string_array') {
      return (
        Array.isArray(value) &&
        value.every((entry) => typeof entry === 'string')
      );
    }

    return false;
  }

  private normalizeInputs(
    inputs: IWorkflowLaunchInput[] | undefined,
  ): WorkflowLaunchInputContract[] {
    if (!Array.isArray(inputs) || inputs.length === 0) {
      return [];
    }

    const normalized: WorkflowLaunchInputContract[] = [];
    const seenKeys = new Set<string>();

    for (const input of inputs) {
      const key = normalizeOptionalString(input.key);
      if (!key || seenKeys.has(key)) {
        continue;
      }

      seenKeys.add(key);

      normalized.push({
        key,
        label: normalizeOptionalString(input.label) ?? key,
        description: normalizeOptionalString(input.description) ?? undefined,
        type: this.normalizeInputType(input.type),
        required: input.required === true,
        default: input.default,
      });
    }

    return normalized;
  }

  private normalizeContextRequirement(
    value: string | undefined,
  ): WorkflowLaunchContextRequirement {
    if (value === 'none') {
      return 'none';
    }

    if (
      value === 'required' ||
      value === 'project' ||
      value === LEGACY_TARGET_CONTEXT
    ) {
      return 'required';
    }

    return DEFAULT_CONTEXT;
  }

  private normalizeInputType(
    value: string | undefined,
  ): WorkflowLaunchInputType {
    if (
      value === 'string' ||
      value === 'number' ||
      value === 'boolean' ||
      value === 'json' ||
      value === 'string_array'
    ) {
      return value;
    }

    return DEFAULT_INPUT_TYPE;
  }
}

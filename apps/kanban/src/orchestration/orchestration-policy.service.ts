import { BadRequestException, Injectable } from "@nestjs/common";
import {
  ORCHESTRATION_POLICY_REGISTRY,
  autonomyValuesForMode,
  findPolicyDescriptor,
  modeFromAutonomyValues,
  validatePolicyEntry,
  type OrchestrationPolicyMode,
} from "@nexus/kanban-contracts";
import { CoreVariablesClientService } from "../core/core-variables-client.service";
import type { ResolvedPolicyEntry } from "./orchestration-policy.types";
import { OrchestrationService } from "./orchestration.service";

export type { ResolvedPolicyEntry };

const DEFAULT_LAYER = "default";

@Injectable()
export class OrchestrationPolicyService {
  constructor(
    private readonly variablesClient: CoreVariablesClientService,
    private readonly orchestration: OrchestrationService,
  ) {}

  async resolvePolicy(projectId: string): Promise<ResolvedPolicyEntry[]> {
    const effective = await this.variablesClient.getEffective(projectId);
    const byKey = new Map(effective.map((v) => [v.key, v]));

    return ORCHESTRATION_POLICY_REGISTRY.map((descriptor) => {
      const resolved = byKey.get(descriptor.key);
      return {
        key: descriptor.key,
        value: (resolved?.value ?? descriptor.defaultValue) as
          | string
          | number
          | boolean,
        layer: resolved?.layer ?? DEFAULT_LAYER,
        defaultValue: descriptor.defaultValue,
        descriptor,
      };
    });
  }

  async updatePolicy(
    projectId: string,
    entries: Array<{ key: string; value: unknown }>,
  ): Promise<ResolvedPolicyEntry[]> {
    for (const entry of entries) {
      const result = validatePolicyEntry(entry.key, entry.value);
      if (!result.ok) {
        throw new BadRequestException(result.error);
      }
    }

    // All keys are known-valid: the validation loop above would have thrown
    // BadRequestException on any unknown key before we reach this point.
    for (const entry of entries) {
      const descriptor = findPolicyDescriptor(entry.key);
      if (descriptor === undefined) {
        throw new BadRequestException(`Unknown policy key: ${entry.key}`);
      }
      await this.variablesClient.upsert({
        scopeNodeId: projectId,
        key: entry.key,
        value: entry.value,
        valueType: descriptor.valueType,
      });
    }

    const writtenPatch = Object.fromEntries(
      entries.map((e) => [e.key, e.value]),
    );
    return this.refreshAndMirror(projectId, undefined, writtenPatch);
  }

  async applyPreset(
    projectId: string,
    mode: OrchestrationPolicyMode,
  ): Promise<ResolvedPolicyEntry[]> {
    const autonomy = autonomyValuesForMode(mode);
    for (const [key, value] of Object.entries(autonomy)) {
      await this.variablesClient.upsert({
        scopeNodeId: projectId,
        key,
        value,
        valueType: "string",
      });
    }
    return this.refreshAndMirror(projectId, mode);
  }

  private async refreshAndMirror(
    projectId: string,
    explicitMode?: OrchestrationPolicyMode,
    writtenPatch?: Record<string, unknown>,
  ): Promise<ResolvedPolicyEntry[]> {
    const policy = await this.resolvePolicy(projectId);
    const values = Object.fromEntries(policy.map((p) => [p.key, p.value]));
    const effectiveValues = writtenPatch
      ? { ...values, ...writtenPatch }
      : values;
    const mode = explicitMode ?? modeFromAutonomyValues(effectiveValues);
    await this.orchestration.setModeMirror(projectId, mode);
    return policy;
  }
}

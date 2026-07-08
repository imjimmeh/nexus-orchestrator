import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  IHostMountBinding,
  IToolRegistry,
  SDK_TOOL_ALLOWLIST_FILENAME,
  ToolPolicyEffect,
} from '@nexus/core';
import { IAMPolicyService } from '../security/iam-policy.service';
import { PolicyEngineService } from '../capability-governance/policy-engine.service';
import type { ProfileDecision } from '../capability-governance/policy-engine.service.types';
import { COMPANION_TOOLS } from '../workflow/workflow-step-execution/companion-tool.helpers';

import { ToolPolicyEvaluatorService } from '../capability-governance/tool-policy-evaluator.service';

const SDK_ALLOWLIST_PERSIST_FLAG = 'NEXUS_PERSIST_SDK_TOOL_ALLOWLIST';
const SDK_ALLOWLIST_DIAGNOSTICS_PATH_ENV =
  'NEXUS_SDK_TOOL_ALLOWLIST_DIAGNOSTICS_PATH';

function atomicWriteFileSync(filePath: string, content: string): void {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, content, { encoding: 'utf8', flag: 'w' });
  fs.renameSync(tmpPath, filePath);
}

function sanitizePathSegment(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .replaceAll(/[^a-zA-Z0-9._-]+/g, '_')
    .replaceAll(/_+/g, '_')
    .replaceAll(/^[_-]+/g, '')
    .replaceAll(/[_-]+$/g, '');

  return normalized.length > 0 ? normalized : fallback;
}

function isFeatureEnabled(flagName: string): boolean {
  const rawValue = process.env[flagName]?.trim().toLowerCase();
  if (!rawValue) {
    return true;
  }

  return !['0', 'false', 'off', 'no'].includes(rawValue);
}

@Injectable()
export class ToolMountingService {
  private readonly logger = new Logger(ToolMountingService.name);
  private readonly baseTmpDir = path.join(os.tmpdir(), 'nexus-tools');

  constructor(
    private readonly iamPolicy: IAMPolicyService,
    private readonly policyEngine: PolicyEngineService,
    private readonly toolPolicyEvaluator: ToolPolicyEvaluatorService,
  ) {
    if (!fs.existsSync(this.baseTmpDir)) {
      fs.mkdirSync(this.baseTmpDir, { recursive: true });
    }
  }

  prepareToolMount(
    mountKey: string,
    tools: IToolRegistry[],
    agentProfile?: string,
  ): string {
    const mountDir = path.join(this.baseTmpDir, mountKey);

    if (fs.existsSync(mountDir)) {
      fs.rmSync(mountDir, { recursive: true, force: true });
    }
    fs.mkdirSync(mountDir, { recursive: true });

    const exports: string[] = [];

    for (const tool of tools) {
      if (agentProfile && !this.canProfileUseTool(agentProfile, tool.name)) {
        throw new ForbiddenException(
          `Profile ${agentProfile} is not allowed to mount tool ${tool.name}`,
        );
      }

      const toolFileName = `${tool.name}.ts`;
      const toolFilePath = path.join(mountDir, toolFileName);

      const wrappedCode = `
/**
 * @name ${tool.name}
 * @tier ${tool.tier_restriction.toString()}
 */
${tool.typescript_code}

export const metadata = ${JSON.stringify({
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        ...(tool.metadata ? { metadata: tool.metadata } : {}),
        schema: tool.schema,
        tier: tool.tier_restriction,
        runtimeOwner: tool.runtime_owner,
        transport: tool.transport,
        ...(tool.api_callback ? { api_callback: tool.api_callback } : {}),
      })};
      `;

      atomicWriteFileSync(toolFilePath, wrappedCode);
      exports.push(`export * as ${tool.name} from './${tool.name}';`);
    }

    atomicWriteFileSync(path.join(mountDir, 'index.ts'), exports.join('\n'));

    this.logger.log(
      `Prepared tool mount at ${mountDir} with ${tools.length.toString()} tools`,
    );
    return mountDir;
  }

  writeSdkToolAllowlist(
    mountDir: string,
    toolNames: string[],
    runtimeContext?: {
      workflowRunId?: string;
      jobId?: string;
      stepId?: string;
    },
    companionTools?: string[],
  ): void {
    if (
      toolNames.length === 0 &&
      (!companionTools || companionTools.length === 0)
    ) {
      return;
    }
    const finalToolNames = this.resolveAllowedTools(toolNames, companionTools);
    const filePath = path.join(mountDir, SDK_TOOL_ALLOWLIST_FILENAME);
    atomicWriteFileSync(filePath, JSON.stringify(finalToolNames));
    this.logger.log(
      `Wrote SDK tool allowlist to ${mountDir}: ${finalToolNames.join(', ')}`,
    );

    if (!isFeatureEnabled(SDK_ALLOWLIST_PERSIST_FLAG)) {
      return;
    }

    const workflowRunId = runtimeContext?.workflowRunId?.trim();
    if (!workflowRunId) {
      return;
    }

    this.persistSdkToolAllowlistDiagnostics({
      mountDir,
      toolNames,
      workflowRunId,
      jobId: runtimeContext?.jobId,
      stepId: runtimeContext?.stepId,
    });
  }

  private resolveAllowedTools(
    toolNames: string[],
    companionTools?: string[],
  ): string[] {
    const allTools = new Set<string>(toolNames);
    if (companionTools) {
      for (const companionTool of companionTools) {
        allTools.add(companionTool);
      }
    }
    for (const [primaryTool, companionTool] of Object.entries(
      COMPANION_TOOLS,
    )) {
      if (allTools.has(primaryTool) && !allTools.has(companionTool)) {
        allTools.add(companionTool);
      }
    }
    return [...allTools];
  }

  writeHostMountScopeManifest(
    mountDir: string,
    bindings: IHostMountBinding[],
  ): void {
    if (bindings.length === 0) {
      return;
    }

    const filePath = path.join(mountDir, '_host_mount_scope.json');
    atomicWriteFileSync(filePath, JSON.stringify(bindings));
    this.logger.log(
      `Wrote host mount scope manifest to ${mountDir} (${bindings.length.toString()} mounts)`,
    );
  }

  canProfileUseTool(agentProfile: string, toolName: string): boolean {
    const profile = this.iamPolicy.getProfile(agentProfile);
    if (!profile) {
      this.logger.warn(`Access denied: Unknown profile ${agentProfile}`);
      return false;
    }

    const normalized = toolName.trim();
    let profileDecision: ProfileDecision = 'unchecked';
    if (profile.toolPolicy) {
      const decision = this.toolPolicyEvaluator.evaluate(
        normalized,
        {},
        profile.toolPolicy,
      );
      if (decision.effect === ToolPolicyEffect.ALLOW) {
        profileDecision = 'allow';
      } else if (
        decision.effect === ToolPolicyEffect.DENY ||
        decision.effect === ToolPolicyEffect.GUARDRAIL_DENY
      ) {
        profileDecision = 'deny';
      } else if (decision.effect === ToolPolicyEffect.REQUIRE_APPROVAL) {
        profileDecision = 'approval_required';
      }
    }

    const result = this.policyEngine.decide({
      capabilityName: toolName,
      isRegistered: true,
      profileDecision,
    });

    const isAllowed = result.status !== 'deny';

    if (!isAllowed) {
      this.logger.warn(
        `Access denied: Profile ${agentProfile} attempted to use unauthorized tool ${toolName}`,
      );
    }

    return isAllowed;
  }

  cleanupToolMount(mountKey: string): void {
    const mountDir = path.join(this.baseTmpDir, mountKey);
    if (fs.existsSync(mountDir)) {
      try {
        fs.rmSync(mountDir, { recursive: true, force: true });
        this.logger.log(`Cleaned up tool mount for ${mountKey}`);
      } catch (e) {
        const error = e as Error;
        this.logger.error(
          `Failed to cleanup tool mount ${mountDir}: ${error.message}`,
        );
      }
    }
  }

  private persistSdkToolAllowlistDiagnostics(params: {
    mountDir: string;
    toolNames: string[];
    workflowRunId: string;
    jobId?: string;
    stepId?: string;
  }): void {
    const diagnosticsRoot =
      process.env[SDK_ALLOWLIST_DIAGNOSTICS_PATH_ENV]?.trim() ||
      path.join(process.cwd(), 'storage', 'tool-runtime', 'sdk-allowlists');
    fs.mkdirSync(diagnosticsRoot, { recursive: true });

    const diagnosticsPath = path.join(
      diagnosticsRoot,
      [
        sanitizePathSegment(params.workflowRunId, 'workflow-run'),
        sanitizePathSegment(params.jobId ?? 'job', 'job'),
        sanitizePathSegment(params.stepId ?? 'step', 'step'),
      ].join('-') + '.json',
    );

    atomicWriteFileSync(
      diagnosticsPath,
      JSON.stringify(
        {
          workflowRunId: params.workflowRunId,
          jobId: params.jobId ?? null,
          stepId: params.stepId ?? null,
          mountDir: params.mountDir,
          toolNames: params.toolNames,
          persistedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    this.logger.log(
      `Persisted SDK tool allowlist diagnostics to ${diagnosticsPath}`,
    );
  }
}

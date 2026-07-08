import { ToolPolicyEffect } from '@nexus/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ToolMountingService } from '../tool-runtime/tool-mounting.service';
import { IAMPolicyService } from '../security/iam-policy.service';
import { PolicyEngineService } from '../capability-governance/policy-engine.service';

import { ToolPolicyEvaluatorService } from '../capability-governance/tool-policy-evaluator.service';

describe('ToolMountingService - SDK tool allowlist integration', () => {
  let service: ToolMountingService;
  let tempDir: string;
  let iamPolicyServiceMock: any;
  const originalPersistFlag = process.env.NEXUS_PERSIST_SDK_TOOL_ALLOWLIST;
  const originalDiagnosticsPath =
    process.env.NEXUS_SDK_TOOL_ALLOWLIST_DIAGNOSTICS_PATH;

  beforeEach(async () => {
    iamPolicyServiceMock = {
      evaluateAccess: vi.fn(),
      getProfile: vi.fn(),
    };

    service = new ToolMountingService(
      iamPolicyServiceMock,
      new PolicyEngineService(),
      new ToolPolicyEvaluatorService(),
    );

    // Re-route the baseTmpDir to an isolated test folder
    tempDir = path.join(os.tmpdir(), `nexus-tools-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    // @ts-expect-error - overriding private field for testing
    service.baseTmpDir = tempDir;
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    if (originalPersistFlag === undefined) {
      delete process.env.NEXUS_PERSIST_SDK_TOOL_ALLOWLIST;
    } else {
      process.env.NEXUS_PERSIST_SDK_TOOL_ALLOWLIST = originalPersistFlag;
    }

    if (originalDiagnosticsPath === undefined) {
      delete process.env.NEXUS_SDK_TOOL_ALLOWLIST_DIAGNOSTICS_PATH;
    } else {
      process.env.NEXUS_SDK_TOOL_ALLOWLIST_DIAGNOSTICS_PATH =
        originalDiagnosticsPath;
    }
  });

  it('writes _sdk_tool_allowlist.json with correct content', () => {
    const mountDir = path.join(tempDir, 'mount-1');
    fs.mkdirSync(mountDir, { recursive: true });

    service.writeSdkToolAllowlist(mountDir, ['read', 'bash']);

    const filePath = path.join(mountDir, '_sdk_tool_allowlist.json');
    expect(fs.existsSync(filePath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(content).toEqual(['read', 'bash']);
  });

  it('preserves full SDK-native tool list in allowlist file and diagnostics', () => {
    const fullSdkToolList = [
      'read',
      'write',
      'edit',
      'bash',
      'ls',
      'find',
      'grep',
    ];
    const mountDir = path.join(tempDir, 'mount-full-sdk');
    const diagnosticsDir = path.join(tempDir, 'diagnostics-full-sdk');
    fs.mkdirSync(mountDir, { recursive: true });
    fs.mkdirSync(diagnosticsDir, { recursive: true });
    process.env.NEXUS_SDK_TOOL_ALLOWLIST_DIAGNOSTICS_PATH = diagnosticsDir;
    delete process.env.NEXUS_PERSIST_SDK_TOOL_ALLOWLIST;

    service.writeSdkToolAllowlist(mountDir, fullSdkToolList, {
      workflowRunId: 'run-sdk-test',
      jobId: 'sdk-verification',
      stepId: 'sdk-verification',
    });

    const filePath = path.join(mountDir, '_sdk_tool_allowlist.json');
    expect(fs.existsSync(filePath)).toBe(true);

    const fileContent = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(fileContent).toEqual([
      'read',
      'write',
      'edit',
      'bash',
      'ls',
      'find',
      'grep',
    ]);

    const diagnosticsPath = path.join(
      diagnosticsDir,
      'run-sdk-test-sdk-verification-sdk-verification.json',
    );
    expect(fs.existsSync(diagnosticsPath)).toBe(true);

    const diagnosticsContent = JSON.parse(
      fs.readFileSync(diagnosticsPath, 'utf8'),
    );
    expect(diagnosticsContent.toolNames).toEqual([
      'read',
      'write',
      'edit',
      'bash',
      'ls',
      'find',
      'grep',
    ]);
    expect(diagnosticsContent.workflowRunId).toBe('run-sdk-test');
    expect(diagnosticsContent.jobId).toBe('sdk-verification');
    expect(diagnosticsContent.stepId).toBe('sdk-verification');
  });

  it('persists sdk allowlist diagnostics by default when workflow context exists', () => {
    const mountDir = path.join(tempDir, 'mount-1');
    const diagnosticsDir = path.join(tempDir, 'diagnostics');
    fs.mkdirSync(mountDir, { recursive: true });
    process.env.NEXUS_SDK_TOOL_ALLOWLIST_DIAGNOSTICS_PATH = diagnosticsDir;

    service.writeSdkToolAllowlist(mountDir, ['read', 'ls'], {
      workflowRunId: 'run-1',
      jobId: 'repository_analysis',
      stepId: 'analyze_repository',
    });

    const diagnosticsPath = path.join(
      diagnosticsDir,
      'run-1-repository_analysis-analyze_repository.json',
    );
    expect(fs.existsSync(diagnosticsPath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(diagnosticsPath, 'utf8'));
    expect(content).toEqual(
      expect.objectContaining({
        workflowRunId: 'run-1',
        jobId: 'repository_analysis',
        stepId: 'analyze_repository',
        mountDir,
        toolNames: ['read', 'ls'],
      }),
    );
  });

  it('does not persist sdk allowlist diagnostics when disabled', () => {
    const mountDir = path.join(tempDir, 'mount-1');
    const diagnosticsDir = path.join(tempDir, 'diagnostics');
    fs.mkdirSync(mountDir, { recursive: true });
    process.env.NEXUS_SDK_TOOL_ALLOWLIST_DIAGNOSTICS_PATH = diagnosticsDir;
    process.env.NEXUS_PERSIST_SDK_TOOL_ALLOWLIST = 'false';

    service.writeSdkToolAllowlist(mountDir, ['read'], {
      workflowRunId: 'run-1',
      jobId: 'repository_analysis',
      stepId: 'analyze_repository',
    });

    const diagnosticsPath = path.join(
      diagnosticsDir,
      'run-1-repository_analysis-analyze_repository.json',
    );
    expect(fs.existsSync(diagnosticsPath)).toBe(false);
  });

  it('does not create file when tool list is empty', () => {
    const mountDir = path.join(tempDir, 'mount-2');
    fs.mkdirSync(mountDir, { recursive: true });

    service.writeSdkToolAllowlist(mountDir, []);

    const filePath = path.join(mountDir, '_sdk_tool_allowlist.json');
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('writes tool description and metadata into mounted tool metadata', () => {
    iamPolicyServiceMock.getProfile.mockReturnValue({
      name: 'ceo-agent',
      toolPolicy: {
        default: ToolPolicyEffect.DENY,
        rules: [
          {
            effect: ToolPolicyEffect.ALLOW,
            tool: 'delegate_goal_backlog_planning',
          },
        ],
      },
    });

    const mountDir = service.prepareToolMount(
      'mount-metadata',
      [
        {
          id: 'tool-1',
          name: 'delegate_goal_backlog_planning',
          description: 'Launch goal backlog planning.',
          metadata: { projectionId: 'ceo.goal_backlog' },
          schema: { type: 'object' },
          typescript_code: 'export async function execute() { return {}; }',
          tier_restriction: 1,
          runtime_owner: 'api',
          transport: 'api_callback',
          created_at: new Date('2026-05-22T00:00:00.000Z'),
          updated_at: new Date('2026-05-22T00:00:00.000Z'),
        } as never,
      ],
      'ceo-agent',
    );

    const toolSource = fs.readFileSync(
      path.join(mountDir, 'delegate_goal_backlog_planning.ts'),
      'utf8',
    );
    expect(toolSource).toContain(
      '"description":"Launch goal backlog planning."',
    );
    expect(toolSource).toContain(
      '"metadata":{"projectionId":"ceo.goal_backlog"}',
    );
  });

  it('allows SDK-native tools explicitly granted by profile', () => {
    iamPolicyServiceMock.getProfile.mockReturnValue({
      name: 'spec-generator',
      tier: 'HEAVY',
      toolPolicy: {
        default: ToolPolicyEffect.DENY,
        rules: [
          { effect: ToolPolicyEffect.ALLOW, tool: 'read' },
          { effect: ToolPolicyEffect.ALLOW, tool: 'write' },
          { effect: ToolPolicyEffect.ALLOW, tool: 'edit' },
          { effect: ToolPolicyEffect.ALLOW, tool: 'bash' },
        ],
      },
    });

    expect(service.canProfileUseTool('spec-generator', 'read')).toBe(true);
    expect(service.canProfileUseTool('spec-generator', 'write')).toBe(true);
    expect(service.canProfileUseTool('spec-generator', 'edit')).toBe(true);
    expect(service.canProfileUseTool('spec-generator', 'bash')).toBe(true);
  });
});

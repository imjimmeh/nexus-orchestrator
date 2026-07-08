import { ToolPolicyEffect } from '@nexus/core';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ToolApprovalRuleRepository } from '../../../tool/database/repositories/tool-approval-rule.repository';
import { ToolApprovalRulesSeedService } from './tool-approval-rules.seed';

type MockToolApprovalRuleRepository = {
  create: Mock;
  findOne: Mock;
  save: Mock;
};

describe('ToolApprovalRulesSeedService', () => {
  const expectedSeedDefinition = {
    scopeType: 'agent_profile',
    scopeId: 'investigation-subagent',
    toolName: 'bash',
    rules: [
      {
        effect: ToolPolicyEffect.DENY,
        priority: 300,
        argumentPatterns: [
          {
            path: 'command',
            operator: 'regex',
            value:
              '(^|\\s)(rm|mv|cp|touch|mkdir|rmdir|chmod|chown|git|npm|pnpm|yarn|docker|curl|wget|python|node|perl|ssh|ps|kill|tee)(\\s|$)|[>;`]|\\$\\(|\\|\\||&&|\\||\\bfind\\b.*\\s-(delete|exec|execdir|ok|okdir)\\b|\\bsed\\b.*(\\s-i\\b|(^|[\\s;])[0-9,$!{}\\s]*[we]\\b)',
          },
        ],
      },
      {
        effect: ToolPolicyEffect.ALLOW,
        priority: 200,
        argumentPatterns: [
          {
            path: 'command',
            operator: 'regex',
            value: '^\\s*(ls|find|grep|rg|pwd|sed\\s+-n|head|tail|wc|cat)\\b',
          },
        ],
      },
      {
        effect: ToolPolicyEffect.DENY,
        priority: 100,
        argumentPatterns: null,
      },
    ],
  };

  const additionalSeedDefinition = {
    scopeType: 'project',
    scopeId: 'tooling',
    toolName: 'sh',
    rules: [
      {
        effect: ToolPolicyEffect.ALLOW,
        priority: 250,
        argumentPatterns: [
          {
            path: 'command',
            operator: 'glob',
            value: 'ls*',
          },
        ],
      },
    ],
  };

  let repository: MockToolApprovalRuleRepository;
  let service: ToolApprovalRulesSeedService;
  let tempRoot: string;
  let seedDirectory: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-approval-rules-'));
    seedDirectory = path.join(tempRoot, 'seed', 'tool-approval-rules');
    process.env.NEXUS_TOOL_APPROVAL_RULES_SEED_PATH = seedDirectory;

    repository = {
      create: vi.fn((value) => value),
      findOne: vi.fn(),
      save: vi.fn(),
    };
    service = new ToolApprovalRulesSeedService(
      repository as unknown as ToolApprovalRuleRepository,
    );
  });

  afterEach(() => {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }

    delete process.env.NEXUS_TOOL_APPROVAL_RULES_SEED_PATH;

    vi.restoreAllMocks();
  });

  const writeSeedFile = (fileName: string, definition: object): void => {
    const filePath = path.join(seedDirectory, fileName);
    fs.writeFileSync(filePath, JSON.stringify(definition), 'utf8');
  };

  it('seeds argument-aware rules from both .seed.json and plain .json artifacts', async () => {
    const seedDirectory = process.env.NEXUS_TOOL_APPROVAL_RULES_SEED_PATH;
    if (!seedDirectory) {
      throw new Error('Seed directory env var must be set');
    }

    fs.mkdirSync(seedDirectory, { recursive: true });
    writeSeedFile(
      'investigation-subagent-bash.seed.json',
      expectedSeedDefinition,
    );
    writeSeedFile('additional-shell-rules.json', additionalSeedDefinition);

    repository.findOne.mockResolvedValue(null);

    await service.seed();

    expect(repository.create).toHaveBeenCalledTimes(4);
    expect(repository.save).toHaveBeenCalledTimes(4);

    const expectedUpserts = [
      ...additionalSeedDefinition.rules.map((rule) => ({
        ...rule,
        scopeType: additionalSeedDefinition.scopeType,
        scopeId: additionalSeedDefinition.scopeId,
        toolName: additionalSeedDefinition.toolName,
      })),
      ...expectedSeedDefinition.rules.map((rule) => ({
        ...rule,
        scopeType: expectedSeedDefinition.scopeType,
        scopeId: expectedSeedDefinition.scopeId,
        toolName: expectedSeedDefinition.toolName,
      })),
    ];

    const createCalls = repository.create.mock.calls.map(([value]) => value);

    expect(createCalls).toEqual(expectedUpserts);

    expect(repository.create).toHaveBeenNthCalledWith(1, expectedUpserts[0]);
  });

  it('loads global scope seeds and normalizes scopeId to null', async () => {
    fs.mkdirSync(seedDirectory, { recursive: true });

    writeSeedFile('global-explicit-null-scopeid.json', {
      scopeType: 'global',
      scopeId: null,
      toolName: 'bash',
      rules: [
        {
          effect: ToolPolicyEffect.ALLOW,
          priority: 5,
          argumentPatterns: [
            {
              path: 'command',
              operator: 'eq',
              value: 'ls',
            },
          ],
        },
      ],
    });

    writeSeedFile('global-missing-scopeid.json', {
      scopeType: 'global',
      toolName: 'bash',
      rules: [
        {
          effect: ToolPolicyEffect.ALLOW,
          priority: 10,
          argumentPatterns: [
            {
              path: 'command',
              operator: 'glob',
              value: 'ls*',
            },
          ],
        },
      ],
    });

    repository.findOne.mockResolvedValue(null);

    await service.seed();

    expect(repository.create).toHaveBeenCalledTimes(2);
    expect(repository.create).toHaveBeenNthCalledWith(1, {
      effect: ToolPolicyEffect.ALLOW,
      priority: 5,
      argumentPatterns: [
        {
          path: 'command',
          operator: 'eq',
          value: 'ls',
        },
      ],
      scopeType: 'global',
      scopeId: null,
      toolName: 'bash',
    });
    expect(repository.create).toHaveBeenNthCalledWith(2, {
      effect: ToolPolicyEffect.ALLOW,
      priority: 10,
      argumentPatterns: [
        {
          path: 'command',
          operator: 'glob',
          value: 'ls*',
        },
      ],
      scopeType: 'global',
      scopeId: null,
      toolName: 'bash',
    });
  });

  it('skips invalid regex patterns and does not save bad seeds', async () => {
    fs.mkdirSync(seedDirectory, { recursive: true });

    writeSeedFile('invalid-regex.seed.json', {
      scopeType: 'agent_profile',
      scopeId: 'investigation-subagent',
      toolName: 'bash',
      rules: [
        {
          effect: ToolPolicyEffect.ALLOW,
          priority: 5,
          argumentPatterns: [
            {
              path: 'command',
              operator: 'regex',
              value: '([',
            },
          ],
        },
      ],
    });

    repository.findOne.mockResolvedValue(null);

    await service.seed();

    expect(repository.create).toHaveBeenCalledTimes(0);
    expect(repository.save).toHaveBeenCalledTimes(0);
    expect(repository.findOne).toHaveBeenCalledTimes(0);
  });

  it('preserves update semantics when matching rule exists', async () => {
    fs.mkdirSync(seedDirectory, { recursive: true });

    writeSeedFile(
      'investigation-subagent-bash.seed.json',
      expectedSeedDefinition,
    );

    const existingRule = {
      id: 'existing-rule',
      scopeType: 'agent_profile',
      scopeId: 'investigation-subagent',
      toolName: 'bash',
      effect: ToolPolicyEffect.DENY,
      priority: 300,
      argumentPatterns: null,
      createdBy: 'tester',
      expiresAt: null,
    } as const;

    repository.findOne.mockImplementation(({ where }: any) => {
      return Promise.resolve(
        where.priority === 300 ? (existingRule as any) : null,
      );
    });

    await service.seed();

    expect(repository.create).toHaveBeenCalledTimes(2);
    expect(repository.save).toHaveBeenCalledTimes(3);
    expect(repository.save).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        ...existingRule,
        effect: ToolPolicyEffect.DENY,
        priority: 300,
        argumentPatterns: [
          {
            path: 'command',
            operator: 'regex',
            value:
              '(^|\\s)(rm|mv|cp|touch|mkdir|rmdir|chmod|chown|git|npm|pnpm|yarn|docker|curl|wget|python|node|perl|ssh|ps|kill|tee)(\\s|$)|[>;`]|\\$\\(|\\|\\||&&|\\||\\bfind\\b.*\\s-(delete|exec|execdir|ok|okdir)\\b|\\bsed\\b.*(\\s-i\\b|(^|[\\s;])[0-9,$!{}\\s]*[we]\\b)',
          },
        ],
      }),
    );
  });
});

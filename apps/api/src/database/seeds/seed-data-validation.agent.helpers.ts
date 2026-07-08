import * as fs from 'node:fs';
import * as path from 'node:path';
import { ToolPolicyEffect, type ToolPolicyDocument } from '@nexus/core';
import type {
  ParsedAgentSeed,
  SeedValidationIssue,
  ValidationCollector,
} from './seed-data-validation.types';
import {
  AGENT_CONFIG_FILENAME,
  AGENT_PROMPT_FILENAME,
  SKILL_MARKDOWN_FILENAME,
  addIssue,
  listDirectories,
} from './seed-data-validation.shared';
import { validatePromptContent } from './seed-data-validation.prompt.helpers';
import { SkillValidationService } from '../../ai-config/skills/skill-validation.service';

const skillValidator = new SkillValidationService();

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === 'string')
  );
}

function readStringArrayField(
  record: Record<string, unknown>,
  field: string,
): string[] | null {
  const raw = record[field];
  if (!isStringArray(raw)) {
    return null;
  }

  return raw.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

function validateAgentToolReferences(params: {
  tools: string[];
  knownToolNames: Set<string>;
  errors: SeedValidationIssue[];
  filePath: string;
  agentName: string;
}): void {
  for (const toolName of params.tools) {
    if (toolName === '*') {
      continue;
    }

    if (!params.knownToolNames.has(toolName)) {
      addIssue(params.errors, {
        code: 'agent-tool-missing',
        filePath: params.filePath,
        agentName: params.agentName,
        message: `Agent '${params.agentName}' references unknown tool '${toolName}'`,
      });
    }
  }
}

function validateAgentSkillReferences(params: {
  assignedSkills: string[];
  skillNames: Set<string>;
  collector: ValidationCollector;
  filePath: string;
  agentName: string;
}): void {
  for (const skillName of params.assignedSkills) {
    if (params.skillNames.has(skillName)) {
      continue;
    }

    addIssue(params.collector.errors, {
      code: 'agent-skill-missing',
      filePath: params.filePath,
      agentName: params.agentName,
      message: `Agent '${params.agentName}' references unknown skill '${skillName}'`,
    });
  }
}

function deriveToolsFromToolPolicy(toolPolicy: ToolPolicyDocument): string[] {
  const tools = new Set<string>();
  for (const rule of toolPolicy.rules) {
    if (typeof rule === 'string') {
      const parts = rule.trim().split(/\s+/);
      if (parts.length >= 2 && parts[0] === 'allow') {
        tools.add(parts[1]);
      }
    } else if (rule.effect === ToolPolicyEffect.ALLOW) {
      tools.add(rule.tool);
    }
  }
  return Array.from(tools).sort();
}

function parseAgentConfig(
  filePath: string,
  collector: ValidationCollector,
): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      addIssue(collector.errors, {
        code: 'agent-json-invalid-shape',
        filePath,
        message: 'Agent config must be a JSON object',
      });
      return null;
    }

    return parsed as Record<string, unknown>;
  } catch (error) {
    addIssue(collector.errors, {
      code: 'agent-json-parse-failed',
      filePath,
      message: `Failed to parse agent config JSON: ${(error as Error).message}`,
    });
    return null;
  }
}

function validateAgentIdentity(params: {
  parsed: Record<string, unknown>;
  directoryName: string;
  filePath: string;
  errors: SeedValidationIssue[];
}): string | null {
  const name =
    typeof params.parsed.name === 'string' ? params.parsed.name.trim() : '';

  if (!name) {
    addIssue(params.errors, {
      code: 'agent-name-missing',
      filePath: params.filePath,
      agentName: params.directoryName,
      message: 'Agent config is missing non-empty name',
    });
    return null;
  }

  if (name !== params.directoryName) {
    addIssue(params.errors, {
      code: 'agent-name-dir-mismatch',
      filePath: params.filePath,
      agentName: name,
      message: `Agent name '${name}' must match directory '${params.directoryName}'`,
    });
    return null;
  }

  if (
    params.parsed.tier_preference !== 'light' &&
    params.parsed.tier_preference !== 'heavy'
  ) {
    addIssue(params.errors, {
      code: 'agent-tier-invalid',
      filePath: params.filePath,
      agentName: name,
      message: 'tier_preference must be light or heavy',
    });
    return null;
  }

  return name;
}

function validateAgentSeedFile(params: {
  filePath: string;
  skillNames: Set<string>;
  knownToolNames: Set<string>;
  warnings: SeedValidationIssue[];
  errors: SeedValidationIssue[];
}): ParsedAgentSeed | null {
  const { filePath, skillNames, knownToolNames, warnings, errors } = params;
  const directoryName = path.basename(path.dirname(filePath));
  const collector: ValidationCollector = { errors, warnings };

  const parsed = parseAgentConfig(filePath, collector);
  if (!parsed) {
    return null;
  }

  const name = validateAgentIdentity({
    parsed,
    directoryName,
    filePath,
    errors,
  });
  if (!name) {
    return null;
  }

  const hasToolPolicy =
    parsed.tool_policy !== undefined &&
    parsed.tool_policy !== null &&
    typeof parsed.tool_policy === 'object' &&
    !Array.isArray(parsed.tool_policy);

  if (!hasToolPolicy) {
    addIssue(errors, {
      code: 'agent-tools-invalid',
      filePath,
      agentName: name,
      message: 'tool_policy must be configured',
    });
    return null;
  }

  const toolPolicy = parsed.tool_policy as ToolPolicyDocument;
  const tools = deriveToolsFromToolPolicy(toolPolicy);

  validateAgentToolReferences({
    tools,
    knownToolNames,
    errors,
    filePath,
    agentName: name,
  });

  const assignedSkills = readStringArrayField(parsed, 'assigned_skills');
  if (!assignedSkills) {
    addIssue(errors, {
      code: 'agent-skills-invalid',
      filePath,
      agentName: name,
      message: 'assigned_skills must be an array of strings',
    });
    return null;
  }

  validateAgentSkillReferences({
    assignedSkills,
    skillNames,
    collector,
    filePath,
    agentName: name,
  });

  return {
    name,
    tools,
    assignedSkills,
    toolPolicy: { tool_policy: toolPolicy },
  };
}

export function validateSeedSkills(
  skillsRoot: string,
  errors: SeedValidationIssue[],
): Set<string> {
  const skillNames = new Set(listDirectories(skillsRoot));

  for (const skillName of skillNames) {
    const markdownPath = path.join(
      skillsRoot,
      skillName,
      SKILL_MARKDOWN_FILENAME,
    );
    if (!fs.existsSync(markdownPath)) {
      addIssue(errors, {
        code: 'skill-markdown-missing',
        filePath: markdownPath,
        message: `Skill '${skillName}' is missing ${SKILL_MARKDOWN_FILENAME}`,
      });
      continue;
    }

    const markdown = fs.readFileSync(markdownPath, 'utf8');
    const result = skillValidator.validateSkillMarkdown({
      skillName,
      markdown,
      knownSkillNames: skillNames,
      strict: true,
    });

    for (const error of result.errors) {
      addIssue(errors, {
        code: 'skill-validation-error',
        filePath: markdownPath,
        message: error,
      });
    }
  }

  return skillNames;
}

export function collectParsedAgents(params: {
  agentsRoot: string;
  skillNames: Set<string>;
  knownToolNames: Set<string>;
  errors: SeedValidationIssue[];
  warnings: SeedValidationIssue[];
}): ParsedAgentSeed[] {
  const { agentsRoot, skillNames, knownToolNames, errors, warnings } = params;
  const parsedAgents: ParsedAgentSeed[] = [];

  for (const directoryName of listDirectories(agentsRoot)) {
    const configPath = path.join(
      agentsRoot,
      directoryName,
      AGENT_CONFIG_FILENAME,
    );
    const promptPath = path.join(
      agentsRoot,
      directoryName,
      AGENT_PROMPT_FILENAME,
    );

    if (!fs.existsSync(configPath)) {
      addIssue(errors, {
        code: 'agent-config-missing',
        filePath: configPath,
        agentName: directoryName,
        message: `Missing ${AGENT_CONFIG_FILENAME}`,
      });
      continue;
    }

    if (!fs.existsSync(promptPath)) {
      addIssue(errors, {
        code: 'agent-prompt-missing',
        filePath: promptPath,
        agentName: directoryName,
        message: `Missing ${AGENT_PROMPT_FILENAME}`,
      });
      continue;
    }

    if (!fs.readFileSync(promptPath, 'utf8').trim()) {
      addIssue(errors, {
        code: 'agent-prompt-empty',
        filePath: promptPath,
        agentName: directoryName,
        message: `${AGENT_PROMPT_FILENAME} must not be empty`,
      });
      continue;
    }

    validatePromptContent({
      content: fs.readFileSync(promptPath, 'utf8'),
      knownToolNames,
      issues: errors,
      filePath: promptPath,
      issueCodePrefix: 'agent-prompt',
      agentName: directoryName,
    });

    const parsed = validateAgentSeedFile({
      filePath: configPath,
      skillNames,
      knownToolNames,
      warnings,
      errors,
    });

    if (parsed) {
      parsedAgents.push(parsed);
    }
  }

  return parsedAgents;
}

function parseSkillRequiredTools(skillMarkdown: string): string[] {
  const frontmatterMatch = /^---([\s\S]*?)---/.exec(skillMarkdown);
  if (!frontmatterMatch) {
    return [];
  }

  const toolsMatch = /required_tools:\s*\[(.*?)\]/.exec(frontmatterMatch[1]);
  if (!toolsMatch) {
    return [];
  }

  return toolsMatch[1]
    .split(',')
    .map((entry) => entry.trim().replaceAll('"', '').replaceAll("'", ''))
    .filter(Boolean);
}

export function validateSkillToolAlignment(params: {
  parsedAgents: ParsedAgentSeed[];
  skillsRoot: string;
  errors: SeedValidationIssue[];
}): void {
  const { parsedAgents, skillsRoot, errors } = params;

  for (const agent of parsedAgents) {
    const allowedTools = new Set(agent.tools);

    for (const skillName of agent.assignedSkills) {
      const skillPath = path.join(
        skillsRoot,
        skillName,
        SKILL_MARKDOWN_FILENAME,
      );
      if (!fs.existsSync(skillPath)) {
        continue;
      }

      const requiredTools = parseSkillRequiredTools(
        fs.readFileSync(skillPath, 'utf8'),
      );
      for (const tool of requiredTools) {
        if (allowedTools.has(tool)) {
          continue;
        }

        addIssue(errors, {
          code: 'agent-skill-tool-missing',
          agentName: agent.name,
          message: `Agent assigned skill '${skillName}' which requires tool '${tool}', but the tool is not allowed for this agent`,
        });
      }
    }
  }
}

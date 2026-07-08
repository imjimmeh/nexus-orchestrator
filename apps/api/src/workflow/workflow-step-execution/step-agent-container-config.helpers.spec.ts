import { describe, expect, it } from 'vitest';
import * as jwtLib from 'jsonwebtoken';
import {
  ContainerTier,
  CONTAINER_AGENT_DIR,
  CONTAINER_CHECKPOINT_PATH,
  CONTAINER_EXTENSIONS_PATH,
  CONTAINER_SESSION_PATH,
} from '@nexus/core';
import { CONTAINER_SKILLS_ROOT } from '../../tool-runtime/skill-mounting.constants';
import { buildAgentContainerConfig } from './step-agent-container-config.helpers';

const MINIMAL_PARAMS = {
  workflowRunId: 'run-abc',
  jobId: 'job-1',
  stepId: 'step-1',
  tier: ContainerTier.LIGHT,
  hostMountPath: '/opt/mounts/extensions',
  hostMountBindings: [],
  jwtSecret: 'test-secret',
  harnessId: 'claude-code' as const,
};

describe('buildAgentContainerConfig — no secrets in container env', () => {
  it('does not include ANTHROPIC_API_KEY in the container env', () => {
    const config = buildAgentContainerConfig(MINIMAL_PARAMS);
    expect(config.env).not.toHaveProperty('ANTHROPIC_API_KEY');
  });

  it('does not include CLAUDE_CODE_OAUTH_TOKEN in the container env', () => {
    const config = buildAgentContainerConfig(MINIMAL_PARAMS);
    expect(config.env).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN');
  });

  it('includes non-secret workflow identity fields in the container env', () => {
    const config = buildAgentContainerConfig(MINIMAL_PARAMS);
    expect(config.env!['WORKFLOW_RUN_ID']).toBe('run-abc');
    expect(config.env!['JOB_ID']).toBe('job-1');
    expect(config.env!['STEP_ID']).toBe('step-1');
    expect(config.env!['HARNESS_ID']).toBe('claude-code');
  });
});

describe('buildAgentContainerConfig — scopeId in JWT', () => {
  it('includes scopeId in the JWT when provided', () => {
    const config = buildAgentContainerConfig({
      ...MINIMAL_PARAMS,
      scopeId: 'project-uuid-123',
    });
    const decoded = jwtLib.decode(config.env!['AGENT_JWT']) as Record<
      string,
      unknown
    >;
    expect(decoded['scopeId']).toBe('project-uuid-123');
  });

  it('omits scopeId from the JWT when not provided', () => {
    const config = buildAgentContainerConfig(MINIMAL_PARAMS);
    const decoded = jwtLib.decode(config.env!['AGENT_JWT']) as Record<
      string,
      unknown
    >;
    expect(decoded).not.toHaveProperty('scopeId');
  });
});

describe('buildAgentContainerConfig — AGENT_JWT lifetime', () => {
  it('mints AGENT_JWT with the default 24h TTL', () => {
    const config = buildAgentContainerConfig(MINIMAL_PARAMS);
    const decoded = jwtLib.verify(
      config.env!['AGENT_JWT'],
      MINIMAL_PARAMS.jwtSecret,
    ) as { iat: number; exp: number };
    expect(decoded.exp - decoded.iat).toBeGreaterThanOrEqual(86_400 - 5);
  });

  it('honours AGENT_JWT_TTL', () => {
    const previous = process.env['AGENT_JWT_TTL'];
    process.env['AGENT_JWT_TTL'] = '1h';
    try {
      const config = buildAgentContainerConfig(MINIMAL_PARAMS);
      const decoded = jwtLib.verify(
        config.env!['AGENT_JWT'],
        MINIMAL_PARAMS.jwtSecret,
      ) as { iat: number; exp: number };
      expect(decoded.exp - decoded.iat).toBe(3_600);
    } finally {
      if (previous === undefined) delete process.env['AGENT_JWT_TTL'];
      else process.env['AGENT_JWT_TTL'] = previous;
    }
  });
});

describe('buildAgentContainerConfig — governed tool extensions wiring', () => {
  it('points EXTENSIONS_PATH at the same path the tool mount is bound to', () => {
    const config = buildAgentContainerConfig(MINIMAL_PARAMS);

    const toolVolume = config.volumes!.find(
      (v) => v.hostPath === MINIMAL_PARAMS.hostMountPath,
    );
    expect(toolVolume?.containerPath).toBe(CONTAINER_EXTENSIONS_PATH);
    expect(config.env!['EXTENSIONS_PATH']).toBe(CONTAINER_EXTENSIONS_PATH);
  });

  it('sets SESSION_PATH so the runtime writes the session where the API extracts it', () => {
    const config = buildAgentContainerConfig(MINIMAL_PARAMS);
    expect(config.env!['SESSION_PATH']).toBe(CONTAINER_SESSION_PATH);
  });
});

describe('buildAgentContainerConfig — checkpoint sidecar mount', () => {
  it('includes the sidecar volume and SESSION_CHECKPOINT_PATH env when checkpointHostDir is provided', () => {
    const config = buildAgentContainerConfig({
      ...MINIMAL_PARAMS,
      checkpointHostDir: '/tmp/nexus-checkpoints/run-abc/job-1',
    });

    const checkpointVolume = config.volumes!.find(
      (v) => v.hostPath === '/tmp/nexus-checkpoints/run-abc/job-1',
    );
    expect(checkpointVolume).toBeDefined();
    expect(checkpointVolume?.containerPath).toBe(CONTAINER_AGENT_DIR);
    expect(checkpointVolume?.readOnly).toBe(false);
    expect(config.env!['SESSION_CHECKPOINT_PATH']).toBe(
      CONTAINER_CHECKPOINT_PATH,
    );
  });

  it('omits the sidecar volume and SESSION_CHECKPOINT_PATH when checkpointHostDir is absent', () => {
    const config = buildAgentContainerConfig(MINIMAL_PARAMS);

    const checkpointVolume = config.volumes!.find(
      (v) => v.containerPath === CONTAINER_AGENT_DIR,
    );
    expect(checkpointVolume).toBeUndefined();
    expect(config.env).not.toHaveProperty('SESSION_CHECKPOINT_PATH');
  });
});

describe('buildAgentContainerConfig — credential delivery mode forwarding', () => {
  it('forwards CLAUDE_CODE_AUTH_DELIVERY into the container env when set on the API', () => {
    const previous = process.env['CLAUDE_CODE_AUTH_DELIVERY'];
    process.env['CLAUDE_CODE_AUTH_DELIVERY'] = 'file';
    try {
      const config = buildAgentContainerConfig(MINIMAL_PARAMS);
      expect(config.env!['CLAUDE_CODE_AUTH_DELIVERY']).toBe('file');
    } finally {
      if (previous === undefined) {
        delete process.env['CLAUDE_CODE_AUTH_DELIVERY'];
      } else {
        process.env['CLAUDE_CODE_AUTH_DELIVERY'] = previous;
      }
    }
  });

  it('omits CLAUDE_CODE_AUTH_DELIVERY from the container env when not set on the API', () => {
    const previous = process.env['CLAUDE_CODE_AUTH_DELIVERY'];
    delete process.env['CLAUDE_CODE_AUTH_DELIVERY'];
    try {
      const config = buildAgentContainerConfig(MINIMAL_PARAMS);
      expect(config.env).not.toHaveProperty('CLAUDE_CODE_AUTH_DELIVERY');
    } finally {
      if (previous !== undefined) {
        process.env['CLAUDE_CODE_AUTH_DELIVERY'] = previous;
      }
    }
  });
});

describe('buildAgentContainerConfig — dynamic skills path mounting', () => {
  it('mounts skillMountPath to CONTAINER_SKILLS_ROOT by default if no containerSkillsPath is specified', () => {
    const config = buildAgentContainerConfig({
      ...MINIMAL_PARAMS,
      skillMountPath: '/opt/skills',
    });
    const skillsVolume = config.volumes!.find(
      (v) => v.hostPath === '/opt/skills',
    );
    expect(skillsVolume).toBeDefined();
    expect(skillsVolume?.containerPath).toBe(CONTAINER_SKILLS_ROOT);
    expect(skillsVolume?.containerPath).toBe(`${CONTAINER_AGENT_DIR}/skills`);
  });

  it('mounts skillMountPath to containerSkillsPath when specified', () => {
    const config = buildAgentContainerConfig({
      ...MINIMAL_PARAMS,
      skillMountPath: '/opt/skills',
      containerSkillsPath: '/root/.custom-path/skills',
    });
    const skillsVolume = config.volumes!.find(
      (v) => v.hostPath === '/opt/skills',
    );
    expect(skillsVolume).toBeDefined();
    expect(skillsVolume?.containerPath).toBe('/root/.custom-path/skills');
  });
});

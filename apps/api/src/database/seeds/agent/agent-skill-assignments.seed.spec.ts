import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentSkillAssignmentsSeedService } from './agent-skill-assignments.seed';

describe('AgentSkillAssignmentsSeedService', () => {
  let tempRoot: string;
  let assignmentsPath: string;
  let skillsLibraryRoot: string;

  const profileRepository = {
    findByNameInsensitive: vi.fn(),
    update: vi.fn(),
  };

  const fileSeedService = {
    hasFileSeedDefinitions: vi.fn(),
  };

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'assignment-seed-spec-'));
    assignmentsPath = path.join(tempRoot, 'seed', 'agents', 'assignments.json');
    skillsLibraryRoot = path.join(tempRoot, 'skills-library');

    fs.mkdirSync(path.dirname(assignmentsPath), { recursive: true });
    fs.mkdirSync(skillsLibraryRoot, { recursive: true });

    process.env.NEXUS_AGENT_SKILL_ASSIGNMENTS_SEED_PATH = assignmentsPath;
    process.env.NEXUS_SKILLS_LIBRARY_PATH = skillsLibraryRoot;

    profileRepository.findByNameInsensitive.mockReset();
    profileRepository.update.mockReset();
    fileSeedService.hasFileSeedDefinitions.mockReset();
    fileSeedService.hasFileSeedDefinitions.mockReturnValue(false);
  });

  afterEach(() => {
    delete process.env.NEXUS_AGENT_SKILL_ASSIGNMENTS_SEED_PATH;
    delete process.env.NEXUS_SKILLS_LIBRARY_PATH;

    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('updates assigned skills for matched profiles', async () => {
    fs.mkdirSync(path.join(skillsLibraryRoot, 'architecture-review'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(skillsLibraryRoot, 'architecture-review', 'SKILL.md'),
      '---\nname: architecture-review\ndescription: Skill\n---\n',
      'utf8',
    );

    fs.writeFileSync(
      assignmentsPath,
      JSON.stringify({ 'architect-agent': ['architecture-review'] }),
      'utf8',
    );

    profileRepository.findByNameInsensitive.mockResolvedValue({
      id: 'profile-1',
      assigned_skills: null,
    });

    const service = new AgentSkillAssignmentsSeedService(
      profileRepository as never,
      fileSeedService as never,
    );

    await service.seed();

    expect(profileRepository.update).toHaveBeenCalledWith('profile-1', {
      assigned_skills: ['architecture-review'],
    });
  });

  it('skips update when all configured skills are missing from the library', async () => {
    fs.writeFileSync(
      assignmentsPath,
      JSON.stringify({ 'architect-agent': ['missing-skill'] }),
      'utf8',
    );

    profileRepository.findByNameInsensitive.mockResolvedValue({
      id: 'profile-1',
      assigned_skills: null,
    });

    const service = new AgentSkillAssignmentsSeedService(
      profileRepository as never,
      fileSeedService as never,
    );

    await service.seed();

    expect(profileRepository.update).not.toHaveBeenCalled();
  });

  it('skips legacy assignment seeding when file-based agent seeds exist', async () => {
    fileSeedService.hasFileSeedDefinitions.mockReturnValue(true);

    fs.writeFileSync(
      assignmentsPath,
      JSON.stringify({ 'architect-agent': ['architecture-review'] }),
      'utf8',
    );

    const service = new AgentSkillAssignmentsSeedService(
      profileRepository as never,
      fileSeedService as never,
    );

    await service.seed();

    expect(profileRepository.findByNameInsensitive).not.toHaveBeenCalled();
    expect(profileRepository.update).not.toHaveBeenCalled();
  });
});

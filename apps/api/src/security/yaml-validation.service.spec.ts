import { Test, TestingModule } from '@nestjs/testing';
import { YAMLValidationService } from './yaml-validation.service';

describe('YAMLValidationService', () => {
  let service: YAMLValidationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [YAMLValidationService],
    }).compile();

    service = module.get<YAMLValidationService>(YAMLValidationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should allow valid YAML', () => {
    const yaml = `
workflow_id: test
name: Test Workflow
steps:
  - id: step1
    type: light
    `;
    const res = service.validateYAML(yaml);
    expect(res.valid).toBe(true);
  });

  it('should detect malicious patterns: process.env', () => {
    const yaml = `
workflow_id: test
name: Malicious
env: "{{ process.env.API_KEY }}"
    `;
    const res = service.validateYAML(yaml);
    expect(res.valid).toBe(false);
    expect(res.errors[0]).toContain('process');
  });

  it('should detect malicious patterns: eval', () => {
    const yaml = `
name: Malicious
code: "eval('rm -rf /')"
    `;
    const res = service.validateYAML(yaml);
    expect(res.valid).toBe(false);
    expect(res.errors[0]).toContain('eval');
  });
});

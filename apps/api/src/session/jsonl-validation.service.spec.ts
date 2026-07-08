import { Test, TestingModule } from '@nestjs/testing';
import { JSONLValidationService } from './jsonl-validation.service';

describe('JSONLValidationService', () => {
  let service: JSONLValidationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [JSONLValidationService],
    }).compile();

    service = module.get<JSONLValidationService>(JSONLValidationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateJSONL', () => {
    it('should validate correct JSONL', () => {
      const jsonl = `{"id":"1","type":"user"}\n{"id":"2","type":"assistant"}`;
      const res = service.validateJSONL(jsonl);
      expect(res.valid).toBe(true);
    });

    it('should catch invalid JSON', () => {
      const jsonl = `{"id":"1","type":"user"}\n{invalid`;
      const res = service.validateJSONL(jsonl);
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain('Invalid JSON');
    });

    it('should catch missing fields', () => {
      const jsonl = `{"type":"user"}`;
      const res = service.validateJSONL(jsonl);
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain("Missing 'id'");
    });
  });

  describe('validateTreeStructure', () => {
    it('should validate simple tree with legacy parent field', () => {
      const nodes = [
        { id: '1', type: 'user' },
        { id: '2', type: 'assistant', parent: '1' },
      ];
      const res = service.validateTreeStructure(nodes);
      expect(res.valid).toBe(true);
    });

    it('should validate tree with v3 parentId field', () => {
      const nodes = [
        { id: '1', type: 'session' },
        { id: '2', type: 'user', parentId: '1' },
        { id: '3', type: 'assistant', parentId: '2' },
      ];
      const res = service.validateTreeStructure(nodes);
      expect(res.valid).toBe(true);
    });

    it('should detect unknown parent with parentId', () => {
      const nodes = [{ id: '2', type: 'assistant', parentId: '1' }];
      const res = service.validateTreeStructure(nodes);
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain("unknown parent '1'");
    });

    it('should detect unknown parent', () => {
      const nodes = [{ id: '2', type: 'assistant', parent: '1' }];
      const res = service.validateTreeStructure(nodes);
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain("unknown parent '1'");
    });

    it('should detect cycles', () => {
      const nodes = [
        { id: '1', type: 'user', parent: '2' },
        { id: '2', type: 'assistant', parent: '1' },
      ];
      const res = service.validateTreeStructure(nodes);
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain('Cycle detected');
    });

    it('should detect cycles with parentId', () => {
      const nodes = [
        { id: '1', type: 'user', parentId: '2' },
        { id: '2', type: 'assistant', parentId: '1' },
      ];
      const res = service.validateTreeStructure(nodes);
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain('Cycle detected');
    });

    it('should accept custom_message type', () => {
      const nodes = [
        { id: '1', type: 'user' },
        {
          id: '2',
          type: 'custom_message',
          parentId: '1',
          customType: 'nexus_system',
        },
      ];
      const res = service.validateTreeStructure(nodes);
      expect(res.valid).toBe(true);
    });
  });
});

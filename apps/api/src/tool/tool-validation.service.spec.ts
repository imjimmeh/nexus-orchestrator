import { Test, TestingModule } from '@nestjs/testing';
import { ToolValidationService } from '../tool-registry/tool-validation.service';

describe('ToolValidationService', () => {
  let service: ToolValidationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ToolValidationService],
    }).compile();

    service = module.get<ToolValidationService>(ToolValidationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateTypeScript', () => {
    it('should validate correct TypeScript', () => {
      const code = 'export const tool = { execute: async () => "hello" };';
      const result = service.validateTypeScript(code);
      expect(result.valid).toBe(true);
    });

    it('should fail on syntax errors', () => {
      const code = 'const x = ;';
      const result = service.validateTypeScript(code);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Syntax error');
    });

    it('should fail on forbidden eval()', () => {
      const code = 'eval("console.log(1)");';
      const result = service.validateTypeScript(code);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Forbidden function call: eval');
    });

    it('should fail on forbidden require(fs)', () => {
      const code = 'const fs = require("fs");';
      const result = service.validateTypeScript(code);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Forbidden module import: fs');
    });

    it('should fail on process.exit()', () => {
      const code = 'process.exit(1);';
      const result = service.validateTypeScript(code);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Forbidden access to process.exit');
    });
  });

  describe('validateSchema', () => {
    it('should validate correct JSON Schema', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      };
      const result = service.validateSchema(schema);
      expect(result.valid).toBe(true);
    });

    it('should fail on invalid JSON Schema', () => {
      const schema = {
        type: 'invalid-type',
      };
      const result = service.validateSchema(schema);
      expect(result.valid).toBe(false);
    });

    describe('provider tool root-type guard', () => {
      it('rejects a root union (anyOf) schema that serializes without an object root', () => {
        const schema = {
          anyOf: [
            { type: 'object', properties: { a: { type: 'string' } } },
            { type: 'object', properties: { b: { type: 'string' } } },
          ],
        };
        const result = service.validateSchema(schema);
        expect(result.valid).toBe(false);
        expect(result.errors.join(' ')).toContain('object');
      });

      it('rejects a root oneOf schema', () => {
        const schema = {
          oneOf: [{ type: 'object' }, { type: 'object' }],
        };
        expect(service.validateSchema(schema).valid).toBe(false);
      });

      it('rejects an explicit non-object root type', () => {
        expect(service.validateSchema({ type: null }).valid).toBe(false);
        expect(service.validateSchema({ type: 'array' }).valid).toBe(false);
      });

      it('accepts an object root with properties', () => {
        const schema = {
          type: 'object',
          properties: { name: { type: 'string' } },
        };
        expect(service.validateSchema(schema).valid).toBe(true);
      });

      it('accepts a loose object root with no properties', () => {
        expect(service.validateSchema({ type: 'object' }).valid).toBe(true);
      });
    });
  });
});

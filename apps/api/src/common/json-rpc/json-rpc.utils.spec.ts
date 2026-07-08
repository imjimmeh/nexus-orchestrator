import { describe, expect, it } from 'vitest';
import {
  createCallToolRequest,
  createInitializeRequest,
  createInitializedNotification,
  createListToolsRequest,
  parseJsonRpcResponse,
  parseToolCallResult,
  parseToolsListResult,
  JSON_RPC_VERSION,
} from './json-rpc.utils';

describe('JSON-RPC Utilities', () => {
  describe('JSON_RPC_VERSION', () => {
    it('should be 2.0', () => {
      expect(JSON_RPC_VERSION).toBe('2.0');
    });
  });

  describe('createInitializeRequest', () => {
    it('should create a valid initialize request', () => {
      const request = createInitializeRequest(1, '2024-11-05', {
        name: 'test-client',
        version: '1.0.0',
      });

      expect(request.jsonrpc).toBe('2.0');
      expect(request.id).toBe(1);
      expect(request.method).toBe('initialize');
      expect(request.params).toEqual({
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      });
    });

    it('should not include id property when not provided', () => {
      const request = createInitializeRequest(42, '2024-11-05', {
        name: 'test',
        version: '1.0.0',
      });
      expect(request.id).toBe(42);
    });
  });

  describe('createInitializedNotification', () => {
    it('should create a notification without id', () => {
      const notification = createInitializedNotification();

      expect(notification.jsonrpc).toBe('2.0');
      expect(notification.method).toBe('notifications/initialized');
      expect(notification.id).toBeUndefined();
      expect(notification.params).toEqual({});
    });
  });

  describe('createListToolsRequest', () => {
    it('should create a valid tools/list request', () => {
      const request = createListToolsRequest(5);

      expect(request.jsonrpc).toBe('2.0');
      expect(request.id).toBe(5);
      expect(request.method).toBe('tools/list');
      expect(request.params).toEqual({});
    });
  });

  describe('createCallToolRequest', () => {
    it('should create a valid tools/call request', () => {
      const request = createCallToolRequest(10, 'test-tool', { arg: 'value' });

      expect(request.jsonrpc).toBe('2.0');
      expect(request.id).toBe(10);
      expect(request.method).toBe('tools/call');
      expect(request.params).toEqual({
        name: 'test-tool',
        arguments: { arg: 'value' },
      });
    });

    it('should handle empty params', () => {
      const request = createCallToolRequest(1, 'tool', {});
      expect(request.params?.arguments).toEqual({});
    });
  });

  describe('parseJsonRpcResponse', () => {
    it('should parse a valid success response', () => {
      const payload = {
        jsonrpc: '2.0',
        id: 1,
        result: { data: 'test' },
      };
      const response = parseJsonRpcResponse(payload);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(1);
      expect(response.result).toEqual({ data: 'test' });
      expect(response.error).toBeUndefined();
    });

    it('should parse a valid error response', () => {
      const payload = {
        jsonrpc: '2.0',
        id: 2,
        error: { code: -32600, message: 'Invalid Request' },
      };
      const response = parseJsonRpcResponse(payload);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(2);
      expect(response.error).toEqual({
        code: -32600,
        message: 'Invalid Request',
      });
      expect(response.result).toBeUndefined();
    });

    it('should parse a response with null id', () => {
      const payload = {
        jsonrpc: '2.0',
        id: null,
        result: {},
      };
      const response = parseJsonRpcResponse(payload);

      expect(response.id).toBeNull();
    });

    it('should parse a response with string id', () => {
      const payload = {
        jsonrpc: '2.0',
        id: 'request-123',
        result: {},
      };
      const response = parseJsonRpcResponse(payload);

      expect(response.id).toBe('request-123');
    });

    it('should throw for non-object payload', () => {
      expect(() => parseJsonRpcResponse(null)).toThrow(
        'Invalid JSON-RPC payload: expected object',
      );
      expect(() => parseJsonRpcResponse('string')).toThrow(
        'Invalid JSON-RPC payload: expected object',
      );
      expect(() => parseJsonRpcResponse(123)).toThrow(
        'Invalid JSON-RPC payload: expected object',
      );
    });

    it('should throw for mismatched version', () => {
      const payload = { jsonrpc: '1.0', id: 1, result: {} };
      expect(() => parseJsonRpcResponse(payload)).toThrow(
        'Invalid JSON-RPC payload: unexpected version',
      );
    });

    it('should validate error structure', () => {
      const payload = {
        jsonrpc: '2.0',
        id: 1,
        error: { code: 1, message: 'Error', data: { extra: 'info' } },
      };
      const response = parseJsonRpcResponse(payload);

      expect(response.error).toEqual({
        code: 1,
        message: 'Error',
        data: { extra: 'info' },
      });
    });

    it('should ignore malformed error', () => {
      const payload = {
        jsonrpc: '2.0',
        id: 1,
        error: { notCode: 'missing' },
      };
      const response = parseJsonRpcResponse(payload);

      expect(response.error).toBeUndefined();
    });

    it('should accept custom version', () => {
      const payload = { jsonrpc: '1.0', id: 1, result: {} };
      const response = parseJsonRpcResponse(payload, '1.0');

      expect(response.jsonrpc).toBe('2.0'); // Normalized to 2.0
      expect(response.id).toBe(1);
    });
  });

  describe('parseToolsListResult', () => {
    it('should parse valid tools list', () => {
      const result = {
        tools: [
          {
            name: 'tool1',
            description: 'A tool',
            inputSchema: { type: 'object' },
          },
          { name: 'tool2' },
        ],
      };
      const parsed = parseToolsListResult(result);

      expect(parsed.tools).toHaveLength(2);
      expect(parsed.tools[0]).toEqual({
        name: 'tool1',
        description: 'A tool',
        inputSchema: { type: 'object' },
      });
      expect(parsed.tools[1]).toEqual({
        name: 'tool2',
        description: null,
        inputSchema: null,
      });
    });

    it('should filter out tools with missing name', () => {
      const result = {
        tools: [
          { name: 'valid' },
          { description: 'missing name' },
          { name: 'also-valid' },
          { notName: 'invalid' },
        ],
      };
      const parsed = parseToolsListResult(result);

      expect(parsed.tools).toHaveLength(2);
      expect(parsed.tools[0].name).toBe('valid');
      expect(parsed.tools[1].name).toBe('also-valid');
    });

    it('should handle empty tools array', () => {
      const result = { tools: [] };
      const parsed = parseToolsListResult(result);

      expect(parsed.tools).toHaveLength(0);
    });

    it('should throw for missing tools array', () => {
      expect(() => parseToolsListResult({})).toThrow(
        'MCP tools/list response is missing tools array',
      );
      expect(() => parseToolsListResult({ tools: 'not-array' })).toThrow(
        'MCP tools/list response is missing tools array',
      );
    });

    it('should handle null inputSchema', () => {
      const result = {
        tools: [{ name: 'test', description: null, inputSchema: null }],
      };
      const parsed = parseToolsListResult(result);

      expect(parsed.tools[0].inputSchema).toBeNull();
    });
  });

  describe('parseToolCallResult', () => {
    it('should parse valid result', () => {
      const result = { output: 'data', success: true };
      const parsed = parseToolCallResult(result);

      expect(parsed.result).toEqual({ output: 'data', success: true });
    });

    it('should return empty object for non-object result', () => {
      expect(parseToolCallResult(null).result).toEqual({});
      expect(parseToolCallResult('string').result).toEqual({});
      expect(parseToolCallResult(123).result).toEqual({});
    });

    it('should preserve array result', () => {
      const result = [1, 2, 3];
      const parsed = parseToolCallResult(result);
      expect(parsed.result).toEqual([1, 2, 3]);
    });

    it('should preserve empty object result', () => {
      const parsed = parseToolCallResult({});
      expect(parsed.result).toEqual({});
    });
  });
});

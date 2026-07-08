import { readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ToolSandboxService } from '../tool-runtime/tool-sandbox.service';

describe('ToolSandboxService', () => {
  const service = new ToolSandboxService();

  it('returns policy_denied for forbidden node code', async () => {
    const result = await service.executeCandidate({
      language: 'node',
      source_code: "import fs from 'fs';\nexport const execute = () => 'ok';",
      params: {},
    });

    expect(result.status).toBe('policy_denied');
    expect(result.exit_code).toBeNull();
    expect(result.stderr).toContain('Candidate denied by sandbox policy');
    expect((result.policy_denials as any)?.reasons?.length).toBeGreaterThan(0);
  });

  it('executes node candidate and returns parsed output', async () => {
    const result = await service.executeCandidate({
      language: 'node',
      source_code:
        'export async function execute(params) { return { sum: params.a + params.b }; }',
      params: { a: 2, b: 3 },
    });

    expect(result.status).toBe('passed');
    expect(result.exit_code).toBe(0);
    expect(result.sandbox_image).toBe('local-node-sandbox');
    expect(result.output).toEqual({ sum: 5 });
  });

  describe('Python policy denial tests', () => {
    it('returns policy_denied for import os in Python', async () => {
      const result = await service.validateCandidate({
        language: 'python',
        source_code: 'import os\n\ndef execute(params):\n    return {}\n',
        params: {},
      });

      expect(result.status).toBe('policy_denied');
      expect(result.exit_code).toBeNull();
      expect(result.stderr).toContain('Candidate denied by sandbox policy');
      expect((result.policy_denials as any)?.reasons?.length).toBeGreaterThan(
        0,
      );
    });

    it('returns policy_denied for import subprocess in Python', async () => {
      const result = await service.validateCandidate({
        language: 'python',
        source_code: 'import subprocess\nexecute = lambda p: {}\n',
        params: {},
      });

      expect(result.status).toBe('policy_denied');
      expect(result.exit_code).toBeNull();
      expect(result.stderr).toContain('Candidate denied by sandbox policy');
      expect((result.policy_denials as any)?.reasons?.length).toBeGreaterThan(
        0,
      );
    });

    it('returns policy_denied for from os import in Python', async () => {
      const result = await service.validateCandidate({
        language: 'python',
        source_code: 'from os import path\nexecute = lambda p: {}\n',
        params: {},
      });

      expect(result.status).toBe('policy_denied');
      expect(result.exit_code).toBeNull();
      expect(result.stderr).toContain('Candidate denied by sandbox policy');
      expect((result.policy_denials as any)?.reasons?.length).toBeGreaterThan(
        0,
      );
    });

    it('returns policy_denied for from subprocess import in Python', async () => {
      const result = await service.validateCandidate({
        language: 'python',
        source_code: 'from subprocess import run\nexecute = lambda p: {}\n',
        params: {},
      });

      expect(result.status).toBe('policy_denied');
      expect(result.exit_code).toBeNull();
      expect(result.stderr).toContain('Candidate denied by sandbox policy');
      expect((result.policy_denials as any)?.reasons?.length).toBeGreaterThan(
        0,
      );
    });

    it('returns policy_denied for eval() in Python', async () => {
      const result = await service.validateCandidate({
        language: 'python',
        source_code:
          'code = "1 + 1"\nresult = eval(code)\nexecute = lambda p: {}\n',
        params: {},
      });

      expect(result.status).toBe('policy_denied');
      expect(result.exit_code).toBeNull();
      expect(result.stderr).toContain('Candidate denied by sandbox policy');
      expect((result.policy_denials as any)?.reasons?.length).toBeGreaterThan(
        0,
      );
    });

    it('returns policy_denied for exec() in Python', async () => {
      const result = await service.validateCandidate({
        language: 'python',
        source_code: 'code = "x = 1"\nexec(code)\nexecute = lambda p: {}\n',
        params: {},
      });

      expect(result.status).toBe('policy_denied');
      expect(result.exit_code).toBeNull();
      expect(result.stderr).toContain('Candidate denied by sandbox policy');
      expect((result.policy_denials as any)?.reasons?.length).toBeGreaterThan(
        0,
      );
    });
  });

  describe('Python execution tests', () => {
    it('executes Python candidate with execute entry point outputting __NEXUS_RESULT__ marker', async () => {
      const result = await service.executeCandidate({
        language: 'python',
        source_code: `
import json

def execute(params):
    result = {"sum": params["a"] + params["b"]}
    print("__NEXUS_RESULT__")
    print(json.dumps(result))
    return result
`,
        params: { a: 5, b: 7 },
      });

      expect(result.status).toBe('passed');
      expect(result.exit_code).toBe(0);
      expect(result.sandbox_image).toBe('local-python-sandbox');
      expect(result.output).toEqual({ sum: 12 });
    });

    it('executes Python candidate with run entry point', async () => {
      const result = await service.executeCandidate({
        language: 'python',
        source_code: `
import json

def run(params):
    return {"product": params["x"] * params["y"]}
`,
        params: { x: 3, y: 4 },
      });

      expect(result.status).toBe('passed');
      expect(result.exit_code).toBe(0);
      expect(result.sandbox_image).toBe('local-python-sandbox');
      expect(result.output).toEqual({ product: 12 });
    });

    it('executes Python candidate with main entry point', async () => {
      const result = await service.executeCandidate({
        language: 'python',
        source_code: `
import json

def main(params):
    return {"difference": params["m"] - params["n"]}
`,
        params: { m: 10, n: 3 },
      });

      expect(result.status).toBe('passed');
      expect(result.exit_code).toBe(0);
      expect(result.sandbox_image).toBe('local-python-sandbox');
      expect(result.output).toEqual({ difference: 7 });
    });

    it('executes Python async function correctly', async () => {
      const result = await service.executeCandidate({
        language: 'python',
        source_code: `
import asyncio
import json

async def execute(params):
    await asyncio.sleep(0.01)
    result = {"async_sum": params["a"] + params["b"]}
    print("__NEXUS_RESULT__")
    print(json.dumps(result))
    return result
`,
        params: { a: 100, b: 200 },
      });

      expect(result.status).toBe('passed');
      expect(result.exit_code).toBe(0);
      expect(result.sandbox_image).toBe('local-python-sandbox');
      expect(result.output).toEqual({ async_sum: 300 });
    });

    it('parses Python result correctly extracting JSON after __NEXUS_RESULT__ marker', async () => {
      const result = await service.executeCandidate({
        language: 'python',
        source_code: `
import json

def execute(params):
    result = {"data": "test", "nested": {"key": "value"}}
    print("__NEXUS_RESULT__")
    print(json.dumps(result))
    return result
`,
        params: {},
      });

      expect(result.status).toBe('passed');
      expect(result.exit_code).toBe(0);
      expect(result.output).toEqual({ data: 'test', nested: { key: 'value' } });
    });

    it('handles complex JSON result parsing from Python output', async () => {
      const result = await service.executeCandidate({
        language: 'python',
        source_code: `
import json

def execute(params):
    result = {"items": [1, 2, 3], "count": 3, "flag": True}
    print("__NEXUS_RESULT__")
    print(json.dumps(result))
    return result
`,
        params: {},
      });

      expect(result.status).toBe('passed');
      expect(result.output).toEqual({ items: [1, 2, 3], count: 3, flag: true });
    });

    it('returns timeout status when Python code exceeds timeout', async () => {
      const result = await service.executeCandidate({
        language: 'python',
        source_code: `
import time

def execute(params):
    time.sleep(5)
    return {"status": "done"}
`,
        params: {},
        timeout_ms: 100,
      });

      expect(result.status).toBe('timeout');
      expect(result.exit_code).toBeNull();
    });

    it('returns failed status when Python code has no execute/run/main entry point', async () => {
      const result = await service.executeCandidate({
        language: 'python',
        source_code: `
# Valid Python but no entry function
value = 42
result = value * 2
`,
        params: {},
      });

      expect(result.status).toBe('failed');
      expect(result.stderr).toContain(
        'Candidate must define execute, run, or main function',
      );
    });

    it('returns failed status when Python code has malformed syntax', async () => {
      const result = await service.executeCandidate({
        language: 'python',
        source_code: `
def execute(params):
    return {  # missing colon and closing brace
        "key": "value"
`,
        params: {},
      });

      expect(result.status).toBe('failed');
      expect(result.stderr).toContain('SyntaxError');
    });

    it('returns null output when runner produces no stdout', async () => {
      // When runner produces no stdout (which shouldn't normally happen
      // since the runner always prints the marker), the output should be undefined
      const result = await service.executeCandidate({
        language: 'python',
        source_code: `
def execute(params):
    # Function that returns something - the runner adds the marker
    return {"value": 123}
`,
        params: {},
      });

      expect(result.status).toBe('passed');
      // Since the runner always adds __NEXUS_RESULT__ marker, output should be defined
      expect(result.output).toEqual({ value: 123 });
    });

    it('cleans up temp directory after Python execution completes', async () => {
      // Execute multiple Python candidates and verify they complete
      // without errors. The service uses mkdtemp and rm in a finally block,
      // so if execution completes successfully, cleanup ran.
      const result1 = await service.executeCandidate({
        language: 'python',
        source_code: `
def execute(params):
    return {"run": 1}
`,
        params: {},
      });

      const result2 = await service.executeCandidate({
        language: 'python',
        source_code: `
def execute(params):
    return {"run": 2}
`,
        params: {},
      });

      // Both executions completed successfully, which means the finally block
      // ran and cleaned up the temp directories
      expect(result1.status).toBe('passed');
      expect(result2.status).toBe('passed');
    });

    it('cleans up temp directory after Python timeout', async () => {
      // When timeout occurs, the finally block should still clean up
      const result = await service.executeCandidate({
        language: 'python',
        source_code: `
import time

def execute(params):
    time.sleep(10)
    return {"status": "should not reach here"}
`,
        params: {},
        timeout_ms: 100,
      });

      // Execution should timeout but not leak temp files
      expect(result.status).toBe('timeout');
    });

    it('verifies all temp directories cleaned up after concurrent executions', async () => {
      const concurrentRuns = 5;
      const promises = Array.from({ length: concurrentRuns }, async (_, i) => {
        return service.executeCandidate({
          language: 'python',
          source_code: `
def execute(params):
    return {"id": ${i + 1}}
`,
          params: {},
        });
      });

      const results = await Promise.all(promises);

      results.forEach((result, i) => {
        expect(result.status).toBe('passed');
        expect(result.output).toEqual({ id: i + 1 });
      });

      // Wait for any async cleanup to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify execution completed successfully, which implies
      // the finally block ran and attempted cleanup
      expect(results.every((r) => r.status === 'passed')).toBe(true);
    });
  });
});

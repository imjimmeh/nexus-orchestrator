/**
 * Tests for `stageHookScripts` (contribution-asset-staging.ts) and
 * the generated PI extension source when `script`-bearing hooks are present.
 *
 * TDD Red phase: these tests are written before the implementation exists.
 *
 * Key invariants:
 *  - `script` hooks produce a staged file with the right extension + source bytes.
 *  - `command` hooks are NOT staged (back-compat, byte-identical to EPIC-210).
 *  - Empty / command-only hooks ⇒ empty staged map (no files).
 *  - The generated extension references the staged FILE PATH as a separate arg
 *    to the interpreter — source is never spliced into a shell command string.
 *  - chmod 0o700 on POSIX (win32-guarded).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { stageHookScripts } from "../src/contribution-asset-staging.js";
import { generateHookExtensionSource } from "../src/contribution-hook-extension.js";
import type { HarnessHookAsset } from "@nexus/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hook-staging-test-"));
}

// ---------------------------------------------------------------------------
// stageHookScripts — file-system contract
// ---------------------------------------------------------------------------

describe("stageHookScripts", () => {
  let stageDir: string;

  beforeEach(() => {
    stageDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(stageDir, { recursive: true, force: true });
  });

  it("returns an empty map for an empty hook list", () => {
    const result = stageHookScripts(stageDir, []);
    expect(result.size).toBe(0);
    expect(fs.readdirSync(stageDir)).toHaveLength(0);
  });

  it("returns an empty map for command-only hooks (no files written)", () => {
    const hooks: HarnessHookAsset[] = [
      { event: "session_start", command: "echo hi" },
      { event: "pre_tool_use", command: "guard.sh" },
    ];
    const result = stageHookScripts(stageDir, hooks);
    expect(result.size).toBe(0);
    expect(fs.readdirSync(stageDir)).toHaveLength(0);
  });

  it("stages a bash script with .sh extension and correct source bytes", () => {
    const source = 'echo "hello world"';
    const hooks: HarnessHookAsset[] = [
      { event: "session_start", script: { language: "bash", source } },
    ];
    const result = stageHookScripts(stageDir, hooks);

    expect(result.size).toBe(1);
    const [entry] = Array.from(result.values());
    expect(entry).toBeDefined();
    expect(entry).toMatch(/\.sh$/);
    expect(fs.readFileSync(entry, "utf-8")).toBe(source);
  });

  it("stages a node script with .js extension", () => {
    const source = "console.log('hi');";
    const hooks: HarnessHookAsset[] = [
      { event: "session_end", script: { language: "node", source } },
    ];
    const result = stageHookScripts(stageDir, hooks);

    expect(result.size).toBe(1);
    const [entry] = Array.from(result.values());
    expect(entry).toMatch(/\.js$/);
    expect(fs.readFileSync(entry, "utf-8")).toBe(source);
  });

  it("stages a python script with .py extension", () => {
    const source = "print('hi')";
    const hooks: HarnessHookAsset[] = [
      { event: "pre_tool_use", script: { language: "python", source } },
    ];
    const result = stageHookScripts(stageDir, hooks);

    expect(result.size).toBe(1);
    const [entry] = Array.from(result.values());
    expect(entry).toMatch(/\.py$/);
    expect(fs.readFileSync(entry, "utf-8")).toBe(source);
  });

  it("stages multiple script hooks and skips command hooks", () => {
    const hooks: HarnessHookAsset[] = [
      { event: "session_start", command: "echo start" },
      {
        event: "session_end",
        script: { language: "bash", source: "echo end" },
      },
      {
        event: "pre_tool_use",
        script: { language: "python", source: "print('guard')" },
      },
    ];
    const result = stageHookScripts(stageDir, hooks);

    // Only the 2 script hooks are staged.
    expect(result.size).toBe(2);
    const stagedFiles = fs.readdirSync(stageDir);
    expect(stagedFiles).toHaveLength(2);
    // One .sh, one .py
    expect(stagedFiles.some((f) => f.endsWith(".sh"))).toBe(true);
    expect(stagedFiles.some((f) => f.endsWith(".py"))).toBe(true);
  });

  it("uses hook-<event>-<index> naming pattern", () => {
    const hooks: HarnessHookAsset[] = [
      {
        event: "session_start",
        script: { language: "bash", source: "echo a" },
      },
      {
        event: "session_start",
        script: { language: "node", source: "console.log('b')" },
      },
    ];
    const result = stageHookScripts(stageDir, hooks);

    expect(result.size).toBe(2);
    const filenames = fs.readdirSync(stageDir);
    expect(filenames.some((f) => f.startsWith("hook-session_start-"))).toBe(
      true,
    );
  });

  it("chmod 0o700 on POSIX (skipped on win32)", () => {
    const hooks: HarnessHookAsset[] = [
      {
        event: "session_start",
        script: { language: "bash", source: "echo hi" },
      },
    ];
    const result = stageHookScripts(stageDir, hooks);
    const [filePath] = Array.from(result.values());

    // POSIX-only: Windows chmod cannot represent Unix permission bits.
    if (process.platform !== "win32") {
      const stats = fs.statSync(filePath);
      expect((stats.mode & 0o777).toString(8)).toBe("700");
    }
  });
});

// ---------------------------------------------------------------------------
// generateHookExtensionSource — script hook integration
// ---------------------------------------------------------------------------

describe("generateHookExtensionSource with staged script hooks", () => {
  let stageDir: string;

  beforeEach(() => {
    stageDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(stageDir, { recursive: true, force: true });
  });

  it("uses the staged path as a separate arg — never splices source into shell string", () => {
    const source = 'echo "secret"; rm -rf /$(bad)';
    const hooks: HarnessHookAsset[] = [
      { event: "session_start", script: { language: "bash", source } },
    ];
    const staged = stageHookScripts(stageDir, hooks);
    const src = generateHookExtensionSource(hooks, staged) as string;

    // The raw source must NOT appear in the generated extension.
    expect(src).not.toContain(source);
    // The staged path (a separate arg) must appear.
    const [stagedPath] = Array.from(staged.values());
    expect(src).toContain(JSON.stringify(stagedPath));
  });

  it("invokes bash script as: sh <path>", () => {
    const hooks: HarnessHookAsset[] = [
      {
        event: "session_start",
        script: { language: "bash", source: "echo hi" },
      },
    ];
    const staged = stageHookScripts(stageDir, hooks);
    const src = generateHookExtensionSource(hooks, staged) as string;
    const [stagedPath] = Array.from(staged.values());

    // Must use execFile('sh', [path]) — not sh -c "source"
    expect(src).toContain('"sh"');
    expect(src).toContain(JSON.stringify(stagedPath));
    // Must NOT include -c flag for script invocation
    expect(src).not.toContain('"-c"');
  });

  it("invokes node script as: node <path>", () => {
    const hooks: HarnessHookAsset[] = [
      {
        event: "session_end",
        script: { language: "node", source: "console.log('x')" },
      },
    ];
    const staged = stageHookScripts(stageDir, hooks);
    const src = generateHookExtensionSource(hooks, staged) as string;
    const [stagedPath] = Array.from(staged.values());

    expect(src).toContain('"node"');
    expect(src).toContain(JSON.stringify(stagedPath));
  });

  it("invokes python script as: python3 <path>", () => {
    const hooks: HarnessHookAsset[] = [
      {
        event: "pre_tool_use",
        script: { language: "python", source: "print('x')" },
      },
    ];
    const staged = stageHookScripts(stageDir, hooks);
    const src = generateHookExtensionSource(hooks, staged) as string;
    const [stagedPath] = Array.from(staged.values());

    expect(src).toContain('"python3"');
    expect(src).toContain(JSON.stringify(stagedPath));
  });

  it("command hooks still use inline __runShell (back-compat, no staged path)", () => {
    const command = "echo hello";
    const hooks: HarnessHookAsset[] = [{ event: "session_start", command }];
    const staged = stageHookScripts(stageDir, hooks);

    // command hooks produce no staged files
    expect(staged.size).toBe(0);

    // generateHookExtensionSource with empty staged map behaves like EPIC-210
    const srcWithStaged = generateHookExtensionSource(hooks, staged) as string;
    const srcOriginal = generateHookExtensionSource(hooks) as string;

    // Both must embed the command via __runShell (JSON-encoded)
    expect(srcWithStaged).toContain(JSON.stringify(command));
    expect(srcOriginal).toContain(JSON.stringify(command));
    // The two should be byte-identical.
    expect(srcWithStaged).toBe(srcOriginal);
  });

  it("mixed command + script hooks: command inlined, script uses staged path", () => {
    const command = "echo cmd";
    const scriptSource = "echo script";
    const hooks: HarnessHookAsset[] = [
      { event: "session_start", command },
      {
        event: "session_end",
        script: { language: "bash", source: scriptSource },
      },
    ];
    const staged = stageHookScripts(stageDir, hooks);
    const src = generateHookExtensionSource(hooks, staged) as string;

    // command is still inlined
    expect(src).toContain(JSON.stringify(command));
    // script source must NOT be in generated extension
    expect(src).not.toContain(scriptSource);
    // staged path is referenced
    const [stagedPath] = Array.from(staged.values());
    expect(src).toContain(JSON.stringify(stagedPath));
  });

  it("no staged map ⇒ back-compat: script hooks fall back to inline (resolveHookCommand)", () => {
    // When called without the staged map (backward compat for existing callers),
    // the generator falls back to the original inline-command behaviour via resolveHookCommand.
    // This is equivalent to EPIC-210 (pre-staging) and keeps command-only
    // callers byte-identical.
    const hooks: HarnessHookAsset[] = [
      { event: "session_start", command: "echo hi" },
    ];
    const src = generateHookExtensionSource(hooks) as string;
    expect(src).toContain(JSON.stringify("echo hi"));
  });

  it("empty hook list ⇒ null regardless of staged map", () => {
    const staged = stageHookScripts(stageDir, []);
    expect(generateHookExtensionSource([], staged)).toBeNull();
    expect(generateHookExtensionSource([])).toBeNull();
  });

  it("pre_tool_use script hook blocks on non-zero exit", () => {
    const hooks: HarnessHookAsset[] = [
      {
        event: "pre_tool_use",
        script: { language: "bash", source: "exit 1" },
      },
    ];
    const staged = stageHookScripts(stageDir, hooks);
    const src = generateHookExtensionSource(hooks, staged) as string;

    expect(src).toContain("block");
    expect(src).toContain('"tool_call"');
  });
});

import { describe, it, expect } from "vitest";
import { CONTAINER_EXTENSIONS_PATH, CONTAINER_SESSION_PATH } from "@nexus/core";
import { loadConfig } from "../../src/config/config.js";

const BASE_ENV = {
  AGENT_JWT: "test-jwt",
  STEP_ID: "step-1",
  WORKFLOW_RUN_ID: "run-1",
  HARNESS_ID: "pi",
};

describe("loadConfig extensionsPath", () => {
  it("defaults to the shared container extensions mount path the API mounts to", () => {
    const config = loadConfig(BASE_ENV);
    expect(config.extensionsPath).toBe(CONTAINER_EXTENSIONS_PATH);
  });

  it("honours an explicit EXTENSIONS_PATH override", () => {
    const config = loadConfig({ ...BASE_ENV, EXTENSIONS_PATH: "/custom/ext" });
    expect(config.extensionsPath).toBe("/custom/ext");
  });
});

describe("loadConfig sessionPath", () => {
  it("defaults to the agent-dir session file the API extracts/injects", () => {
    const config = loadConfig(BASE_ENV);
    expect(config.sessionPath).toBe(CONTAINER_SESSION_PATH);
  });

  it("honours an explicit SESSION_PATH override", () => {
    const config = loadConfig({
      ...BASE_ENV,
      SESSION_PATH: "/custom/session.jsonl",
    });
    expect(config.sessionPath).toBe("/custom/session.jsonl");
  });
});

import { describe, it, expect } from "vitest";
import { CONTAINER_AGENT_DIR } from "../common/container-paths";
import {
  CLAUDE_CODE_CAPABILITIES,
  CLAUDE_CODE_OAUTH_PROVIDER_ID,
  PI_CAPABILITIES,
} from "./harness-capabilities";

describe("Claude Code OAuth credential metadata", () => {
  it("primary credential supports authorization-code OAuth via the anthropic preset", () => {
    const primary = CLAUDE_CODE_CAPABILITIES.requiredCredentials?.find(
      (r) => r.primary,
    );
    expect(primary).toBeDefined();
    expect(primary?.authTypes).toContain("oauth_authcode");
    expect(primary?.oauthProviderId).toBe(CLAUDE_CODE_OAUTH_PROVIDER_ID);
    expect(CLAUDE_CODE_OAUTH_PROVIDER_ID).toBe("anthropic");
  });
});

describe("harness provider compatibility", () => {
  it("claude-code uses a dedicated provider distinct from PI's generic anthropic", () => {
    expect(CLAUDE_CODE_CAPABILITIES.compatibleProviderIds).toEqual([
      "anthropic-claude-code",
    ]);
    expect(CLAUDE_CODE_CAPABILITIES.defaultProviderId).toBe(
      "anthropic-claude-code",
    );
  });

  it("pi declares no provider compatibility constraint (accepts any)", () => {
    expect(PI_CAPABILITIES.compatibleProviderIds).toBeUndefined();
    expect(PI_CAPABILITIES.defaultProviderId).toBeUndefined();
  });
});

describe("skills container paths", () => {
  // The skills mount target MUST equal a directory the harness's own runtime
  // scans natively, otherwise the harness never enumerates the assigned skills
  // and never injects them into the system prompt.
  it("pi mounts skills where its DefaultResourceLoader scans (`${agentDir}/skills`)", () => {
    // pi's DefaultResourceLoader scans `${agentDir}/skills`, and the kernel sets
    // agentDir = CONTAINER_AGENT_DIR. Mounting anywhere else (the old
    // /root/.pi/agent/skills) is invisible to pi.
    expect(PI_CAPABILITIES.skillsContainerPath).toBe(
      `${CONTAINER_AGENT_DIR}/skills`,
    );
  });

  it("claude-code mounts skills at the personal skills dir Claude Code scans (~/.claude/skills, HOME=/root)", () => {
    expect(CLAUDE_CODE_CAPABILITIES.skillsContainerPath).toBe(
      "/root/.claude/skills",
    );
  });
});

# P5: ChatExecutionService Decomposition

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Break `ChatExecutionService` (834 lines, 9 responsibilities, zero tests) into focused services with single responsibilities and test each one. Simultaneously remove the duplicated container-config assembly that exists in both the chat and workflow execution paths.

**Architecture:** Extract three services: (1) `AgentTokenService` — mints JWT tokens for agent containers; (2) `ContainerConfigBuilderService` — assembles the Docker container spec from inputs (image, envvars, volumes, network); (3) `ContainerIpResolverService` — handles the post-start IP resolution retry loop. `ChatExecutionService` becomes an orchestrator that calls these three services. The workflow path (`StepAgentContainerSupportService`) then migrates to use the same `ContainerConfigBuilderService`, eliminating the code duplication.

**This is a high-effort plan.** Complete P1 and P2 first. Work in a git branch.

**Tech Stack:** NestJS, Vitest, Docker (`dockerode`)

---

## Files

| Action | File |
|---|---|
| Read first | `apps/api/src/chat-execution/chat-execution.service.ts` (all 834 lines) |
| Read first | `apps/api/src/workflow/workflow-step-execution/step-agent-container-support.service.ts` |
| Create | `apps/api/src/chat-execution/agent-token.service.ts` |
| Create | `apps/api/src/chat-execution/agent-token.service.spec.ts` |
| Create | `apps/api/src/chat-execution/container-config-builder.service.ts` |
| Create | `apps/api/src/chat-execution/container-config-builder.service.spec.ts` |
| Create | `apps/api/src/chat-execution/container-ip-resolver.service.ts` |
| Create | `apps/api/src/chat-execution/container-ip-resolver.service.spec.ts` |
| Modify | `apps/api/src/chat-execution/chat-execution.service.ts` |
| Modify | `apps/api/src/chat-execution/chat-execution.module.ts` |
| Modify | `apps/api/src/workflow/workflow-step-execution/step-agent-container-support.service.ts` |

---

## Before starting: Read the full service

- [ ] **Step 0: Read `chat-execution.service.ts` completely**

```bash
cat apps/api/src/chat-execution/chat-execution.service.ts
```

Map each method to one of these buckets:
- **AgentTokenService**: JWT minting logic (lines ~635–649)
- **ContainerConfigBuilderService**: `buildContainerConfig`, `buildProviderRuntimeEnv` (lines ~624–719)
- **ContainerIpResolverService**: IP resolution with retry (lines ~727–780)
- **ChatExecutionService**: everything else (orchestration, budget, retry scheduling, usage recording)

---

## Task 1: Extract `AgentTokenService`

**Files:**
- Create: `apps/api/src/chat-execution/agent-token.service.ts`
- Create: `apps/api/src/chat-execution/agent-token.service.spec.ts`

- [ ] **Step 1: Write the test**

Read lines 635–649 of `chat-execution.service.ts` first to understand what inputs produce what JWT shape, then:

```typescript
// apps/api/src/chat-execution/agent-token.service.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { AgentTokenService } from './agent-token.service';
import * as jwt from 'jsonwebtoken';

describe('AgentTokenService', () => {
  let service: AgentTokenService;
  const mockConfig = { get: vi.fn().mockReturnValue('test-secret') };

  beforeEach(() => {
    service = new AgentTokenService(mockConfig as any);
  });

  it('returns a signed JWT with the expected payload', () => {
    const token = service.mintAgentToken({ sessionId: 'sess-1', containerName: 'c1' });

    const decoded = jwt.decode(token) as Record<string, unknown>;
    expect(decoded).toMatchObject({
      sessionId: 'sess-1',
      containerName: 'c1',
    });
  });

  it('produced token is verifiable with the configured secret', () => {
    const token = service.mintAgentToken({ sessionId: 'sess-1', containerName: 'c1' });
    expect(() => jwt.verify(token, 'test-secret')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run apps/api/src/chat-execution/agent-token.service.spec.ts
```

Expected: FAIL — file does not exist.

- [ ] **Step 3: Implement**

Read lines 635–649 of `chat-execution.service.ts` to extract the exact payload shape and signing options, then implement:

```typescript
// apps/api/src/chat-execution/agent-token.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

export interface AgentTokenPayload {
  sessionId: string;
  containerName: string;
  // Add any other fields present in the existing JWT at lines 635-649
}

@Injectable()
export class AgentTokenService {
  constructor(private readonly config: ConfigService) {}

  mintAgentToken(payload: AgentTokenPayload): string {
    const secret = this.config.get<string>('JWT_SECRET') ?? '';
    // Copy the exact signing options from chat-execution.service.ts lines 635-649
    return jwt.sign(payload, secret, { expiresIn: '1h' });
  }
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npx vitest run apps/api/src/chat-execution/agent-token.service.spec.ts
```

Expected: All tests pass.

- [ ] **Step 5: Wire service into module and replace inline JWT logic in ChatExecutionService**

In `apps/api/src/chat-execution/chat-execution.module.ts`:
```typescript
providers: [ChatExecutionService, AgentTokenService, /* ... */],
```

In `apps/api/src/chat-execution/chat-execution.service.ts`:
- Add `private readonly agentTokenService: AgentTokenService` to constructor
- Replace the inline JWT signing block (lines ~635–649) with `this.agentTokenService.mintAgentToken({...})`
- Delete the now-unused JWT imports if no longer used elsewhere in the file

- [ ] **Step 6: Run the full chat-execution test suite**

```bash
npx vitest run apps/api/src/chat-execution/
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/chat-execution/agent-token.service.ts \
        apps/api/src/chat-execution/agent-token.service.spec.ts \
        apps/api/src/chat-execution/chat-execution.service.ts \
        apps/api/src/chat-execution/chat-execution.module.ts
git commit -m "refactor: extract AgentTokenService from ChatExecutionService"
```

---

## Task 2: Extract `ContainerConfigBuilderService`

This is the largest extraction — `buildContainerConfig` and `buildProviderRuntimeEnv` at lines ~624–719.

**Files:**
- Create: `apps/api/src/chat-execution/container-config-builder.service.ts`
- Create: `apps/api/src/chat-execution/container-config-builder.service.spec.ts`

- [ ] **Step 1: Read lines 624–719 of `chat-execution.service.ts` carefully**

```bash
sed -n '590,725p' apps/api/src/chat-execution/chat-execution.service.ts
```

Note all parameters that `buildContainerConfig` takes, what it returns, and what env vars it reads. Map each to a typed interface field.

- [ ] **Step 2: Write the test using the inputs and outputs you found**

```typescript
// apps/api/src/chat-execution/container-config-builder.service.spec.ts
import { describe, it, expect } from 'vitest';
import { ContainerConfigBuilderService } from './container-config-builder.service';

describe('ContainerConfigBuilderService', () => {
  let service: ContainerConfigBuilderService;

  beforeEach(() => {
    // Use a mock ConfigService returning test values for each URL/network config
    const mockConfig = { get: vi.fn().mockImplementation((key: string) => {
      const map: Record<string, string> = {
        'containerUrls.websocketUrl': 'http://ws:3001',
        'containerUrls.apiBaseUrl': 'http://api:3000',
        'containerUrls.dockerNetwork': 'test-net',
      };
      return map[key] ?? null;
    })};
    service = new ContainerConfigBuilderService(mockConfig as any);
  });

  it('includes the image name in the container config', () => {
    const config = service.build({
      image: 'nexus-agent:latest',
      // provide minimum required fields based on what you read from the service
      sessionId: 'sess-1',
      agentToken: 'tok',
      toolMounts: [],
    });

    expect(config.Image).toBe('nexus-agent:latest');
  });

  it('sets the network mode from config', () => {
    const config = service.build({
      image: 'nexus-agent:latest',
      sessionId: 'sess-1',
      agentToken: 'tok',
      toolMounts: [],
    });

    expect(config.HostConfig?.NetworkMode).toBe('test-net');
  });
});
```

**Adapt the test inputs to match the actual signature once you've read the source.**

- [ ] **Step 3: Run test to confirm it fails**

```bash
npx vitest run apps/api/src/chat-execution/container-config-builder.service.spec.ts
```

Expected: FAIL — file does not exist.

- [ ] **Step 4: Implement — move `buildContainerConfig` and `buildProviderRuntimeEnv`**

```typescript
// apps/api/src/chat-execution/container-config-builder.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ContainerUrlsConfig } from '../config/container-urls.config';
import { CONTAINER_URLS_CONFIG } from '../config/container-urls.config';

// Define the input interface based on what buildContainerConfig currently accepts
export interface ContainerBuildInput {
  image: string;
  sessionId: string;
  agentToken: string;
  toolMounts: Array<{ source: string; target: string }>;
  // Add any other parameters currently passed to buildContainerConfig
}

@Injectable()
export class ContainerConfigBuilderService {
  constructor(private readonly config: ConfigService) {}

  build(input: ContainerBuildInput): Record<string, unknown> {
    const urls = this.config.get<ContainerUrlsConfig>(CONTAINER_URLS_CONFIG);
    // Move the body of buildContainerConfig and buildProviderRuntimeEnv here
    // Use urls.websocketUrl, urls.apiBaseUrl, urls.dockerNetwork
    // instead of process.env reads
    // ...
    return { /* assembled Docker container config */ };
  }
}
```

The body is the exact content of `buildContainerConfig` (and `buildProviderRuntimeEnv` as a private helper or merged inline). Copy it wholesale, then replace all `process.env` reads with `ConfigService` lookups.

- [ ] **Step 5: Run test to confirm it passes**

```bash
npx vitest run apps/api/src/chat-execution/container-config-builder.service.spec.ts
```

Expected: All tests pass.

- [ ] **Step 6: Wire into module and replace calls in ChatExecutionService**

In `chat-execution.module.ts`, add `ContainerConfigBuilderService` to providers.

In `chat-execution.service.ts`:
- Add `private readonly containerConfigBuilder: ContainerConfigBuilderService` to constructor
- Replace `this.buildContainerConfig(...)` call with `this.containerConfigBuilder.build(...)`
- Delete `private buildContainerConfig(...)` and `private buildProviderRuntimeEnv(...)` methods from the service

- [ ] **Step 7: Migrate `StepAgentContainerSupportService` to use the same builder**

In `apps/api/src/workflow/workflow-step-execution/step-agent-container-support.service.ts`:
- Import `ContainerConfigBuilderService`
- Replace the equivalent inline container-config assembly with `this.containerConfigBuilder.build(...)`

This is the DRY win — both execution paths now share one tested implementation.

- [ ] **Step 8: Run tests**

```bash
npx vitest run apps/api/src/chat-execution/ apps/api/src/workflow/workflow-step-execution/
```

Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/chat-execution/ \
        apps/api/src/workflow/workflow-step-execution/step-agent-container-support.service.ts
git commit -m "refactor: extract ContainerConfigBuilderService, eliminate duplicated container config assembly"
```

---

## Task 3: Extract `ContainerIpResolverService`

The IP resolution retry loop (lines ~727–780) polls `container.inspect()` until it has an IP, with a configurable timeout.

**Files:**
- Create: `apps/api/src/chat-execution/container-ip-resolver.service.ts`
- Create: `apps/api/src/chat-execution/container-ip-resolver.service.spec.ts`

- [ ] **Step 1: Read the IP resolution loop**

```bash
sed -n '725,785p' apps/api/src/chat-execution/chat-execution.service.ts
```

Note the inputs (container reference, timeout, poll interval), the Docker API call used, and the retry logic.

- [ ] **Step 2: Write the test**

```typescript
// apps/api/src/chat-execution/container-ip-resolver.service.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContainerIpResolverService } from './container-ip-resolver.service';

describe('ContainerIpResolverService', () => {
  let service: ContainerIpResolverService;

  beforeEach(() => {
    service = new ContainerIpResolverService();
  });

  it('returns the IP when the container has one on the first poll', async () => {
    const mockContainer = {
      inspect: vi.fn().mockResolvedValue({
        NetworkSettings: { Networks: { 'test-net': { IPAddress: '172.17.0.5' } } },
      }),
    };

    const ip = await service.resolveIp(mockContainer as any, 'test-net', {
      timeoutMs: 5000,
      pollIntervalMs: 100,
    });

    expect(ip).toBe('172.17.0.5');
    expect(mockContainer.inspect).toHaveBeenCalledTimes(1);
  });

  it('retries until IP is available', async () => {
    const mockContainer = {
      inspect: vi.fn()
        .mockResolvedValueOnce({ NetworkSettings: { Networks: { 'test-net': { IPAddress: '' } } } })
        .mockResolvedValueOnce({ NetworkSettings: { Networks: { 'test-net': { IPAddress: '172.17.0.5' } } } }),
    };

    const ip = await service.resolveIp(mockContainer as any, 'test-net', {
      timeoutMs: 5000,
      pollIntervalMs: 1,
    });

    expect(ip).toBe('172.17.0.5');
    expect(mockContainer.inspect).toHaveBeenCalledTimes(2);
  });

  it('throws when timeout is exceeded without an IP', async () => {
    const mockContainer = {
      inspect: vi.fn().mockResolvedValue({
        NetworkSettings: { Networks: { 'test-net': { IPAddress: '' } } },
      }),
    };

    await expect(
      service.resolveIp(mockContainer as any, 'test-net', {
        timeoutMs: 10,
        pollIntervalMs: 1,
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
npx vitest run apps/api/src/chat-execution/container-ip-resolver.service.spec.ts
```

Expected: FAIL — file does not exist.

- [ ] **Step 4: Implement**

```typescript
// apps/api/src/chat-execution/container-ip-resolver.service.ts
import { Injectable } from '@nestjs/common';
import { sleep } from '../common/utils/async.utils';

export interface IpResolverOptions {
  timeoutMs: number;
  pollIntervalMs: number;
}

@Injectable()
export class ContainerIpResolverService {
  async resolveIp(
    container: { inspect(): Promise<{ NetworkSettings: { Networks: Record<string, { IPAddress?: string }> } }> },
    networkName: string,
    options: IpResolverOptions,
  ): Promise<string> {
    const deadline = Date.now() + options.timeoutMs;

    while (Date.now() < deadline) {
      const info = await container.inspect();
      const ip = info.NetworkSettings?.Networks?.[networkName]?.IPAddress;
      if (ip) return ip;
      await sleep(options.pollIntervalMs);
    }

    throw new Error(
      `Container did not obtain an IP on network "${networkName}" within ${options.timeoutMs}ms`,
    );
  }
}
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
npx vitest run apps/api/src/chat-execution/container-ip-resolver.service.spec.ts
```

Expected: All tests pass.

- [ ] **Step 6: Wire into module and replace calls in ChatExecutionService**

Add `ContainerIpResolverService` to `chat-execution.module.ts` providers.

In `chat-execution.service.ts`:
- Add `private readonly ipResolver: ContainerIpResolverService` to constructor
- Replace the inline IP resolution loop with `await this.ipResolver.resolveIp(container, networkName, { timeoutMs, pollIntervalMs })`
- Delete the inline loop

- [ ] **Step 7: Run the full chat-execution test suite**

```bash
npx vitest run apps/api/src/chat-execution/
```

Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/chat-execution/
git commit -m "refactor: extract ContainerIpResolverService from ChatExecutionService"
```

---

## Task 4: Write a baseline integration test for ChatExecutionService

After the extractions, `ChatExecutionService` should be significantly shorter and its constructor param count reduced. Now write one test that verifies the core orchestration path works end-to-end with mocked dependencies.

- [ ] **Step 1: Check the current line count**

```bash
wc -l apps/api/src/chat-execution/chat-execution.service.ts
```

Expected: Significantly under 834. If it is still over 600, review whether all three extractions were completed.

- [ ] **Step 2: Write an orchestration smoke test**

```typescript
// apps/api/src/chat-execution/chat-execution.service.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatExecutionService } from './chat-execution.service';

// Mock all extracted services and external dependencies
const mockAgentToken = { mintAgentToken: vi.fn().mockReturnValue('tok') };
const mockConfigBuilder = { build: vi.fn().mockReturnValue({ Image: 'img' }) };
const mockIpResolver = { resolveIp: vi.fn().mockResolvedValue('172.0.0.1') };
const mockBudgetService = { checkBudget: vi.fn().mockResolvedValue({ allowed: true }) };
const mockUsageService = { record: vi.fn().mockResolvedValue(undefined) };

describe('ChatExecutionService orchestration', () => {
  it('calls budget check, builds container config, and mints token', async () => {
    // Construct service with all mocked dependencies
    // Call the main execution method
    // Assert that budget, config, and token services were each called once
    // (Fill in with actual method names once you have read the full service)
  });
});
```

Complete the test body after reading the full `chat-execution.service.ts` orchestration flow.

- [ ] **Step 3: Run the test**

```bash
npx vitest run apps/api/src/chat-execution/chat-execution.service.spec.ts
```

Expected: Test passes.

- [ ] **Step 4: Final commit**

```bash
git add apps/api/src/chat-execution/chat-execution.service.spec.ts
git commit -m "test: add orchestration smoke test for ChatExecutionService after decomposition"
```

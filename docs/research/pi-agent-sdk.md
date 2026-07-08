# Pi Agent SDK (`pi-mono`) Documentation

The Nexus Core Engine uses the **Pi Agent** (`pi-mono`) runtime as its primary execution engine for AI-driven tasks. This documentation provides an overview of the SDK, its core packages, and how to use it within the Nexus ecosystem.

## 1. Overview

Pi Agent is a TypeScript toolkit for building autonomous AI agents. It is designed for robustness, extensibility, and seamless integration into larger systems. It supports multiple LLM providers, built-in coding tools, and a modular architecture for adding custom logic.

- **Author:** Mario Zechner
- **Official Website:** [pi.dev](https://pi.dev)
- **GitHub Repository:** [badlogic/pi-mono](https://github.com/badlogic/pi-mono)
- **NPM Scope:** `@mariozechner`

## 2. Core SDK Packages

The SDK is organized as a layered monorepo. The following packages are the most critical for Nexus:

| Package | Purpose |
| :--- | :--- |
| **`@mariozechner/pi-ai`** | Unified interface for LLM providers (Anthropic, OpenAI, Google, etc.). Handles tool-calling, message formatting, and token tracking. |
| **`@mariozechner/pi-agent-core`** | The core autonomous loop. Manages the iteration between LLM responses and tool execution. |
| **`@mariozechner/pi-coding-agent`** | The high-level SDK and CLI. Includes built-in coding tools (`read`, `write`, `edit`, `bash`), session management, and persistence logic. |

## 3. Key Concepts

### 3.1. `AgentSession`
The `AgentSession` is the primary interface for interacting with the agent. It encapsulates:
- **Conversation History:** The current tree of messages and tool calls.
- **State Management:** Persistence via session storage (JSONL-based).
- **Execution Loop:** The process of prompting the LLM and executing its requested tools.

### 3.2. Session Persistence (`session.jsonl`)
Pi Agent uses a JSONL-based tree structure for session state. This allows for:
- **Dehydration/Rehydration:** Saving the entire session state to disk/database and resuming it later.
- **Branching:** Resuming from a specific `nodeId` to explore alternative paths (native tree branching).

### 3.3. Extensions & Skills
- **Extensions:** TypeScript modules that hook into the agent's lifecycle (e.g., `before_tool_call`, `on_session_start`). Used to modify behavior or add dynamic tools.
- **Skills:** Specialized instructional sets and tools defined in `SKILL.md` files within a `.pi/` directory.

## 4. SDK Usage Examples

### 4.1. Basic Implementation
To embed the agent in a TypeScript application:

```typescript
import { AuthStorage, createAgentSession, ModelRegistry, SessionManager } from "@mariozechner/pi-coding-agent";

async function runAgent() {
  // 1. Set up storage and model registry
  const authStorage = AuthStorage.create();
  const modelRegistry = new ModelRegistry(authStorage);

  // 2. Create a session (In-memory or File-based)
  const { session } = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
    authStorage,
    modelRegistry,
  });

  // 3. Send a prompt
  await session.prompt("Initialize a new React project in the current directory.");
}
```

### 4.2. Handling Streaming Events
The SDK uses a subscription model for real-time telemetry, which Nexus uses for its WebSocket multiplexing.

```typescript
session.subscribe((event) => {
  switch (event.type) {
    case "message_update":
      if (event.assistantMessageEvent.type === "text_delta") {
        console.log("Partial text:", event.assistantMessageEvent.delta);
      }
      break;
    case "tool_execution_start":
      console.log("Executing tool:", event.toolName);
      break;
    case "turn_end":
      console.log("Agent finished its turn.");
      break;
  }
});
```

### 4.3. Persistence & Rehydration
In Nexus, sessions are frequently dehydrated to save resources.

```typescript
// Dehydrating: Get the current session state
const state = await session.exportState(); 

// Rehydrating: Start a session from a saved state
const { session } = await createAgentSession({
  sessionManager: SessionManager.fromState(state),
  // ... other config
});
```

## 5. Integration in Nexus (`pi-runner.ts`)

In Nexus Core, the Pi Agent is wrapped in a `pi-runner.ts` script that runs inside Docker containers. This script:
1. **Bootstraps the Agent:** Loads environment variables and secrets.
2. **Mounts Tools:** Loads extensions from the `/app/extensions` directory provided by the `ToolRegistryService`.
3. **Connects to WebSocket:** Proxies all `session.subscribe` events to the `PiTelemetryGateway`.
4. **Handles State:** Reads/Writes `session.jsonl` to the container volume for hydration.

## 6. Official Documentation References

For more in-depth technical details, refer to the official documentation in the `pi-mono` repository:

- **SDK Documentation:** [packages/coding-agent/docs/sdk.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md)
- **Extensions Guide:** [packages/coding-agent/docs/extensions.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)
- **Built-in Tools Reference:** [packages/coding-agent/docs/tools.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/tools.md)
- **Model Registry:** [packages/ai/README.md](https://github.com/badlogic/pi-mono/tree/main/packages/ai)

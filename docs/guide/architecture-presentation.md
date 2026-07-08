---
marp: true
theme: gaia
_class: lead
paginate: true
backgroundColor: #0f172a
color: #e2e8f0
style: |
  section {
    font-family: 'Outfit', 'Inter', -apple-system, sans-serif;
    padding: 40px;
    background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
    color: #e2e8f0;
  }
  h1 {
    color: #38bdf8;
    font-size: 2.2em;
    border-bottom: 2px solid #38bdf8;
    padding-bottom: 10px;
  }
  h2 {
    color: #2dd4bf;
    font-size: 1.6em;
    margin-top: 20px;
  }
  h3 {
    color: #fbbf24;
    font-size: 1.2em;
  }
  footer {
    font-size: 0.5em;
    color: #64748b;
  }
  code {
    background-color: #1e293b;
    color: #38bdf8;
    border-radius: 4px;
    padding: 2px 6px;
    font-family: 'Fira Code', 'Courier New', monospace;
  }
  pre {
    background-color: #0f172a;
    border: 1px solid #334155;
    border-radius: 8px;
    padding: 15px;
  }
  pre code {
    background-color: transparent;
    color: #f8fafc;
    padding: 0;
  }
  p {
    font-size: 0.5em;
  }
  /* Custom class to handle large ASCII diagrams */
  section.diagram-slide pre {
    font-size: 0.52em;
    line-height: 1.1;
    padding: 10px;
    margin: 5px 0;
  }
  /* Custom class to handle dense text slides */
  section.dense-slide ul {
    font-size: 0.85em;
  }
  blockquote {
    background-color: #1e293b;
    border-left: 4px solid #2dd4bf;
    color: #cbd5e1;
    padding: 10px 20px;
    margin: 20px 0;
    border-radius: 0 8px 8px 0;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 15px;
    font-size: 0.85em;
  }
  th {
    background-color: #1e293b;
    color: #38bdf8;
    text-align: left;
    padding: 8px;
    border-bottom: 2px solid #334155;
  }
  td {
    padding: 8px;
    border-bottom: 1px solid #334155;
  }
  .highlight {
    color: #fbbf24;
    font-weight: bold;
  }
---

# Nexus Orchestrator

## Architecture & Technical Deep Dive

### The Governed Agent Execution Engine

---

# Executive Summary: The Core Four

- **WHAT does it do?**
  - Nexus translates developer actions and project events into **isolated, governed, containerized executions** performed by LLM-backed agents or deterministic commands.
- **HOW does it do it?**
  - It decouples **Orchestration** (NestJS Core API + DAGs + Redis) from **Execution** (Docker + Harness Engine + Agent SDK) using a 4-layer Tool stack. _(PI Runner is one built-in harness engine — see [41-harness-runtime.md](41-harness-runtime.md).)_
- **WHY does it do it?**
  - To solve agent drift, prevent destructive actions, guarantee consistent workspace state, and provide human-in-the-loop control.
- **WHAT does it allow us to do as a result?**
  - Run safe, autonomous software engineering cycles directly linked to project Kanban boards, complete with self-healing failure recovery.

---

# WHAT: System Architecture Context (C4 Level 1)

![width:640px](/docs/diagrams/orchestrator-boundary.png)

---

# WHY: The Core Challenges of AI Agents

- **Environment Contamination**: Unconstrained agents executing shell commands can corrupt the host environment, overwrite source code, or leave orphaned processes.

- **The "Black Box" Telemetry Gap**: Traditional agent runs make it impossible to see intermediate thoughts, tool calls, and failures in real-time.

- **Security & Destructive Actions**: LLMs suffer from hallucination and prompt injection. Giving raw CLI access (`rm -rf`, `git push --force`) creates catastrophic vulnerabilities.

- **Orchestration vs. Execution Drift**: Conflating _state tracking_ with _execution_ leads to fragile, unscaleable agent architectures that cannot handle retries, parallel flows, or timeouts.

---

# HOW: Architecture Decoupling

Nexus enforces a clean boundary between the **Control Plane** and the **Execution Plane**:

| Layer         | Component                           | Tech Stack              | Responsibility                                                                                                                                                                      |
| ------------- | ----------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Control**   | **Core API**                        | NestJS, Postgres, Redis | Declarative DAGs, state persistence, telemetry gateway, tool policy, secrets storage.                                                                                               |
| **Execution** | **Harness Engine** (e.g. PI Runner) | Node.js, Docker         | Runs inside ephemeral containers, spawns AI Agent SDK, captures telemetry, executes checks. Pluggable via `HarnessEngine` SPI — see [41-harness-runtime.md](41-harness-runtime.md). |

> **Key Benefit**: Ephemeral worker containers can crash, time out, or execute arbitrary code without affecting the API control plane.

---

# HOW: Step Execution Pipeline

![w:640px](/docs/diagrams/step-execution-pipeline.png)

---

# HOW: Harness Engine — The Container Bridge (PI Engine Example)

> **Note:** The execution layer is now engine-pluggable (`HarnessEngine` SPI). PI Runner is one built-in engine. See [41 — Harness Runtime](41-harness-runtime.md).

Inside the container (`nexus-light` or `nexus-heavy`), the harness engine (`PI Runner` in this example) orchestrates the session:

- **Startup Configuration Exchange**:
- Docker starts the container with environment variables including `AGENT_JWT`.
- The harness engine establishes a Socket.IO connection to the Core API.
- The API sends a `configure` event containing prompt, model params, and tool rules.

- **Telemetry Streaming**:
- Subscribes to the Agent SDK event stream and maps events (`turn_start`, `tool_execution_start`, etc.) to WebSocket payloads.

- **Session Lifecycle**:
- Implements `dehydrate` (checkpointing state) and `abort` (graceful termination).

---

# HOW: The 4-Layer Tool Stack

Every tool execution flows through four structured layers to ensure absolute security:

![w:840px](/docs/diagrams/four-layer-tool-stack.png)

---

# HOW: Unified Tool Policy

Permissions are defined by the `ToolPolicyDocument` model, using ordered, first-match-wins rules:

```typescript
interface ToolPolicyDocument {
  default: ToolPolicyEffect; // allow, deny, require_approval...
  rules: (ToolPolicyRule | string)[];
}

interface ToolPolicyRule {
  id?: string;
  effect: ToolPolicyEffect;
  tool: string; // Globs supported ("git*")
  arguments?: Record<string, Matcher>; // Argument-aware restrictions
}
```

- **Layering**: Rules from Agent Profile, Workflow Definition, and Session Policies stack at runtime.

---

# HOW: Shorthand Rules & Guardrails

**String Shorthand Format:** `"[EFFECT] [TOOL_GLOB] [ARGUMENT_FALLBACK]"`

- `"allow read *"`
- `"require_approval spawn_subagent_async *"`

**Argument-Aware Rules (JSON Example):**

```json
{
  "default": "deny",
  "rules": [
    {
      "effect": "deny",
      "tool": "bash",
      "arguments": { "command": "rm -rf *" }
    },
    {
      "effect": "require_approval",
      "tool": "bash",
      "arguments": { "command": "git push *" }
    },
    "allow bash *",
    "allow read *"
  ]
}
```

---

# HOW: Host Mount Scope Security

To prevent agents from modifying critical host files, Nexus implements two safety configurations:

- **Host Mount Scope Manifest (`_host_mount_scope.json`)**:
- Explicitly lists which directories are `read-only` and which are `writable`.
- Container tool write guards block actions outside designated directories.

- **Built-in Tool Allowlist (`_sdk_tool_allowlist.json`)**:
- Limits which default capabilities of the Agent SDK (e.g., `bash`, `write`, `read`) are active in the container environment.

- **Fallback Reads**:
- If no read capabilities are mounted, the runner falls back to a restricted directory listing.

---

# RESULT: What Nexus Allows Us To Do

```text
  ┌──────────────────────────────────────────────────────────────────┐
  │                   1. AUTONOMIC ENGINEERING                       │
  │ Run complex multi-agent coding sessions, dependency resolution,  │
  │ linting, and testing workflows fully autonomously.               │
  └──────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │                  2. HUMAN-IN-THE-LOOP CONTROL                    │
  │ Agents can pause, call `ask_user_questions` to request info, or  │
  │ trigger Slack/Telegram alerts for manual command approval.        │
  └──────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │                    3. PROJECT-INTEGRATED SLATE                   │
  │ Kanban state changes trigger workflows (e.g., "Ready for Review" │
  │ triggers E2E test suite; results update card status/comments).   │
  └──────────────────────────────────────────────────────────────────┘

```

---

# RESULT: Self-Healing Failure Recovery

When a step execution fails, **Workflow Repair** determines the path forward.

---

# SUMMARY: Key Architectural Strengths

- **Durable & Scalable**:
- Decoupling state from runtimes prevents resource leaks via BullMQ and Postgres.

- **Auditable Telemetry**:
- Real-time WebSockets provide transparency into LLM thoughts and system IO.

- **Secured by Design**:
- Containers enforce isolation. Unified policies and host scopes restrict damage.

- **Domain Isolation**:
- NestJS API boundaries cleanly separate core orchestrator mechanics from domain logic.

---

## Thank You!

### Any Questions?

- **Reference Documentation**:
- System Overview: `01-system-overview.md`
- Step Execution: `07-workflow-step-execution.md`
- PI Runner: `28-pi-runner.md`
- Tool Policy: `36-tool-policy.md`

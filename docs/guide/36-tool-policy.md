# 36 — Unified Tool Policy

The unified tool policy system centralizes tool permissions into a single, argument-aware evaluation engine via the `ToolPolicyDocument` model. It provides a flexible, layered policy that supports both string shorthand syntax and structured argument-aware rules.

## ToolPolicyDocument Model

The canonical model is `ToolPolicyDocument` in `packages/core/src/tool-policy/tool-policy.types.ts`:

- **`default`** — fallback effect when no rule matches: `allow`, `deny`, `require_approval`, or `guardrail_deny`
- **`rules`** — ordered array of `ToolPolicyRule` objects or string shorthands; first match wins

```typescript
interface ToolPolicyDocument {
  default: ToolPolicyEffect;
  rules: (ToolPolicyRule | string)[];
}

interface ToolPolicyRule {
  id?: string;
  effect: ToolPolicyEffect;
  tool: string; // glob pattern (e.g., "bash", "git*")
  arguments?: Record<string, ToolPolicyArgumentMatcher>;
  reason?: string;
}
```

### Effects

| Effect             | Behavior                                               |
| ------------------ | ------------------------------------------------------ |
| `allow`            | Tool call proceeds without interruption                |
| `deny`             | Tool call blocked; error returned to caller            |
| `require_approval` | Tool call queued for human approval                    |
| `guardrail_deny`   | Blocked with guardrail explanation (higher precedence) |

## String Shorthand Syntax

Rules can be written as concise strings. The parser (`parseStringRule` in `packages/core/src/tool-policy/tool-policy.parser.ts`) handles the format:

```
[EFFECT] [TOOL_GLOB] [ARGUMENTS...]
```

Examples:

| Shorthand                                   | Expanded Meaning                                                  |
| ------------------------------------------- | ----------------------------------------------------------------- |
| `"allow read *"`                            | `{ effect: "allow", tool: "read" }`                               |
| `"deny write *"`                            | `{ effect: "deny", tool: "write" }`                               |
| `"require_approval spawn_subagent_async *"` | `{ effect: "require_approval", tool: "spawn_subagent_async" }`    |
| `"allow bash ls"`                           | `{ effect: "allow", tool: "bash", arguments: { command: "ls" } }` |

The third segment after the tool name is captured as a `command` argument. For more complex argument matching, use structured rules.

## Argument-Aware Rules

Structured rules use the `arguments` field to match specific tool call payloads. Matchers support string equality and glob patterns.

### Restrict bash to safe commands

```json
{
  "tool_policy": {
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
}
```

Rules are evaluated in order. `bash ls` matches the third rule and is allowed. `bash "rm -rf /"` matches the first rule and is denied. `bash "git push origin main"` matches the second rule and requires human approval.

### Gate spawn_subagent to specific profiles

```json
{
  "tool_policy": {
    "default": "allow",
    "rules": [
      {
        "effect": "deny",
        "tool": "spawn_subagent_async",
        "arguments": {
          "agent_profile": "ceo-agent"
        }
      },
      {
        "effect": "allow",
        "tool": "spawn_subagent_async",
        "arguments": {
          "agent_profile": "investigation-subagent"
        }
      }
    ]
  }
}
```

This is used by the `investigation-coordinator` agent (`seed/agents/investigation-coordinator/agent.json`): it can spawn `investigation-subagent` but is blocked from spawning `ceo-agent`.

## Policy Layering

Three policy sources merge at runtime:

1. **Agent profile `tool_policy`** — persisted in the `agent_profiles` table, from seed data or admin configuration
2. **Workflow/job `permissions.tool_policy`** — from the YAML workflow definition
3. **Dynamic `ToolApprovalRule` records** — DB-scoped by profile, workflow run, or chat session

The `policy_strategy` field controls layering:

| Strategy       | Behavior                                                                            |
| -------------- | ----------------------------------------------------------------------------------- |
| `layered`      | Workflow/job rules stack on top of agent profile (default)                          |
| `profile_only` | Only the agent profile's tool_policy is used; workflow YAML permissions are ignored |

At execution, rules from all active sources are merged, sorted by specificity then priority. First match wins.

## Unified Tool Policy Design

All seed agents and workflows are configured with the unified `tool_policy` structure. Legacy permission arrays are not supported.

For example, the orchestrator agent (`seed/agents/orchestrator/agent.json`) uses:

```json
{
  "tool_policy": {
    "default": "deny",
    "rules": [
      "allow read *",
      "allow write *",
      "allow edit *",
      "allow bash *",
      "allow spawn_subagent_async *",
      "allow wait_for_subagents *",
      "allow step_complete *",
      "allow search_skills *"
    ]
  }
}
```

## Spawn Subagent Profile Gating

Agents can be restricted to only spawn specific subagent profiles via argument-aware `tool_policy` rules.

### How it works

When an agent calls `spawn_subagent_async({ agent_profile: 'target' })`, the policy evaluator checks the combined `ToolPolicyDocument` against:

```
{ tool: 'spawn_subagent_async', arguments: { agent_profile: 'target' } }
```

If the result is `deny`, a `ForbiddenException` is raised. This uses the same policy evaluation path as any other tool call — no separate mechanism.

### Configuration in agent.json

The `investigation-coordinator` agent restricts subagent spawning to only its paired subagent:

```json
{
  "tool_policy": {
    "default": "deny",
    "rules": [
      {
        "effect": "deny",
        "tool": "spawn_subagent_async",
        "arguments": { "agent_profile": "ceo-agent" }
      },
      {
        "effect": "allow",
        "tool": "spawn_subagent_async",
        "arguments": { "agent_profile": "investigation-subagent" }
      },
      "allow spawn_subagent_async *"
    ]
  }
}
```

The structured deny rules fire first (highest specificity due to `arguments`). The string-format allow rule at the end catches any unmatched profiles.

### Error behavior

A denied spawn returns:

```
ForbiddenException: spawn_subagent_async to profile 'ceo-agent' is denied by policy
```

The calling agent receives this as a tool error result, which surfaces in the agent's next prompt turn.

## YAML Authoring

Workflow and job definitions accept `tool_policy` under `permissions`:

### Workflow-level policy

```yaml
permissions:
  tool_policy:
    default: deny
    rules:
      - allow read *
      - allow ls *
      - allow grep *
      - allow find *
      - allow bash *
      - allow write *
      - allow edit *
```

### Job-level policy override

```yaml
jobs:
  - id: coordinate_investigation
    type: execution
    tier: heavy
    inputs:
      agent_profile: investigation-coordinator
    permissions:
      tool_policy:
        default: deny
        rules:
          - allow read *
          - allow write *
          - allow edit *
          - allow ls *
```

### String rule format in YAML

Since YAML supports unquoted strings, string-format rules can be written inline with quoting only when needed for special characters:

```yaml
permissions:
  tool_policy:
    default: deny
    rules:
      - allow read *
      - allow bash ls
      - "deny bash rm -rf *"
      - "require_approval git push *"
```

## Autonomous Workflows Must Not Grant Interactive Tools

Event-triggered workflows (e.g. `kanban.work_item.status_changed.v1` flows) run with
no interactive user. Granting an interactive capability such as `ask_user_questions`
there lets an agent block the run indefinitely waiting for an answer that never comes.

Because the effective tool catalog is `job policy ∩ agent-profile ceiling`, the grant
must be absent at **both** the workflow/job layer and the agent-profile layer for the
tool to be truly unreachable. Autonomous agent profiles (e.g. `qa_automation`) therefore
do not grant `ask_user_questions`, and a seed contract test enforces its absence in the
work-item execution workflows. See
[Work Item Markdown Canonical Contract](../architecture/work-item-markdown-canonical-contract.md#autonomous-workflow-tool-policy).

## Cross-References

- [Tool System](14-tool-system.md) — tool policy document layer in the four-layer stack
- [Security](19-security.md) — spawn subagent gating and authorization
- [Workflow Engine](06-workflow-engine.md) — YAML validation and permissions parsing
- [AI Config](12-ai-config.md) — agent profile configuration including tool_policy
- [Seed Data](32-seed-data.md) — agent and workflow seed migration patterns
- [Architecture: Tool Permissions & Approvals](../architecture/tool-permissions-and-approvals.md) — detailed architecture reference
- [Unified Tool Policy Developer Guide](../guides/unified-tool-policy.md) — developer-focused extension guide

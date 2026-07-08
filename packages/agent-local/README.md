# @nexus/agent-local

A lightweight local MCP-compatible service that exposes governed command execution and file operations on a user's machine.

## Install

```bash
npm install -g @nexus/agent-local
```

## Run

```bash
nexus-agent-local start
```

Default endpoint: `http://127.0.0.1:3033/mcp`

## CLI

```bash
nexus-agent-local start
nexus-agent-local config get
nexus-agent-local config set port 3033
nexus-agent-local config set allowPatterns "npm test,npm run *"
```

## Config

Config path: `~/.nexus-agent-local/config.json`

```json
{
  "host": "127.0.0.1",
  "port": 3033,
  "allowedRoots": ["/home/user"],
  "allowPatterns": ["npm test", "npm run *"],
  "defaultCommandTimeoutMs": 30000,
  "maxFileBytes": 1000000000,
  "logToStdout": true
}
```

## Security

- Commands are denied by default when no `allowPatterns` are configured.
- All file paths are restricted to configured `allowedRoots`.
- Audit logs are written under `~/.nexus-agent-local/logs`.

# GitOps Repository Binding Runbook

Nexus GitOps is managed through repository bindings in the web UI and API. The old local GitOps CLI is intentionally removed and is not a maintained integration surface.

## Supported Surfaces

- Web UI: use `/gitops` to create bindings, inspect inbound drift, review outbound pending changes, run inbound plan/apply, and sync two-way changes back to Git.
- HTTP API: automation should call the binding-scoped API endpoints with normal API authentication.
- Git provider automation: webhooks or CI jobs may call the HTTP API directly when the API is reachable from the automation environment.

## Repository Bindings

Create one binding per repository and scope in the `/gitops` page.

Required binding fields:

- Scope node id: the neutral scope that owns the binding.
- Repository URL: HTTPS Git URL without embedded credentials.
- Default ref: usually `main`.
- Root path: desired-state root inside the repository, usually `.`.
- Sync mode: `git_to_app` or `two_way`.
- Included object types: workflows, agent profiles, skills, roles, role assignments, and/or scope hierarchy.

### Sync Modes

- `git_to_app`: Git is authoritative. App-side edits to managed objects are blocked and must be made in Git.
- `two_way`: App-side edits are allowed. The app records pending outbound changes, and an operator can sync them back to Git.

## Desired-State Layout

Repository content uses the `@nexus/gitops-contracts` layout:

```text
gitops.yaml
scopes/<scope-path>/scope.yaml
scopes/<scope-path>/workflows/<name>.yaml
scopes/<scope-path>/agents/<name>.yaml
scopes/<scope-path>/skills/<name>.yaml
roles/<name>.yaml
assignments.yaml
```

Sidecar files referenced by `bodyRef` are allowed, but they are not parsed as desired-state documents by themselves.

## Inbound Git To App Flow

Use the GitOps page or call the API:

```bash
curl -X POST \
  -H "Authorization: Bearer <token>" \
  "https://api.example.com/gitops/bindings/<scopeNodeId>/<bindingId>/validate"

curl -X POST \
  -H "Authorization: Bearer <token>" \
  "https://api.example.com/gitops/bindings/<scopeNodeId>/<bindingId>/plan"

curl -X POST \
  -H "Authorization: Bearer <token>" \
  "https://api.example.com/gitops/bindings/<scopeNodeId>/<bindingId>/apply"
```

The API path includes `scopeNodeId` so authorization is evaluated against the binding scope.

## Outbound App To Git Flow

For `two_way` bindings, app-side edits create pending outbound changes. Review them on `/gitops`, then sync them back to Git:

```bash
curl -X POST \
  -H "Authorization: Bearer <token>" \
  "https://api.example.com/gitops/bindings/<scopeNodeId>/<bindingId>/outbound-sync"
```

The outbound sync creates a Git branch and commit containing the pending changes. If Git operations fail, the pending changes remain pending and the failed run is recorded.

## CI And Webhooks

There is no maintained CLI and no repository workflow in this repo that shells out to a GitOps command.

Recommended automation options:

- Validate changed files with package-level tests for `@nexus/gitops-contracts` when those tests are expanded.
- Use a Git provider webhook to call the binding-scoped `validate` and `plan` endpoints after a PR is opened.
- Use a protected merge or deployment event to call the binding-scoped `apply` endpoint if the organization wants automatic inbound apply.

Do not add local shell scripts that bypass repository bindings or reintroduce a separate CLI path.

## Observability

The `/gitops` page shows:

- configured repository bindings;
- last inbound and outbound run state;
- inbound drift and conflicts;
- outbound pending changes;
- binding actions for plan, apply, and sync to Git.

Use API logs and persisted GitOps reconcile runs for operational debugging. Audit trails should reference the binding and run ids rather than a local CLI invocation.

## Troubleshooting

### Binding validation fails

- Confirm the repository URL is HTTPS and has no embedded credentials.
- Confirm the root path exists and is inside the checked-out repository.
- Confirm desired-state files match the `@nexus/gitops-contracts` schema.

### Inbound plan reports conflicts

- Review pending outbound changes for the same binding.
- Sync or discard app-side pending changes before applying inbound Git changes.

### Outbound sync fails

- Confirm the API process can push to the repository using the configured credential path.
- Check the failed GitOps reconcile run for the Git error message.
- Pending changes remain pending until a later successful outbound sync.

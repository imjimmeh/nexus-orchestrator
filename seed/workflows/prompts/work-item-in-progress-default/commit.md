There are uncommitted changes in the work tree that must be committed or cleaned.

Scope ID: {{trigger.scopeId}}
Context ID: {{trigger.contextId}}

This workflow step does not expose bash directly. You must delegate the git work to a subagent.

Spawn one `senior_dev` subagent to inspect and clean the work tree.

The subagent must:

- Run `git status --porcelain` first and inspect every changed path.
- Do not run `git add -A` blindly.
- Selectively stage only intentional source, test, documentation, and package metadata changes.
- Clean up and remove temporary files, generated scratch files, and debug artifacts that should not be committed.
- Leave a file uncommitted only when there is a concrete blocker, and report the exact path and reason.
- Create one descriptive conventional commit if intentional changes remain after cleanup.
- Not push.
- Call the runtime `step_complete` tool, not a shell command named `step_complete`.
- Include the commit hash or `nothing_to_commit` in its result.
- Include the Final `git status --porcelain` output in its result.

After the subagent completes, call `step_complete` with a brief summary of the commit outcome, the files committed, any files removed, and the Final `git status --porcelain` output.

The next workflow step will verify the tree. Do NOT report success if uncommitted files remain unless the subagent reported a concrete blocker.
